import { isIP } from "node:net";

export function parseBoundedPositiveInteger(value: string, max: number): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : undefined;
}

export function parseDurationMilliseconds(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m)?$/.exec(value.trim().toLowerCase());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

export function parseCacheAgeMilliseconds(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim().toLowerCase());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "d"
    ? 86_400_000
    : unit === "h"
      ? 3_600_000
      : unit === "m"
        ? 60_000
        : unit === "s"
          ? 1_000
          : 1;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

export function parseByteSize(value: string): number | undefined {
  const match = /^(\d+)(b|kb|mb|gb|tb|kib|mib|gib|tib)?$/i.exec(value.trim());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "b";
  const multipliers: Readonly<Record<string, number>> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
    tb: 1_000_000_000_000,
    kib: 1_024,
    mib: 1_048_576,
    gib: 1_073_741_824,
    tib: 1_099_511_627_776
  };
  const bytes = amount * (multipliers[unit] ?? 0);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

export function normalizeRegistryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || !isAllowedRegistryHostname(host)
    ) {
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function normalizeHostnameOption(value: string): string | undefined {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host.includes("/") || host.includes("@")) {
    return undefined;
  }
  try {
    const url = new URL(`https://${host}`);
    return url.hostname === host && isAllowedRegistryHostname(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

export function isSafeRepositoryRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return normalized !== ""
    && !normalized.startsWith("/")
    && !/^[A-Za-z]:/.test(normalized)
    && !normalized.includes("\0")
    && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isAllowedRegistryHostname(host: string): boolean {
  return isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost");
}
