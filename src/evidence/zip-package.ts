import { inflateRawSync } from "node:zlib";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

type ZipEntry = {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const PACKAGE_ZIP_MAX_ENTRIES = 50_000;
const PACKAGE_ZIP_ENTRY_MAX_BYTES = 2 * 1024 * 1024;

export function collectZipPackageEvidence(input: {
  packageId: string;
  packageName: string;
  packageVersion: string;
  zip: Buffer | Uint8Array;
  maxEntries?: number;
  entryMaxBytes?: number;
}): Result<LicenseEvidence | undefined, OhriskError> {
  const zip = Buffer.isBuffer(input.zip) ? input.zip : Buffer.from(input.zip);
  const entryMaxBytes = input.entryMaxBytes ?? PACKAGE_ZIP_ENTRY_MAX_BYTES;

  try {
    const entries = parseZipEntries({
      packageId: input.packageId,
      zip,
      maxEntries: input.maxEntries ?? PACKAGE_ZIP_MAX_ENTRIES
    });

    for (const packageJsonEntry of packageJsonEntries(entries)) {
      const packageJson = readPackageJsonEntry({
        packageId: input.packageId,
        zip,
        entry: packageJsonEntry,
        maxBytes: entryMaxBytes
      });
      if (!packageJson.ok) {
        return err(packageJson.error);
      }

      if (
        packageJson.value.packageJson.name !== input.packageName
        || packageJson.value.packageJson.version !== input.packageVersion
      ) {
        continue;
      }

      const files = collectZipEvidenceFiles({
        packageId: input.packageId,
        zip,
        entries,
        packageRoot: packageJson.value.packageRoot,
        maxBytes: entryMaxBytes
      });
      if (!files.ok) {
        return err(files.error);
      }

      const warnings = files.value.length === 0
        ? ["No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."]
        : [];

      return ok({
        packageId: input.packageId,
        ...readLicenseFields(packageJson.value.packageJson),
        files: files.value,
        source: "local",
        warnings
      });
    }

    return ok(undefined);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package zip cache evidence.",
        details: {
          packageId: input.packageId,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseZipEntries(input: {
  packageId: string;
  zip: Buffer;
  maxEntries: number;
}): ZipEntry[] {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(input.zip);
  if (endOfCentralDirectoryOffset === undefined) {
    throw new Error("ZIP end of central directory record was not found.");
  }

  const diskNumber = input.zip.readUInt16LE(endOfCentralDirectoryOffset + 4);
  const centralDirectoryDisk = input.zip.readUInt16LE(endOfCentralDirectoryOffset + 6);
  const entriesOnDisk = input.zip.readUInt16LE(endOfCentralDirectoryOffset + 8);
  const totalEntries = input.zip.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectorySize = input.zip.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = input.zip.readUInt32LE(endOfCentralDirectoryOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }

  if (
    totalEntries === ZIP64_SENTINEL
    || centralDirectorySize === ZIP64_SENTINEL
    || centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    throw new Error("ZIP64 package cache archives are not supported.");
  }

  if (totalEntries > input.maxEntries) {
    throw new Error(`Package ZIP exceeded the maximum entry count (${input.maxEntries}).`);
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset < 0
    || centralDirectorySize < 0
    || centralDirectoryEnd > input.zip.length
  ) {
    throw new Error("ZIP central directory extends beyond archive data.");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  while (offset < centralDirectoryEnd) {
    if (offset + 46 > input.zip.length) {
      throw new Error("ZIP central directory entry is truncated.");
    }

    const signature = input.zip.readUInt32LE(offset);
    if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP central directory entry has an invalid signature.");
    }

    const flags = input.zip.readUInt16LE(offset + 8);
    const compressionMethod = input.zip.readUInt16LE(offset + 10);
    const compressedSize = input.zip.readUInt32LE(offset + 20);
    const uncompressedSize = input.zip.readUInt32LE(offset + 24);
    const fileNameLength = input.zip.readUInt16LE(offset + 28);
    const extraLength = input.zip.readUInt16LE(offset + 30);
    const commentLength = input.zip.readUInt16LE(offset + 32);
    const localHeaderOffset = input.zip.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + fileNameLength + extraLength + commentLength;

    if (entryEnd > centralDirectoryEnd || entryEnd > input.zip.length) {
      throw new Error("ZIP central directory entry metadata is truncated.");
    }

    if ((flags & 0x1) !== 0) {
      throw new Error("Encrypted ZIP entries are not supported.");
    }

    if (
      compressedSize === ZIP64_SENTINEL
      || uncompressedSize === ZIP64_SENTINEL
      || localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw new Error("ZIP64 package cache entries are not supported.");
    }

    const rawPath = input.zip.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const normalizedPath = normalizeZipPath(rawPath);
    if (normalizedPath && !normalizedPath.endsWith("/")) {
      entries.push({
        path: normalizedPath,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
    }

    offset = entryEnd;
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function findEndOfCentralDirectory(zip: Buffer): number | undefined {
  if (zip.length < ZIP_EOCD_MIN_BYTES) {
    return undefined;
  }

  const minOffset = Math.max(0, zip.length - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = zip.length - ZIP_EOCD_MIN_BYTES; offset >= minOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) {
      continue;
    }

    const commentLength = zip.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === zip.length) {
      return offset;
    }
  }

  return undefined;
}

function packageJsonEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries.filter((entry) => entry.path === "package.json" || entry.path.endsWith("/package.json"));
}

function readPackageJsonEntry(input: {
  packageId: string;
  zip: Buffer;
  entry: ZipEntry;
  maxBytes: number;
}): Result<{
  packageJson: Record<string, unknown>;
  packageRoot: string;
}, OhriskError> {
  if (input.entry.uncompressedSize > input.maxBytes) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        message: "Package zip cache package.json exceeded the maximum supported size.",
        details: {
          packageId: input.packageId,
          packageJsonPath: input.entry.path,
          maxBytes: input.maxBytes,
          observedBytes: input.entry.uncompressedSize
        }
      })
    );
  }

  const packageJsonData = readZipEntryData({
    zip: input.zip,
    entry: input.entry,
    maxBytes: input.maxBytes
  });

  try {
    const packageJson = JSON.parse(packageJsonData.toString("utf8")) as unknown;
    if (!isObjectRecord(packageJson)) {
      throw new Error("Expected package.json to contain an object.");
    }

    return ok({
      packageJson,
      packageRoot: packageRootForPackageJsonPath(input.entry.path)
    });
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json from package zip cache.",
        details: {
          packageId: input.packageId,
          packageJsonPath: input.entry.path,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function collectZipEvidenceFiles(input: {
  packageId: string;
  zip: Buffer;
  entries: ZipEntry[];
  packageRoot: string;
  maxBytes: number;
}): Result<LicenseEvidenceFile[], OhriskError> {
  const files: LicenseEvidenceFile[] = [];

  for (const entry of input.entries) {
    const normalizedPath = normalizePackagePath(entry.path, input.packageRoot);
    if (!isRootPackageFile(normalizedPath)) {
      continue;
    }

    const kind = classifyEvidenceFile(normalizedPath);
    if (!kind) {
      continue;
    }

    if (entry.uncompressedSize > input.maxBytes) {
      continue;
    }

    files.push({
      path: normalizedPath,
      kind,
      text: readZipEntryData({
        zip: input.zip,
        entry,
        maxBytes: input.maxBytes
      }).toString("utf8")
    });
  }

  return ok(files.sort((left, right) => left.path.localeCompare(right.path)));
}

function readZipEntryData(input: {
  zip: Buffer;
  entry: ZipEntry;
  maxBytes: number;
}): Buffer {
  if (input.entry.uncompressedSize > input.maxBytes) {
    throw new Error(`ZIP entry ${input.entry.path} exceeded the maximum supported size.`);
  }

  if (input.entry.localHeaderOffset + 30 > input.zip.length) {
    throw new Error(`ZIP local file header for ${input.entry.path} is truncated.`);
  }

  const localSignature = input.zip.readUInt32LE(input.entry.localHeaderOffset);
  if (localSignature !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`ZIP local file header for ${input.entry.path} has an invalid signature.`);
  }

  const fileNameLength = input.zip.readUInt16LE(input.entry.localHeaderOffset + 26);
  const extraLength = input.zip.readUInt16LE(input.entry.localHeaderOffset + 28);
  const dataStart = input.entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + input.entry.compressedSize;
  if (dataEnd > input.zip.length || dataEnd < dataStart) {
    throw new Error(`ZIP entry ${input.entry.path} extends beyond archive data.`);
  }

  const compressedData = input.zip.subarray(dataStart, dataEnd);
  if (input.entry.compressionMethod === 0) {
    if (compressedData.length !== input.entry.uncompressedSize) {
      throw new Error(`Stored ZIP entry ${input.entry.path} size did not match metadata.`);
    }

    return compressedData;
  }

  if (input.entry.compressionMethod === 8) {
    const inflated = inflateRawSync(compressedData, {
      maxOutputLength: input.entry.uncompressedSize
    });
    if (inflated.length !== input.entry.uncompressedSize) {
      throw new Error(`Deflated ZIP entry ${input.entry.path} size did not match metadata.`);
    }

    return inflated;
  }

  throw new Error(`ZIP entry ${input.entry.path} uses unsupported compression method ${input.entry.compressionMethod}.`);
}

function packageRootForPackageJsonPath(packageJsonPath: string): string {
  return packageJsonPath === "package.json"
    ? ""
    : packageJsonPath.slice(0, -"/package.json".length);
}

function normalizePackagePath(filePath: string, packageRoot: string): string {
  if (packageRoot === "") {
    return filePath;
  }

  return filePath.startsWith(`${packageRoot}/`) ? filePath.slice(packageRoot.length + 1) : "";
}

function isRootPackageFile(normalizedPath: string): boolean {
  return normalizedPath.length > 0 && !normalizedPath.includes("/");
}

function normalizeZipPath(filePath: string): string | undefined {
  if (
    filePath === ""
    || filePath.includes("\0")
    || filePath.includes("\\")
    || filePath.startsWith("/")
    || /^[A-Za-z]:/.test(filePath)
  ) {
    return undefined;
  }

  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }

  return segments.join("/");
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
