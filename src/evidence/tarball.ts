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

export function collectTarballEvidence(input: {
  packageId: string;
  tarball: Buffer | Uint8Array;
}): Result<LicenseEvidence, OhriskError> {
  try {
    const entries = parseTarEntries(gunzipSync(input.tarball));
    const packageJsonEntry = entries.find((entry) => normalizePackagePath(entry.path) === "package.json");

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

    const files = collectTarEvidenceFiles(entries);
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

function parseTarEntries(tarball: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= tarball.length) {
    const header = tarball.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readNullTerminated(header, 0, 100);
    const prefix = readNullTerminated(header, 345, 155);
    const size = parseOctal(readNullTerminated(header, 124, 12));
    const type = readNullTerminated(header, 156, 1) || "0";
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!Number.isSafeInteger(dataEnd) || dataEnd < dataStart || dataEnd > tarball.length) {
      throw new Error(`Tar entry ${fullPath || "(unnamed)"} extends beyond archive data.`);
    }

    if (type === "0" || type === "") {
      entries.push({
        path: fullPath,
        type,
        data: tarball.subarray(dataStart, dataEnd)
      });
    }

    offset = dataStart + roundUpToBlock(size);
  }

  return entries;
}

function collectTarEvidenceFiles(entries: TarEntry[]): LicenseEvidenceFile[] {
  return entries
    .map((entry) => {
      const normalized = normalizePackagePath(entry.path);
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

function normalizePackagePath(path: string): string {
  return path.replace(/^package\//, "");
}

function readNullTerminated(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8").trim();
}

function parseOctal(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    return 0;
  }

  if (!/^[0-7]+$/.test(trimmed)) {
    throw new Error("Tar entry contains an invalid octal size.");
  }

  const parsed = Number.parseInt(trimmed, 8);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tar entry size is too large to parse safely.");
  }

  return parsed;
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / 512) * 512;
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}
