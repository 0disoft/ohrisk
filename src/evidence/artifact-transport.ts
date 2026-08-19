import type { LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import type {
  ArtifactFetchOptions,
  ArtifactFetchResponse,
  ArtifactFetcher
} from "./artifact-response";
import { parseHttpUrl, safeUrlForErrorDetails } from "./artifact-url";
import { err, ok, type Result } from "../shared/result";

export type ArtifactHostResolution = {
  address: string;
  family: number;
};

export type ArtifactHostResolver = (
  hostname: string
) => Promise<ArtifactHostResolution[]>;

type ArtifactLookupOptions = number | LookupOptions;
type SecureArtifactLookupSelection = {
  all: true;
  resolutions: ArtifactHostResolution[];
} | {
  all: false;
  address: string;
  family: number;
};
type Ipv6Hextets = [number, number, number, number, number, number, number, number];

const ARTIFACT_HOST_RESOLUTION_CACHE_TTL_MS = 60_000;
const ARTIFACT_HOST_RESOLUTION_CACHE_MAX_ENTRIES = 256;

export class BlockedArtifactRemoteAddressError extends Error {
  readonly hostname: string;
  readonly remoteAddress: string;
  readonly reason: string;

  constructor(input: {
    hostname: string;
    remoteAddress: string;
    reason: string;
  }) {
    super(
      `Blocked artifact socket remote address for ${input.hostname}: ${input.remoteAddress} (${input.reason}).`
    );
    this.name = "BlockedArtifactRemoteAddressError";
    this.hostname = input.hostname;
    this.remoteAddress = input.remoteAddress;
    this.reason = input.reason;
  }
}

export function normalizeAllowedArtifactHosts(
  hosts: Iterable<string> | undefined
): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const host of hosts ?? []) {
    const value = normalizeUrlHostname(host.trim());
    if (value) {
      normalized.add(value);
    }
  }
  return normalized;
}

export function withRegistryAuthorization(
  fetchArtifact: ArtifactFetcher,
  tokens: ReadonlyMap<string, string> | undefined
): ArtifactFetcher {
  if (!tokens || tokens.size === 0) {
    return fetchArtifact;
  }

  const normalizedTokens = new Map<string, string>();
  for (const [host, token] of tokens) {
    if (token) {
      normalizedTokens.set(normalizeUrlHostname(host), token);
    }
  }

  return (url, options) => {
    const parsed = parseHttpUrl(url);
    const token = parsed?.protocol === "https:"
      ? normalizedTokens.get(normalizeUrlHostname(parsed.hostname))
      : undefined;
    if (!token) {
      return fetchArtifact(url, options);
    }

    return fetchArtifact(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        authorization: `Bearer ${token}`
      }
    });
  };
}

export function createDefaultArtifactFetcher(
  resolveArtifactHost: ArtifactHostResolver
): ArtifactFetcher {
  const lookup = createSecureArtifactLookup(resolveArtifactHost);
  return (url, options) => defaultArtifactFetcher(url, options, lookup);
}

