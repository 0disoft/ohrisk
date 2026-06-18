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

    const packageJson = JSON.parse(packageJsonEntry.data.toString("utf8")) as Record<string, unknown>;
    const files = collectTarEvidenceFiles(entries);
    const warnings = files.length === 0
      ? ["No LICENSE, LICENCE, COPYING, or NOTICE file found."]
      : [];

    return ok({
      packageId: input.packageId,
      ...readLicenseFields(packageJson),
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

function readLicenseFields(packageJson: Record<string, unknown>): {
  packageJsonLicense?: string;
  packageJsonLicenses?: unknown;
} {
  const license = packageJson.license;
  const licenses = packageJson.licenses;

  return {
    ...(typeof license === "string" ? { packageJsonLicense: license } : {}),
    ...(licenses !== undefined ? { packageJsonLicenses: licenses } : {})
  };
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
  const parsed = Number.parseInt(value.trim() || "0", 8);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / 512) * 512;
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}
