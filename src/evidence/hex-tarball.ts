import { createHash, timingSafeEqual } from "node:crypto";

import { readArchiveBytes, type ArchiveSource } from "../archive/archive-reader";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const HEX_OUTER_ENTRY_LIMIT = 8;
const HEX_CONTENT_ENTRY_LIMIT = 50_000;
const HEX_CONTENT_EXPANDED_MAX_BYTES = 256 * 1024 * 1024;
const HEX_CONTENT_MATERIALIZED_MAX_BYTES = 128 * 1024 * 1024;
const HEX_METADATA_MAX_BYTES = 1024 * 1024;
const HEX_LICENSE_MAX_BYTES = 2 * 1024 * 1024;
const HEX_LICENSE_FILE_LIMIT = 50;
const HEX_OUTER_FILES = new Set(["VERSION", "CHECKSUM", "metadata.config", "contents.tar.gz"]);

export function collectHexTarballEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  tarball: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const outer = readArchiveBytes({
    displayName: `${safeDisplayPart(input.packageName)}-${safeDisplayPart(input.version)}.tar`,
    bytes: input.tarball,
    formatHint: "tar",
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: HEX_OUTER_ENTRY_LIMIT,
      entryBytes: input.artifactMaxBytes,
      expandedBytes: input.artifactMaxBytes,
      materializedBytes: input.artifactMaxBytes
    }
  });
  if (!outer.ok) {
    return outer;
  }

  const unexpected = outer.value.entries.find((entry) =>
    entry.type !== "file" || !HEX_OUTER_FILES.has(entry.path)
  );
  if (unexpected) {
    return err(hexTarballError(input, "Hex package archive contained an unexpected outer entry.", {
      reason: "hex_outer_entry_unexpected",
      entryPath: unexpected.path,
      entryType: unexpected.type
    }));
  }

  const versionBytes = readRequiredEntry(input, outer.value, "VERSION");
  const checksumBytes = readRequiredEntry(input, outer.value, "CHECKSUM");
  const metadataBytes = readRequiredEntry(input, outer.value, "metadata.config");
  const contentsBytes = readRequiredEntry(input, outer.value, "contents.tar.gz");
  if (!versionBytes.ok) return versionBytes;
  if (!checksumBytes.ok) return checksumBytes;
  if (!metadataBytes.ok) return metadataBytes;
  if (!contentsBytes.ok) return contentsBytes;

  if (versionBytes.value.toString("ascii") !== "3") {
    return err(hexTarballError(input, "Hex package archive used an unsupported format version.", {
      reason: "hex_archive_version_unsupported"
    }));
  }
  if (metadataBytes.value.byteLength > HEX_METADATA_MAX_BYTES) {
    return err(hexTarballError(input, "Hex package metadata exceeded the maximum supported size.", {
      reason: "hex_metadata_too_large",
      maxBytes: HEX_METADATA_MAX_BYTES,
      observedBytes: metadataBytes.value.byteLength
    }));
  }

  const expectedInnerChecksum = parseInnerChecksum(checksumBytes.value);
  const computedInnerChecksum = createHash("sha256")
    .update(versionBytes.value)
    .update(metadataBytes.value)
    .update(contentsBytes.value)
    .digest();
  if (!expectedInnerChecksum || !timingSafeEqual(expectedInnerChecksum, computedInnerChecksum)) {
    return err(hexTarballError(input, "Hex package inner checksum did not match its payload.", {
      reason: "hex_inner_checksum_mismatch"
    }));
  }

  const metadata = parseHexMetadata(input, metadataBytes.value);
  if (!metadata.ok) {
    return metadata;
  }
  if (metadata.value.name !== input.packageName || metadata.value.version !== input.version) {
    return err(hexTarballError(input, "Hex package metadata did not match the locked package identity.", {
      reason: "hex_package_identity_mismatch",
      expectedName: input.packageName,
      expectedVersion: input.version,
      observedName: metadata.value.name,
      observedVersion: metadata.value.version
    }));
  }

  const contents = readArchiveBytes({
    displayName: "contents.tar.gz",
    bytes: contentsBytes.value,
    formatHint: "tar.gz",
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: HEX_CONTENT_ENTRY_LIMIT,
      expandedBytes: HEX_CONTENT_EXPANDED_MAX_BYTES,
      materializedBytes: HEX_CONTENT_MATERIALIZED_MAX_BYTES
    }
  });
  if (!contents.ok) {
    return contents;
  }

  const warnings: string[] = [];
  const files = collectHexArchiveEvidenceFiles(contents.value, warnings);
  if (files.length === 0) {
    warnings.push("Checksum-verified Hex package did not contain a root license evidence file.");
  }
  if (metadata.value.licenses.length === 0) {
    warnings.push("Checksum-verified Hex metadata did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadata.value.licenses.length === 1
      ? { metadataLicense: metadata.value.licenses[0], metadataSource: "metadata.config" }
      : {}),
    ...(metadata.value.licenses.length > 1
      ? { metadataLicenses: metadata.value.licenses, metadataSource: "metadata.config" }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

function readRequiredEntry(
  input: { packageId: string; packageName: string; version: string },
  archive: ArchiveSource,
  entryPath: string
): Result<Buffer, OhriskError> {
  const entry = archive.entries.find((candidate) =>
    candidate.type === "file" && candidate.path === entryPath
  );
  if (!entry) {
    return err(hexTarballError(input, "Hex package archive was missing a required outer entry.", {
      reason: "hex_outer_entry_missing",
      entryPath
    }));
  }
  return archive.readEntry(entryPath);
}

function parseInnerChecksum(bytes: Buffer): Buffer | undefined {
  const text = bytes.toString("ascii");
  if (!/^[0-9A-F]{64}$/u.test(text)) {
    return undefined;
  }
  const checksum = Buffer.from(text, "hex");
  return checksum.byteLength === 32 ? checksum : undefined;
}

function parseHexMetadata(
  input: { packageId: string; packageName: string; version: string },
  bytes: Buffer
): Result<{ name: string; version: string; licenses: string[] }, OhriskError> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err(hexTarballError(input, "Hex package metadata was not valid UTF-8.", {
      reason: "hex_metadata_invalid_utf8"
    }));
  }

  const name = readUniqueBinaryMetadataField(text, "name");
  const version = readUniqueBinaryMetadataField(text, "version");
  const licenses = readUniqueLicenseMetadataField(text);
  if (!name || !version || !licenses) {
    return err(hexTarballError(input, "Hex package metadata had an unsupported or ambiguous shape.", {
      reason: "hex_metadata_shape_unsupported"
    }));
  }
  return ok({ name, version, licenses });
}

