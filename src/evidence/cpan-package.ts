import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { LicenseEvidence } from "./types";

const CPAN_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
const CPAN_ARCHIVE_UNPACKED_MAX_BYTES = 100 * 1024 * 1024;
const CPAN_ARCHIVE_MAX_ENTRIES = 50_000;

type CpanMeta = {
  name?: string;
  version?: string;
  licenses: string[];
};

type TarEntry = {
  path: string;
  data: Buffer;
};

export function collectCpanPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  resolved?: string;
  projectRoot: string;
  archiveMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const archivePath = cpanArchivePath({
    projectRoot: input.projectRoot,
    pathname: input.resolved
  });

  if (!archivePath || !existsSync(archivePath)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["CPAN distribution archive was not found in the local Carton cache."]
    });
  }

  const metadata = readCpanArchiveMetadata({
    packageId: input.packageId,
    archivePath,
    maxBytes: input.archiveMaxBytes ?? CPAN_ARCHIVE_MAX_BYTES
  });
  if (!metadata.ok) {
    return err(metadata.error);
  }

  if (
    metadata.value.name
    && metadata.value.version
    && (metadata.value.name !== input.packageName || metadata.value.version !== input.version)
  ) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["CPAN distribution archive metadata did not match the locked distribution identity."]
    });
  }

  return ok({
    packageId: input.packageId,
    ...(metadata.value.licenses.length === 1
      ? {
          metadataLicense: metadata.value.licenses[0],
          metadataSource: "CPAN META"
        }
      : {}),
    ...(metadata.value.licenses.length > 1
      ? {
          metadataLicenses: metadata.value.licenses,
          metadataSource: "CPAN META"
        }
      : {}),
    files: [],
    source: "local",
    warnings: metadata.value.licenses.length > 0
      ? []
      : ["CPAN distribution archive metadata did not declare license metadata."]
  });
}

function cpanArchivePath(input: {
  projectRoot: string;
  pathname?: string;
}): string | undefined {
  if (!input.pathname) {
    return undefined;
  }

  const segments = input.pathname.split(/[\\/]+/).filter((segment) => segment !== "");
  if (
    segments.length === 0
    || !segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment))
    || !/\.(?:tar\.gz|tgz)$/i.test(segments[segments.length - 1] ?? "")
  ) {
    return undefined;
  }

  const cacheRoot = path.resolve(input.projectRoot, "local", "cache", "authors", "id");
  const candidate = path.resolve(cacheRoot, ...segments);
  return isPathInside(cacheRoot, candidate) ? candidate : undefined;
}

function readCpanArchiveMetadata(input: {
  packageId: string;
  archivePath: string;
  maxBytes: number;
}): Result<CpanMeta, OhriskError> {
  const archive = readArchiveWithLimit(input);
  if (!archive.ok) {
    return err(archive.error);
  }

  try {
    const unpacked = gunzipSync(archive.value, {
      maxOutputLength: CPAN_ARCHIVE_UNPACKED_MAX_BYTES
    });
    const entries = parseTarEntries({
      tarball: unpacked,
      maxEntries: CPAN_ARCHIVE_MAX_ENTRIES
    });
    return ok(readCpanMeta(entries));
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse CPAN distribution archive metadata.",
        details: {
          packageId: input.packageId,
          archivePath: input.archivePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readArchiveWithLimit(input: {
  packageId: string;
  archivePath: string;
  maxBytes: number;
}): Result<Buffer, OhriskError> {
  try {
    const stats = statSync(input.archivePath);
    if (stats.size > input.maxBytes) {
      return err(
        createError({
          code: "PACKAGE_EVIDENCE_READ_FAILED",
          category: "unsupported_input",
          message: "CPAN distribution archive exceeded the maximum supported size.",
          details: {
            packageId: input.packageId,
            archivePath: input.archivePath,
            maxBytes: input.maxBytes,
            observedBytes: stats.size
          }
        })
      );
    }

    return ok(readFileSync(input.archivePath));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read CPAN distribution archive.",
        details: {
          packageId: input.packageId,
          archivePath: input.archivePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readCpanMeta(entries: TarEntry[]): CpanMeta {
  const metaJson = findMetaEntry(entries, "META.json");
  if (metaJson) {
    return parseCpanMetaObject(JSON.parse(metaJson.data.toString("utf8")) as unknown);
  }

  const metaYml = findMetaEntry(entries, "META.yml");
  if (metaYml) {
    return parseCpanMetaObject(parseYaml(metaYml.data.toString("utf8")));
  }

  return { licenses: [] };
}

function findMetaEntry(entries: TarEntry[], fileName: "META.json" | "META.yml"): TarEntry | undefined {
  return entries.find((entry) => entry.path === fileName || entry.path.endsWith(`/${fileName}`));
}

function parseCpanMetaObject(value: unknown): CpanMeta {
  if (!isRecord(value)) {
    return { licenses: [] };
  }

  return {
    name: readString(value.name),
    version: readString(value.version),
    licenses: readCpanLicenses(value.license)
  };
}

function readCpanLicenses(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => typeof item === "string" ? normalizeCpanLicenseId(item) : undefined)
    .filter((item): item is string => item !== undefined && item !== "");
}

function normalizeCpanLicenseId(value: string): string {
  const normalized = value.trim().toLowerCase();
  const known = new Map<string, string>([
    ["mit", "MIT"],
    ["apache_2_0", "Apache-2.0"],
    ["artistic_2", "Artistic-2.0"],
    ["agpl_3", "AGPL-3.0-only"],
    ["gpl_2", "GPL-2.0-only"],
    ["gpl_3", "GPL-3.0-only"],
    ["lgpl_2_1", "LGPL-2.1-only"],
    ["lgpl_3_0", "LGPL-3.0-only"],
    ["bsd", "BSD-2-Clause"],
    ["open_source", "NOASSERTION"],
    ["unrestricted", "NOASSERTION"],
    ["unknown", "NOASSERTION"]
  ]);

  return known.get(normalized) ?? value.trim();
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
      throw new Error(`CPAN distribution archive exceeded the maximum entry count (${input.maxEntries}).`);
    }

    const name = readNullTerminated(header, 0, 100);
    const prefix = readNullTerminated(header, 345, 155);
    const type = readNullTerminated(header, 156, 1) || "0";
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(readNullTerminated(header, 124, 12));
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (!Number.isSafeInteger(dataEnd) || dataEnd < dataStart || dataEnd > input.tarball.length) {
      throw new Error(`Tar entry ${fullPath || "(unnamed)"} extends beyond archive data.`);
    }

    if (type === "0" || type === "") {
      entries.push({
        path: fullPath,
        data: input.tarball.subarray(dataStart, dataEnd)
      });
    }

    offset = dataStart + roundUpToBlock(size);
  }

  return entries;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}

function readNullTerminated(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8").trim();
}

function parseOctal(value: string): number {
  const trimmed = value.trim();
  if (!/^[0-7]+$/.test(trimmed)) {
    throw new Error(`Invalid tar octal value: ${value}`);
  }

  return Number.parseInt(trimmed, 8);
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / 512) * 512;
}
