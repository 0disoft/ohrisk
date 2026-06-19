import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  type Stats
} from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectLocalPackageEvidence } from "./local-package";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";

type ArtifactFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get: (name: string) => string | null;
  };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type ArtifactFetchOptions = {
  signal?: AbortSignal;
  redirect?: "manual";
};

type ArtifactFetcher = (
  url: string,
  options?: ArtifactFetchOptions
) => Promise<ArtifactFetchResponse>;

const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;
const REGISTRY_METADATA_MAX_BYTES = 10 * 1024 * 1024;
const PACKAGE_TARBALL_MAX_BYTES = 100 * 1024 * 1024;
const INSTALLED_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const LOCAL_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;

const SUPPORTED_INTEGRITY_DIGEST_BYTES = {
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64
} as const;

type SupportedIntegrityAlgorithm = keyof typeof SUPPORTED_INTEGRITY_DIGEST_BYTES;

export async function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
  fetchArtifact?: ArtifactFetcher;
  fetchTimeoutMs?: number;
  registryMetadataMaxBytes?: number;
  tarballMaxBytes?: number;
  installedPackageJsonMaxBytes?: number;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const evidence: LicenseEvidence[] = [];
  const fetchTimeoutMs = input.fetchTimeoutMs ?? ARTIFACT_FETCH_TIMEOUT_MS;
  const registryMetadataMaxBytes = input.registryMetadataMaxBytes ?? REGISTRY_METADATA_MAX_BYTES;
  const tarballMaxBytes = input.tarballMaxBytes ?? PACKAGE_TARBALL_MAX_BYTES;
  const installedPackageJsonMaxBytes =
    input.installedPackageJsonMaxBytes ?? INSTALLED_PACKAGE_JSON_MAX_BYTES;

  for (const node of input.graph.nodes) {
    const collected = await collectNodeEvidence({
      node,
      projectRoot: input.projectRoot,
      fetchArtifact: input.fetchArtifact ?? defaultArtifactFetcher,
      fetchTimeoutMs,
      registryMetadataMaxBytes,
      tarballMaxBytes,
      installedPackageJsonMaxBytes
    });

    if (!collected.ok) {
      return collected;
    }

    evidence.push(collected.value);
  }

  return ok(evidence);
}

async function collectNodeEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  fetchArtifact: ArtifactFetcher;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  installedPackageJsonMaxBytes: number;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const explicitLocalPath = input.node.resolved
    ? resolveLocalArtifact(input.node.resolved, input.projectRoot)
    : undefined;

  if (explicitLocalPath) {
    return collectLocalPathEvidence({
      node: input.node,
      localPath: explicitLocalPath,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  const nodeModulesPath = findNodeModulesPackage({
    node: input.node,
    projectRoot: input.projectRoot,
    packageJsonMaxBytes: input.installedPackageJsonMaxBytes
  });
  if (nodeModulesPath) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  if (!input.node.resolved) {
    return collectRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  if (isHttpUrl(input.node.resolved)) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      integrity: input.node.integrity,
      fetchArtifact: input.fetchArtifact,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  return ok({
    packageId: input.node.id,
    files: [],
    source: "unavailable",
    warnings: [`Unsupported resolved artifact specifier: ${input.node.resolved}`]
  });
}

function collectLocalPathEvidence(input: {
  node: DependencyNode;
  localPath: string;
  tarballMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  if (!existsSync(input.localPath)) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Resolved package artifact does not exist.",
        details: {
          packageId: input.node.id,
          resolved: input.node.resolved,
          artifactPath: input.localPath
        }
      })
    );
  }

  const artifactStats = readLocalArtifactStats({
    filePath: input.localPath,
    packageId: input.node.id,
    resolved: input.node.resolved
  });

  if (!artifactStats.ok) {
    return err(artifactStats.error);
  }

  if (artifactStats.value.isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: input.localPath
    });
  }

  if (artifactStats.value.size > input.tarballMaxBytes) {
    return err(localArtifactTooLargeError({
      packageId: input.node.id,
      resolved: input.node.resolved,
      artifactPath: input.localPath,
      maxBytes: input.tarballMaxBytes,
      observedBytes: artifactStats.value.size
    }));
  }

  const tarball = readLocalArtifactFileWithLimit({
    filePath: input.localPath,
    packageId: input.node.id,
    resolved: input.node.resolved,
    maxBytes: input.tarballMaxBytes
  });

  if (!tarball.ok) {
    return err(tarball.error);
  }

  const verified = verifyPackageIntegrity({
    packageId: input.node.id,
    resolved: input.node.resolved,
    integrity: input.node.integrity,
    tarball: tarball.value
  });

  if (!verified.ok) {
    return err(verified.error);
  }

  return collectTarballEvidence({
    packageId: input.node.id,
    tarball: tarball.value
  });
}