function defaultArtifactFetcher(
  url: string,
  options: ArtifactFetchOptions | undefined,
  lookup: import("node:net").LookupFunction =
    secureArtifactLookup as import("node:net").LookupFunction
): Promise<ArtifactFetchResponse> {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl || parsedUrl.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported artifact URL: ${safeUrlForErrorDetails(url)}`));
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest(parsedUrl, {
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
      lookup
    }, (response) => {
      const socketAddress = validateArtifactSocketRemoteAddress(
        parsedUrl.hostname,
        response.socket.remoteAddress,
        { allowMissingWhenLookupGuarded: true }
      );
      if (!socketAddress.ok) {
        response.destroy(socketAddress.error);
        reject(socketAddress.error);
        return;
      }

      resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? "",
        url,
        headers: headersForIncomingMessage(response.headers),
        body: Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>,
        arrayBuffer: async () => {
          const buffer = await readIncomingMessageToBuffer(response);
          return Uint8Array.from(buffer).buffer;
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

export function validateArtifactSocketRemoteAddress(
  hostname: string,
  remoteAddress: string | undefined,
  options?: { allowMissingWhenLookupGuarded?: boolean }
): Result<void, Error> {
  if (!remoteAddress) {
    if (options?.allowMissingWhenLookupGuarded) {
      return ok(undefined);
    }

    return err(
      new BlockedArtifactRemoteAddressError({
        hostname: normalizeUrlHostname(hostname),
        remoteAddress: "<missing>",
        reason: "missing_remote_address"
      })
    );
  }

  const normalizedRemoteAddress = normalizeUrlHostname(remoteAddress);
  const blockedReason = blockedRemoteArtifactHostReason(normalizedRemoteAddress);
  if (!blockedReason) {
    return ok(undefined);
  }

  return err(
    new BlockedArtifactRemoteAddressError({
      hostname: normalizeUrlHostname(hostname),
      remoteAddress: normalizedRemoteAddress,
      reason: blockedReason
    })
  );
}

export async function defaultArtifactHostResolver(
  hostname: string
): Promise<ArtifactHostResolution[]> {
  return lookup(hostname, {
    all: true,
    verbatim: true
  });
}

export function secureArtifactLookup(
  hostname: string,
  options: ArtifactLookupOptions,
  callback: (
    error: Error | null,
    addressOrAddresses: string | ArtifactHostResolution[],
    family?: number
  ) => void
): void {
  const lookupOptions: LookupOptions = typeof options === "number"
    ? { family: options }
    : options;
  createSecureArtifactLookup(defaultArtifactHostResolver)(hostname, lookupOptions, callback);
}

function createSecureArtifactLookup(
  resolveArtifactHost: ArtifactHostResolver
): import("node:net").LookupFunction {
  return (hostname, options, callback) => {
    resolveArtifactHost(hostname)
    .then((resolutions) => {
      const selection = selectSecureArtifactLookupResponse(hostname, options, resolutions);
      if (!selection.ok) {
        respondToSecureArtifactLookupError(callback, options, selection.error);
        return;
      }

      if (selection.value.all) {
        callback(null, selection.value.resolutions);
        return;
      }

      callback(null, selection.value.address, selection.value.family);
    })
    .catch((cause) => {
      respondToSecureArtifactLookupError(
        callback,
        options,
        cause instanceof Error ? cause : new Error(String(cause))
      );
    });
  };
}

export function createCachingArtifactHostResolver(
  resolveArtifactHost: ArtifactHostResolver,
  now: () => number = Date.now
): ArtifactHostResolver {
  const cache = new Map<string, {
    expiresAt: number;
    resolutions: Promise<ArtifactHostResolution[]>;
  }>();

  return async (hostname) => {
    const normalizedHostname = normalizeUrlHostname(hostname);
    const current = cache.get(normalizedHostname);
    const currentTime = now();
    if (current && current.expiresAt > currentTime) {
      return current.resolutions;
    }

    const resolutions = resolveArtifactHost(normalizedHostname);
    cache.delete(normalizedHostname);
    cache.set(normalizedHostname, {
      expiresAt: currentTime + ARTIFACT_HOST_RESOLUTION_CACHE_TTL_MS,
      resolutions
    });
    while (cache.size > ARTIFACT_HOST_RESOLUTION_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }

    try {
      return await resolutions;
    } catch (cause) {
      const cached = cache.get(normalizedHostname);
      if (cached?.resolutions === resolutions) {
        cache.delete(normalizedHostname);
      }
      throw cause;
    }
  };
}

export function selectSecureArtifactLookupResponse(
  hostname: string,
  options: ArtifactLookupOptions | undefined,
  resolutions: ArtifactHostResolution[]
): Result<SecureArtifactLookupSelection, Error> {
  const normalizedOptions = normalizeArtifactLookupOptions(options);
  const normalizedHostname = normalizeUrlHostname(hostname);

  if (resolutions.length === 0) {
    return err(new Error(`Artifact host ${normalizedHostname} returned no DNS addresses.`));
  }

  const familyResolutions = normalizedOptions.family === undefined
    ? resolutions
    : resolutions.filter((resolution) => resolution.family === normalizedOptions.family);

  if (familyResolutions.length === 0) {
    return err(new Error(`Artifact host ${normalizedHostname} returned no matching DNS addresses.`));
  }

  for (const resolution of familyResolutions) {
    const blockedReason = blockedRemoteArtifactHostReason(resolution.address);
    if (blockedReason) {
      return err(
        new Error(
          `Blocked artifact host resolution for ${normalizedHostname}: ${normalizeUrlHostname(resolution.address)} (${blockedReason}).`
        )
      );
    }
  }

  if (normalizedOptions.all) {
    return ok({
      all: true,
      resolutions: familyResolutions
    });
  }

  const selected = familyResolutions[0] as ArtifactHostResolution;
  return ok({
    all: false,
    address: selected.address,
    family: selected.family
  });
}

function normalizeArtifactLookupOptions(options: ArtifactLookupOptions | undefined): {
  all: boolean;
  family: number | undefined;
} {
  const rawFamily = typeof options === "number" ? options : options?.family;
  const family = rawFamily === "IPv4"
    ? 4
    : rawFamily === "IPv6"
      ? 6
      : rawFamily;
  return {
    all: typeof options === "object" && options?.all === true,
    family: family === 4 || family === 6 ? family : undefined
  };
}

function respondToSecureArtifactLookupError(
  callback: (
    error: Error | null,
    addressOrAddresses: string | ArtifactHostResolution[],
    family?: number
  ) => void,
  options: ArtifactLookupOptions | undefined,
  error: Error
): void {
  if (normalizeArtifactLookupOptions(options).all) {
    callback(error, []);
    return;
  }

  callback(error, "", 0);
}

function headersForIncomingMessage(headers: IncomingHttpHeaders): {
  get: (name: string) => string | null;
} {
  return {
    get: (name: string): string | null => {
      const value = headers[name.toLowerCase()];
      if (Array.isArray(value)) {
        return value.join(", ");
      }

      return typeof value === "string" ? value : null;
    }
  };
}

async function readIncomingMessageToBuffer(message: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  }

  return Buffer.concat(chunks);
}

export function isExplicitlyAllowedArtifactHost(
  hostname: string,
  allowedHosts: ReadonlySet<string> | undefined
): boolean {
  const host = normalizeUrlHostname(hostname);
  if (!allowedHosts?.has(host)) {
    return false;
  }

  // Explicit trust is limited to DNS hostnames. Literal addresses and localhost
  // remain blocked even when supplied through a malformed configuration value.
  return isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost");
}

export function blockedRemoteArtifactHostReason(hostname: string): string | undefined {
  const host = normalizeUrlHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "localhost";
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return blockedIpv4HostReason(host);
  }

  if (ipVersion === 6) {
    return blockedIpv6HostReason(host);
  }

  return undefined;
}

export function shouldResolveRemoteArtifactHost(hostname: string): boolean {
  return isIP(hostname) === 0 && blockedRemoteArtifactHostReason(hostname) === undefined;
}

export function normalizeUrlHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function blockedIpv4HostReason(host: string): string | undefined {
  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return "invalid_ipv4";
  }

  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return "unspecified_ipv4";
  if (a === 10) return "private_ipv4";
  if (a === 100 && b >= 64 && b <= 127) return "shared_address_ipv4";
  if (a === 127) return "loopback_ipv4";
  if (a === 169 && b === 254) return "link_local_ipv4";
  if (a === 172 && b >= 16 && b <= 31) return "private_ipv4";
  if (a === 192 && b === 168) return "private_ipv4";
  if (a === 192 && b === 0 && c === 2) return "documentation_ipv4";
  if (a === 192 && b === 0) return "non_public_ipv4";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking_ipv4";
  if (a === 198 && b === 51 && c === 100) return "documentation_ipv4";
  if (a === 203 && b === 0 && c === 113) return "documentation_ipv4";
  if (a >= 224) return "multicast_or_reserved_ipv4";

  return undefined;
}

function blockedIpv6HostReason(host: string): string | undefined {
  if (host === "::") return "unspecified_ipv6";
  if (host === "::1") return "loopback_ipv6";

  const embeddedIpv4 = embeddedIpv4FromIpv6Host(host);
  if (embeddedIpv4) {
    return blockedIpv4HostReason(embeddedIpv4);
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return "invalid_ipv6";
  }

  const [firstHextet, secondHextet, thirdHextet, fourthHextet] = hextets;

  if (
    firstHextet === 0x0064
    && secondHextet === 0xff9b
    && thirdHextet === 0x0001
  ) {
    return "local_nat64_ipv6";
  }

  if (
    firstHextet === 0x0100
    && secondHextet === 0
    && thirdHextet === 0
    && fourthHextet === 0
  ) {
    return "discard_ipv6";
  }

  if ((firstHextet & 0xfe00) === 0xfc00) return "unique_local_ipv6";
  if ((firstHextet & 0xffc0) === 0xfe80) return "link_local_ipv6";
  if ((firstHextet & 0xff00) === 0xff00) return "multicast_ipv6";

  if (firstHextet === 0x2001 && secondHextet === 0) return "teredo_ipv6";
  if (
    firstHextet === 0x2001
    && secondHextet === 0x0002
    && thirdHextet === 0
  ) {
    return "benchmarking_ipv6";
  }
  if (
    firstHextet === 0x2001
    && ((secondHextet & 0xfff0) === 0x0010 || (secondHextet & 0xfff0) === 0x0020)
  ) {
    return "orchid_ipv6";
  }
  if (firstHextet === 0x2001 && secondHextet === 0x0db8) return "documentation_ipv6";

  return undefined;
}

function embeddedIpv4FromIpv6Host(host: string): string | undefined {
  const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) {
    return dotted[1];
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return undefined;
  }

  if (
    hextets.slice(0, 5).every((hextet) => hextet === 0)
    && hextets[5] === 0xffff
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets.slice(0, 6).every((hextet) => hextet === 0)
    && (hextets[6] !== 0 || hextets[7] > 1)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets[0] === 0x0064
    && hextets[1] === 0xff9b
    && hextets.slice(2, 6).every((hextet) => hextet === 0)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (hextets[0] === 0x2002) {
    return ipv4FromHextets(hextets[1], hextets[2]);
  }

  return undefined;
}

function ipv4FromHextets(high: number, low: number): string {
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join(".");
}

function expandIpv6Hextets(host: string): Ipv6Hextets | undefined {
  if (host.includes(".")) {
    return undefined;
  }

  const [left = "", right = "", extra] = host.split("::");
  if (extra !== undefined) {
    return undefined;
  }

  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === "" ? [] : right.split(":");
  const hasCompression = host.includes("::");
  const missingCount = hasCompression ? 8 - leftParts.length - rightParts.length : 0;
  if ((!hasCompression && leftParts.length !== 8) || missingCount < 0) {
    return undefined;
  }

  const parts = [
    ...leftParts,
    ...Array.from({ length: missingCount }, () => "0"),
    ...rightParts
  ];
  if (parts.length !== 8) {
    return undefined;
  }

  const hextets = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    const value = Number.parseInt(part, 16);
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
  });

  return hextets.every((hextet): hextet is number => hextet !== undefined)
    ? hextets as Ipv6Hextets
    : undefined;
}
