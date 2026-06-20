import { gunzipSync } from "node:zlib";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

type TarEntry = {
  path: string;
  type: string;
  data: Buffer;
};

const PACKAGE_TARBALL_UNPACKED_MAX_BYTES = 100 * 1024 * 1024;
const PACKAGE_TARBALL_MAX_ENTRIES = 50_000;

export function collectTarballEvidence(input: {
  packageId: string;
  tarball: Buffer | Uint8Array;
  unpackedMaxBytes?: number;
  maxEntries?: number;
}): Result<LicenseEvidence, OhriskError> {
  const unpacked = gunzipTarballWithLimit({
    packageId: input.packageId,
    tarball: input.tarball,
    maxBytes: input.unpackedMaxBytes ?? PACKAGE_TARBALL_UNPACKED_MAX_BYTES
  });
  if (!unpacked.ok) {
    return err(unpacked.error);
  }

  try {
    const entries = parseTarEntries({
      tarball: unpacked.value,
      maxEntries: input.maxEntries ?? PACKAGE_TARBALL_MAX_ENTRIES
    });
    const packageRoot = findPackageRoot(entries);
    const packageJsonEntry = packageRoot === undefined
      ? undefined
      : entries.find((entry) => normalizePackagePath(entry.path, packageRoot) === "package.json");

    if (!packageJsonEntry) {
      return err(
        createError({
          code: "PACKAGE_JSON_PARSE_FAILED",
          category: "unsupported_input",
          message: "Package tarball is missing package.json.",
          details: {
            packageId: input.packageId
          }
        })
      );
    }

    const packageJson = readPackageJson({
      packageId: input.packageId,
      data: packageJsonEntry.data
    });
    if (!packageJson.ok) {
      return err(packageJson.error);
    }

    const files = collectTarEvidenceFiles(entries, packageRoot);
    const warnings = files.length === 0
      ? ["No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."]
      : [];

    return ok({
      packageId: input.packageId,
      ...readLicenseFields(packageJson.value),
      files,
      source: "tarball",
      warnings
    });
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package tarball evidence.",
        details: {
          packageId: input.packageId,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function gunzipTarballWithLimit(input: {
  packageId: string;
  tarball: Buffer | Uint8Array;
  maxBytes: number;
}): Result<Buffer, OhriskError> {
  try {
    return ok(gunzipSync(input.tarball, { maxOutputLength: input.maxBytes }));
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to decompress package tarball evidence.",
        details: {
          packageId: input.packageId,
          maxUnpackedBytes: input.maxBytes,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readPackageJson(input: {
  packageId: string;
  data: Buffer;
}): Result<Record<string, unknown>, OhriskError> {
  try {
    const packageJson = JSON.parse(input.data.toString("utf8")) as unknown;
    if (!isObjectRecord(packageJson)) {
      throw new Error("Expected package.json to contain an object.");
    }

    return ok(packageJson);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json from package tarball.",
        details: {
          packageId: input.packageId,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseTarEntries(input: {
  tarball: Buffer;
  maxEntries: number;
}): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let observedEntries = 0;

  while (offset + 512 <= input.tarball.length) {
    const header = input.tarball.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    observedEntries += 1;
    if (observedEntries > input.maxEntries) {
      throw new Error(`Package tarball exceeded the maximum entry count (${input.maxEntries}).`);
    }

    const name = readNullTerminated(header, 0, 100);
    const prefix = readNullTerminated(header, 345, 155);
    const type = readNullTerminated(header, 156, 1) || "0";
    const fullPath = prefix ? `${prefix}/${name}` : name;
    assertValidHeaderChecksum(header, fullPath);

    const size = parseOctal(readNullTerminated(header, 124, 12), "size");
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!Number.isSafeInteger(dataEnd) || dataEnd < dataStart || dataEnd > input.tarball.length) {
      throw new Error(`Tar entry ${fullPath || "(unnamed)"} extends beyond archive data.`);
    }

    if (type === "0" || type === "") {
      entries.push({
        path: fullPath,
        type,
        data: input.tarball.subarray(dataStart, dataEnd)
      });
    }

    offset = dataStart + roundUpToBlock(size);
  }

  return entries;
}

function findPackageRoot(entries: TarEntry[]): string | undefined {
  if (entries.some((entry) => entry.path === "package.json")) {
    return "";
  }

  const roots = entries
    .map((entry) => {
      const match = /^([^/]+)\/package\.json$/.exec(entry.path);
      return match?.[1];
    })
    .filter((root): root is string => root !== undefined)
    .sort();

  if (roots.includes("package")) {
    return "package";
  }

  return roots[0];
}

function collectTarEvidenceFiles(entries: TarEntry[], packageRoot: string): LicenseEvidenceFile[] {
  return entries
    .map((entry) => {
      const normalized = normalizePackagePath(entry.path, packageRoot);
      if (!isRootPackageFile(normalized)) {
        return undefined;
      }

      const kind = classifyEvidenceFile(normalized);

      if (!kind) {
        return undefined;
      }

      return {
        path: normalized,
        kind,
        text: entry.data.toString("utf8")
      };
    })
    .filter((entry): entry is LicenseEvidenceFile => entry !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isRootPackageFile(normalizedPath: string): boolean {
  return normalizedPath.length > 0 && !normalizedPath.includes("/");
}

function readLicenseFields(packageJson: Record<string, unknown>): {
  packageJsonLicense?: string;
  packageJsonLicenses?: unknown;
} {
  const license = packageJson.license;
  const licenses = packageJson.licenses;
  const legacyLicenseObject = isObjectRecord(license) ? license : undefined;

  return {
    ...(typeof license === "string" ? { packageJsonLicense: license } : {}),
    ...(legacyLicenseObject !== undefined ? { packageJsonLicenses: legacyLicenseObject } : {}),
    ...(licenses !== undefined ? { packageJsonLicenses: licenses } : {})
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePackagePath(path: string, packageRoot: string): string {
  if (packageRoot === "") {
    return path;
  }

  return path.startsWith(`${packageRoot}/`) ? path.slice(packageRoot.length + 1) : path;
}

function readNullTerminated(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8").trim();
}

function assertValidHeaderChecksum(header: Buffer, entryPath: string): void {
  const expected = parseOctal(readNullTerminated(header, 148, 8), "checksum");
  const checksumHeader = Buffer.from(header);

  checksumHeader.fill(" ", 148, 156);

  const actual = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) {
    throw new Error(`Tar entry ${entryPath || "(unnamed)"} has an invalid header checksum.`);
  }
}

function parseOctal(value: string, fieldName: "checksum" | "size"): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return 0;
  }

  if (!/^[0-7]+$/.test(trimmed)) {
    throw new Error(`Tar entry contains an invalid octal ${fieldName}.`);
  }

  const parsed = Number.parseInt(trimmed, 8);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Tar entry ${fieldName} is too large to parse safely.`);
  }

  return parsed;
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / 512) * 512;
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}