function readUniqueBinaryMetadataField(text: string, field: string): string | undefined {
  const pattern = new RegExp(`\\{<<"${field}">>,\\s*<<"([^"\\\\]*)">>\\}\\.`, "gu");
  const matches = [...text.matchAll(pattern)];
  return matches.length === 1 && matches[0]?.[1] ? matches[0][1] : undefined;
}

function readUniqueLicenseMetadataField(text: string): string[] | undefined {
  const fields = [...text.matchAll(/\{<<"licenses">>,\s*\[((?:\s*<<"[^"\\]*">>\s*,?)*)\]\}\./gsu)];
  if (fields.length !== 1 || fields[0]?.[1] === undefined) {
    return undefined;
  }
  return [...fields[0][1].matchAll(/<<"([^"\\]*)">>/gu)]
    .map((match) => match[1]?.trim())
    .filter((license): license is string => license !== undefined && license !== "");
}

function collectHexArchiveEvidenceFiles(
  archive: ArchiveSource,
  warnings: string[]
): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  const candidates = archive.entries
    .filter((entry) => entry.type === "file" && !entry.path.includes("/") && classifyEvidenceFile(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, HEX_LICENSE_FILE_LIMIT);

  for (const candidate of candidates) {
    const kind = classifyEvidenceFile(candidate.path);
    if (!kind) continue;
    const text = archive.readText(candidate.path, HEX_LICENSE_MAX_BYTES);
    if (!text.ok) {
      warnings.push(`Skipped ${candidate.path}: Hex license evidence could not be read within the supported bounds.`);
      continue;
    }
    files.push({ path: candidate.path, kind, text: text.value });
  }
  return files;
}

function safeDisplayPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._+-]/gu, "_").slice(0, 120) || "package";
}

function hexTarballError(
  input: { packageId: string; packageName: string; version: string },
  message: string,
  details: Record<string, unknown>
): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message,
    details: {
      packageId: input.packageId,
      packageName: input.packageName,
      version: input.version,
      ...details
    }
  });
}