function readLocalArtifactStats(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
}): Result<Stats, OhriskError> {
  try {
    return ok(statSync(input.filePath));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to inspect resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: input.resolved,
          artifactPath: input.filePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readLocalArtifactFileWithLimit(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
  maxBytes: number;
}): Result<Buffer, OhriskError> {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(input.filePath, "r");

    while (true) {
      const readSize = Math.min(
        LOCAL_ARTIFACT_READ_CHUNK_BYTES,
        Math.max(1, input.maxBytes + 1 - observedBytes)
      );
      const chunk = Buffer.alloc(readSize);
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        return ok(Buffer.concat(chunks, observedBytes));
      }

      observedBytes += bytesRead;
      if (observedBytes > input.maxBytes) {
        return err(localArtifactTooLargeError({
          packageId: input.packageId,
          resolved: input.resolved,
          artifactPath: input.filePath,
          maxBytes: input.maxBytes,
          observedBytes
        }));
      }

      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: input.resolved,
          artifactPath: input.filePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the primary read or size error.
      }
    }
  }
}

function localArtifactTooLargeError(input: {
  packageId: string;
  resolved: string | undefined;
  artifactPath: string;
  maxBytes: number;
  observedBytes: number;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Resolved package artifact exceeded the maximum supported size.",
    details: {
      packageId: input.packageId,
      resolved: input.resolved,
      artifactPath: input.artifactPath,
      ...artifactBodyLimitDetails({
        maxBytes: input.maxBytes,
        observedBytes: input.observedBytes
      })
    }
  });
}

async function collectRegistryTarballEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = npmRegistryPackageUrl(input.node.name);

  try {
    const metadataText = await readArtifactWithTimeout({
      fetchArtifact: input.fetchArtifact,
      url: metadataUrl,
      timeoutMs: input.fetchTimeoutMs,
      readResponse: async (response) => {
        if (!response.ok) {
          return err(
            createError({
              code: "REGISTRY_METADATA_FETCH_FAILED",
              category: "network",
              message: "Failed to fetch npm registry metadata.",
              details: {
                packageId: input.node.id,
                registryUrl: metadataUrl,
                status: response.status,
                statusText: response.statusText
              }
            })
          );
        }

        const metadataBody = await readResponseBodyWithLimit({
          response,
          maxBytes: input.registryMetadataMaxBytes,
          createTooLargeError: (limit) => createError({
            code: "REGISTRY_METADATA_FETCH_FAILED",
            category: "unsupported_input",
            message: "npm registry metadata response exceeded the maximum supported size.",
            details: {
              packageId: input.node.id,
              registryUrl: metadataUrl,
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: "REGISTRY_METADATA_FETCH_FAILED",
            category: "unsupported_input",
            message: "npm registry metadata response did not expose a readable body stream.",
            details: {
              packageId: input.node.id,
              registryUrl: metadataUrl
            }
          })
        });

        if (!metadataBody.ok) {
          return err(metadataBody.error);
        }

        return ok(metadataBody.value.toString("utf8"));
      }
    });

    if (!metadataText.ok) {
      return err(metadataText.error);
    }

    const metadata = parseRegistryMetadata({
      packageId: input.node.id,
      registryUrl: metadataUrl,
      text: metadataText.value
    });
    if (!metadata.ok) {
      return err(metadata.error);
    }

    const tarballUrl = readRegistryTarballUrl(metadata.value, input.node.version);

    if (!tarballUrl) {
      return err(
        createError({
          code: "REGISTRY_METADATA_FETCH_FAILED",
          category: "unsupported_input",
          message: "npm registry metadata did not include a tarball for the requested version.",
          details: {
            packageId: input.node.id,
            registryUrl: metadataUrl,
            version: input.node.version
          }
        })
      );
    }

    const tarballUrlValidation = validateRemoteArtifactUrl({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      packageId: input.node.id,
      resolved: tarballUrl,
      message: "npm registry metadata included an unsupported tarball URL.",
      details: {
        registryUrl: metadataUrl,
        version: input.node.version,
        tarballUrl
      }
    });

    if (!tarballUrlValidation.ok) {
      return err(tarballUrlValidation.error);
    }

    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: tarballUrl,
      integrity: input.node.integrity,
      fetchArtifact: input.fetchArtifact,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes
    });
  } catch (cause) {
    return err(
      createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "network",
        message: "Failed to read npm registry metadata.",
        details: {
          packageId: input.node.id,
          registryUrl: metadataUrl,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseRegistryMetadata(input: {
  packageId: string;
  registryUrl: string;
  text: string;
}): Result<unknown, OhriskError> {
  try {
    return ok(JSON.parse(input.text) as unknown);
  } catch (cause) {
    return err(
      createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "unsupported_input",
        message: "npm registry metadata was not valid JSON.",
        details: {
          packageId: input.packageId,
          registryUrl: input.registryUrl,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function resolveLocalArtifact(resolved: string, projectRoot: string): string | undefined {
  if (resolved.startsWith("file://")) {
    const filePath = resolveFileUrl(resolved);
    if (filePath) {
      return filePath;
    }
  }

  if (resolved.startsWith("file:")) {
    const specifier = decodeFilePathSpecifier(resolved.slice("file:".length));
    return path.resolve(projectRoot, specifier);
  }

  if (resolved.startsWith(".") || path.isAbsolute(resolved)) {
    return path.resolve(projectRoot, resolved);
  }

  return undefined;
}

function resolveFileUrl(value: string): string | undefined {
  try {
    return fileURLToPath(value);
  } catch {
    return undefined;
  }
}

function decodeFilePathSpecifier(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findNodeModulesPackage(input: {
  node: DependencyNode;
  projectRoot: string;
  packageJsonMaxBytes: number;
}): string | undefined {
  const packageNames = [...new Set([...(input.node.installNames ?? []), input.node.name])];

  for (const packageName of packageNames) {
    const packagePath = resolveNodeModulesPackage(packageName, input.projectRoot);
    if (!packagePath) {
      continue;
    }

    if (
      existsSync(packagePath)
      && isReadableDirectory(packagePath)
      && installedPackageMatchesNode({
        node: input.node,
        packagePath,
        maxBytes: input.packageJsonMaxBytes
      })
    ) {
      return packagePath;
    }
  }

  return undefined;
}

function resolveNodeModulesPackage(packageName: string, projectRoot: string): string | undefined {
  const segments = nodeModulesPackageSegments(packageName);
  if (!segments) {
    return undefined;
  }

  return path.join(projectRoot, "node_modules", ...segments);
}

function nodeModulesPackageSegments(packageName: string): string[] | undefined {
  if (packageName === "" || packageName.includes("\\") || packageName.includes(":")) {
    return undefined;
  }

  const segments = packageName.split("/");
  if (segments.length === 1) {
    return isSafeNodeModulesSegment(segments[0]) && !segments[0].startsWith("@")
      ? segments
      : undefined;
  }

  if (
    segments.length === 2
    && segments[0].startsWith("@")
    && segments[0].length > 1
    && isSafeNodeModulesSegment(segments[0])
    && isSafeNodeModulesSegment(segments[1])
  ) {
    return segments;
  }

  return undefined;
}

function isSafeNodeModulesSegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== "..";
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function installedPackageMatchesNode(input: {
  node: DependencyNode;
  packagePath: string;
  maxBytes: number;
}): boolean {
  try {
    const packageJsonText = readTextFileWithLimit({
      filePath: path.join(input.packagePath, "package.json"),
      maxBytes: input.maxBytes
    });

    if (!packageJsonText.ok) {
      return false;
    }

    const packageJson = JSON.parse(packageJsonText.value) as unknown;

    return isRecord(packageJson)
      && packageJson.name === input.node.name
      && packageJson.version === input.node.version;
  } catch {
    return false;
  }
}

async function collectRemoteTarballEvidence(input: {
  packageId: string;
  resolved: string;
  integrity?: string;
  fetchArtifact: ArtifactFetcher;
  fetchTimeoutMs: number;
  tarballMaxBytes: number;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (!isHttpUrl(input.resolved)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [`Unsupported resolved artifact specifier: ${input.resolved}`]
    });
  }

  const urlValidation = validateRemoteArtifactUrl({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.packageId,
    resolved: input.resolved,
    message: "Package tarball URL targets an unsupported or blocked host.",
    details: {
      resolved: input.resolved
    }
  });

  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  try {
    const tarball = await readArtifactWithTimeout({
      fetchArtifact: input.fetchArtifact,
      url: input.resolved,
      timeoutMs: input.fetchTimeoutMs,
      readResponse: async (response) => {
        if (!response.ok) {
          return err(
            createError({
              code: "TARBALL_FETCH_FAILED",
              category: "network",
              message: "Failed to fetch package tarball.",
              details: {
                packageId: input.packageId,
                resolved: input.resolved,
                status: response.status,
                statusText: response.statusText
              }
            })
          );
        }

        return readResponseBodyWithLimit({
          response,
          maxBytes: input.tarballMaxBytes,
          createTooLargeError: (limit) => createError({
            code: "TARBALL_FETCH_FAILED",
            category: "unsupported_input",
            message: "Package tarball response exceeded the maximum supported size.",
            details: {
              packageId: input.packageId,
              resolved: input.resolved,
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: "TARBALL_FETCH_FAILED",
            category: "unsupported_input",
            message: "Package tarball response did not expose a readable body stream.",
            details: {
              packageId: input.packageId,
              resolved: input.resolved
            }
          })
        });
      }
    });

    if (!tarball.ok) {
      return err(tarball.error);
    }

    const verified = verifyPackageIntegrity({
      packageId: input.packageId,
      resolved: input.resolved,
      integrity: input.integrity,
      tarball: tarball.value
    });

    if (!verified.ok) {
      return err(verified.error);
    }

    return collectTarballEvidence({
      packageId: input.packageId,
      tarball: tarball.value
    });
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_FETCH_FAILED",
        category: "network",
        message: "Failed to fetch package tarball.",
        details: {
          packageId: input.packageId,
          resolved: input.resolved,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

type ArtifactBodyLimit = {
  maxBytes: number;
  observedBytes: number;
  contentLength?: number;
};

function artifactBodyLimitDetails(limit: ArtifactBodyLimit): Record<string, unknown> {
  return limit.contentLength === undefined
    ? {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes
      }
    : {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes,
        contentLength: limit.contentLength
      };
}

async function readResponseBodyWithLimit(input: {
  response: ArtifactFetchResponse;
  maxBytes: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
  createUnreadableBodyError: () => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const contentLength = readContentLength(input.response.headers);
  if (contentLength !== undefined && contentLength > input.maxBytes) {
    return err(
      input.createTooLargeError({
        maxBytes: input.maxBytes,
        observedBytes: contentLength,
        contentLength
      })
    );
  }

  if (input.response.body) {
    return readStreamBodyWithLimit({
      body: input.response.body,
      maxBytes: input.maxBytes,
      ...(contentLength === undefined ? {} : { contentLength }),
      createTooLargeError: input.createTooLargeError
    });
  }

  return err(input.createUnreadableBodyError());
}

async function readStreamBodyWithLimit(input: {
  body: ReadableStream<Uint8Array>;
  maxBytes: number;
  contentLength?: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const reader = input.body.getReader();
  const chunks: Buffer[] = [];
  let observedBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return ok(Buffer.concat(chunks, observedBytes));
      }

      observedBytes += chunk.value.byteLength;
      if (observedBytes > input.maxBytes) {
        await reader.cancel().catch(() => undefined);
        return err(
          input.createTooLargeError({
            maxBytes: input.maxBytes,
            observedBytes,
            ...(input.contentLength === undefined ? {} : { contentLength: input.contentLength })
          })
        );
      }

      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
}

function readContentLength(headers: ArtifactFetchResponse["headers"]): number | undefined {
  const value = headers?.get("content-length");
  if (value === undefined || value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readArtifactWithTimeout<T>(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  timeoutMs: number;
  readResponse: (response: ArtifactFetchResponse) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);
  });

  try {
    const readPromise = input
      .fetchArtifact(input.url, {
        signal: controller.signal,
        redirect: "manual"
      })
      .then((response) => input.readResponse(response));
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isHttpUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return url !== undefined;
}

function validateRemoteArtifactUrl(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  details: Record<string, unknown>;
}): Result<void, OhriskError> {
  const url = parseHttpUrl(input.resolved);
  if (!url) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...input.details,
          reason: "unsupported_or_invalid_url"
        }
      })
    );
  }

  const blockedHostReason = blockedRemoteArtifactHostReason(url.hostname);
  if (blockedHostReason) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...input.details,
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: blockedHostReason
        }
      })
    );
  }

  return ok(undefined);
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function blockedRemoteArtifactHostReason(hostname: string): string | undefined {
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

function normalizeUrlHostname(hostname: string): string {
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

  const ipv4Mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped?.[1]) {
    return blockedIpv4HostReason(ipv4Mapped[1]);
  }

  const firstHextet = firstIpv6Hextet(host);
  if (firstHextet === undefined) {
    return "invalid_ipv6";
  }

  if ((firstHextet & 0xfe00) === 0xfc00) return "unique_local_ipv6";
  if ((firstHextet & 0xffc0) === 0xfe80) return "link_local_ipv6";
  if ((firstHextet & 0xff00) === 0xff00) return "multicast_ipv6";

  const second = secondIpv6Hextet(host);
  if (firstHextet === 0x2001 && second === 0x0db8) return "documentation_ipv6";

  return undefined;
}

function firstIpv6Hextet(host: string): number | undefined {
  const part = host.split(":").find((segment) => segment !== "");
  if (!part) {
    return undefined;
  }

  const value = Number.parseInt(part, 16);
  return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
}

function secondIpv6Hextet(host: string): number | undefined {
  const parts = host.split(":").filter((segment) => segment !== "");
  const part = parts[1];
  if (!part) {
    return undefined;
  }

  const value = Number.parseInt(part, 16);
  return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
}

function verifyPackageIntegrity(input: {
  packageId: string;
  resolved: string | undefined;
  integrity: string | undefined;
  tarball: Buffer;
}): Result<void, OhriskError> {
  if (!input.integrity) {
    return ok(undefined);
  }

  const supported = parseSupportedIntegrityEntries(input.integrity);
  if (supported.length === 0) {
    return err(
      createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: "Package artifact integrity could not be verified because no supported digest was found.",
        details: {
          packageId: input.packageId,
          resolved: input.resolved,
          integrity: input.integrity,
          supportedAlgorithms: ["sha512", "sha384", "sha256", "sha1"]
        }
      })
    );
  }

  const computed: string[] = [];
  for (const entry of supported) {
    const actualDigest = createHash(entry.algorithm).update(input.tarball).digest();
    const actual = `${entry.algorithm}-${actualDigest.toString("base64")}`;
    computed.push(actual);

    if (
      actualDigest.byteLength === entry.digest.byteLength
      && timingSafeEqual(actualDigest, entry.digest)
    ) {
      return ok(undefined);
    }
  }

  return err(
    createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Package artifact integrity did not match the lockfile digest.",
      details: {
        packageId: input.packageId,
        resolved: input.resolved,
        integrity: input.integrity,
        computed
      }
    })
  );
}

function parseSupportedIntegrityEntries(
  integrity: string
): Array<{ algorithm: SupportedIntegrityAlgorithm; digest: Buffer }> {
  return integrity
    .split(/\s+/)
    .map((entry) => {
      const separatorIndex = entry.indexOf("-");
      if (separatorIndex <= 0) {
        return undefined;
      }

      const algorithm = entry.slice(0, separatorIndex);
      const digest = entry.slice(separatorIndex + 1);
      if (!isSupportedIntegrityAlgorithm(algorithm) || digest === "") {
        return undefined;
      }

      const decoded = decodeIntegrityDigest({ algorithm, digest });
      if (!decoded) {
        return undefined;
      }

      return {
        algorithm,
        digest: decoded
      };
    })
    .filter((entry): entry is {
      algorithm: SupportedIntegrityAlgorithm;
      digest: Buffer;
    } => entry !== undefined);
}

function isSupportedIntegrityAlgorithm(value: string): value is SupportedIntegrityAlgorithm {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_INTEGRITY_DIGEST_BYTES, value);
}

function decodeIntegrityDigest(input: {
  algorithm: SupportedIntegrityAlgorithm;
  digest: string;
}): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.digest)) {
    return undefined;
  }

  const paddingStart = input.digest.indexOf("=");
  if (paddingStart !== -1 && !/^=+$/.test(input.digest.slice(paddingStart))) {
    return undefined;
  }

  if (input.digest.length % 4 === 1) {
    return undefined;
  }

  const decoded = Buffer.from(input.digest, "base64");
  if (decoded.byteLength !== SUPPORTED_INTEGRITY_DIGEST_BYTES[input.algorithm]) {
    return undefined;
  }

  const normalizedInput = input.digest.replace(/=+$/, "");
  const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
  return normalizedDecoded === normalizedInput ? decoded : undefined;
}

function npmRegistryPackageUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}`;
}

function readRegistryTarballUrl(metadata: unknown, version: string): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const versions = metadata.versions;
  if (!isRecord(versions)) {
    return undefined;
  }

  const versionMetadata = versions[version];
  if (!isRecord(versionMetadata)) {
    return undefined;
  }

  const dist = versionMetadata.dist;
  if (!isRecord(dist) || typeof dist.tarball !== "string") {
    return undefined;
  }

  return dist.tarball;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultArtifactFetcher(
  url: string,
  options?: ArtifactFetchOptions
): Promise<ArtifactFetchResponse> {
  return fetch(url, {
    ...(options?.signal ? { signal: options.signal } : {}),
    redirect: options?.redirect ?? "manual"
  });
}
