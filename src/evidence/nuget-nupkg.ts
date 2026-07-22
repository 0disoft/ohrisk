import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { readArchiveBytes } from "../archive/archive-reader";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import { normalizeNugetVersion } from "./nuget-registry";
import { parseNuspecMetadata } from "./nuget-package";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const NUGET_NUPKG_MAX_ENTRIES = 50_000;
const NUGET_NUPKG_ENTRY_MAX_BYTES = 50 * 1024 * 1024;
const NUGET_NUPKG_EXPANDED_MAX_BYTES = 256 * 1024 * 1024;
const NUGET_NUPKG_MATERIALIZED_MAX_BYTES = 128 * 1024 * 1024;
const NUGET_NUSPEC_MAX_BYTES = 1024 * 1024;
const NUGET_LICENSE_MAX_BYTES = 2 * 1024 * 1024;
const NUGET_LICENSE_FILE_LIMIT = 50;
const SHA512_DIGEST_BYTES = 64;

export function collectNugetNupkgEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  normalizedVersion: string;
  expectedSha512: string;
  expectedSize: number;
  nupkg: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const integrity = verifyNugetNupkgIntegrity(input);
  if (!integrity.ok) {
    return integrity;
  }

  const archive = readArchiveBytes({
    displayName: `${safeDisplayPart(input.packageName)}.${safeDisplayPart(input.normalizedVersion)}.nupkg`,
    bytes: input.nupkg,
    formatHint: "zip",
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: NUGET_NUPKG_MAX_ENTRIES,
      entryBytes: NUGET_NUPKG_ENTRY_MAX_BYTES,
      expandedBytes: NUGET_NUPKG_EXPANDED_MAX_BYTES,
      materializedBytes: NUGET_NUPKG_MATERIALIZED_MAX_BYTES
    }
  });
  if (!archive.ok) {
    if (archive.error.code === "ARCHIVE_LIMIT_EXCEEDED") {
      return ok(unavailableNugetEvidence(
        input.packageId,
        `SHA-512-verified NuGet package exceeded bounded archive limits (${archive.error.code}); its contents were not trusted.`
      ));
    }
    return err(archive.error);
  }

  const nuspecEntries = archive.value.entries.filter((entry) =>
    entry.type === "file"
    && !entry.path.includes("/")
    && entry.path.toLowerCase().endsWith(".nuspec")
  );
  if (nuspecEntries.length !== 1) {
    return err(nugetPackageError(input, "NuGet package did not contain exactly one root nuspec manifest.", {
      reason: nuspecEntries.length === 0 ? "nuspec_missing" : "nuspec_ambiguous",
      nuspecCount: nuspecEntries.length
    }));
  }

  const nuspecPath = nuspecEntries[0]?.path as string;
  const nuspecText = archive.value.readText(nuspecPath, NUGET_NUSPEC_MAX_BYTES);
  if (!nuspecText.ok) {
    return err(nuspecText.error);
  }
  const metadataResult = parseNuspecMetadata({
    packageId: input.packageId,
    text: nuspecText.value
  });
  if (!metadataResult.ok) {
    return metadataResult;
  }
  const metadata = metadataResult.value;
  if (
    !metadata.id
    || metadata.id.toLowerCase() !== input.packageName.toLowerCase()
    || !metadata.version
    || normalizeNugetVersion(metadata.version) !== input.normalizedVersion
  ) {
    return err(nugetPackageError(input, "NuGet nuspec identity did not match the requested package.", {
      reason: "nuspec_identity_mismatch",
      ...(metadata.id ? { observedName: metadata.id } : {}),
      ...(metadata.version ? { observedVersion: metadata.version } : {})
    }));
  }

  const evidencePaths = new Map<string, LicenseEvidenceFile["kind"]>();
  const declaredLicenseFile = metadata.licenseType === "file"
    ? normalizeDeclaredArchivePath(metadata.license)
    : undefined;
  if (declaredLicenseFile) {
    evidencePaths.set(declaredLicenseFile, "license");
  }
  for (const entry of archive.value.entries
    .filter((candidate) => candidate.type === "file")
    .sort((left, right) => left.path.localeCompare(right.path))) {
    const kind = classifyEvidenceFile(entry.path);
    if (kind && !evidencePaths.has(entry.path)) {
      evidencePaths.set(entry.path, kind);
    }
  }

  const entryPathsByFoldedPath = new Map(
    archive.value.entries
      .filter((entry) => entry.type === "file")
      .map((entry) => [entry.path.toLowerCase(), entry.path] as const)
  );
  const warnings: string[] = [];
  const files: LicenseEvidenceFile[] = [];
  for (const [candidatePath, kind] of [...evidencePaths.entries()].slice(0, NUGET_LICENSE_FILE_LIMIT)) {
    const entryPath = entryPathsByFoldedPath.get(candidatePath.toLowerCase());
    if (!entryPath) {
      warnings.push(`NuGet nuspec declared missing license file ${candidatePath}.`);
      continue;
    }
    const text = archive.value.readText(entryPath, NUGET_LICENSE_MAX_BYTES);
    if (!text.ok) {
      warnings.push(`Skipped ${entryPath}: NuGet license evidence exceeded bounded text limits.`);
      continue;
    }
    files.push({ path: entryPath, kind, text: text.value });
  }

  if (files.length === 0) {
    warnings.push("SHA-512-verified NuGet package did not contain a license evidence file.");
  }
  if (!metadata.license && metadata.licenseUrl) {
    warnings.push(`NuGet nuspec declared only a licenseUrl: ${metadata.licenseUrl}`);
  } else if (!metadata.license) {
    warnings.push("NuGet nuspec did not declare a package license.");
  } else if (metadata.licenseType !== "expression" && metadata.licenseType !== "file") {
    warnings.push("NuGet nuspec license declaration used an unsupported type and was not trusted as an expression.");
  } else if (metadata.licenseType === "file" && !declaredLicenseFile) {
    warnings.push("NuGet nuspec declared an unsafe license file path and it was not read.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadata.license && metadata.licenseType === "expression"
      ? { metadataLicense: metadata.license, metadataSource: "nuspec" }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

function verifyNugetNupkgIntegrity(input: {
  packageId: string;
  expectedSha512: string;
  expectedSize: number;
  nupkg: Buffer | Uint8Array;
}): Result<void, OhriskError> {
  const expected = decodeCanonicalSha512(input.expectedSha512);
  const actual = createHash("sha512").update(input.nupkg).digest();
  if (
    input.nupkg.byteLength !== input.expectedSize
    || !expected
    || expected.length !== actual.length
    || !timingSafeEqual(expected, actual)
  ) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "NuGet package content did not match the nuget.org catalog identity.",
      details: {
        packageId: input.packageId,
        expectedSize: input.expectedSize,
        observedSize: input.nupkg.byteLength,
        computed: `sha512-${actual.toString("base64")}`
      }
    }));
  }
  return ok(undefined);
}

function decodeCanonicalSha512(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const digest = Buffer.from(value, "base64");
  return digest.length === SHA512_DIGEST_BYTES && digest.toString("base64") === value
    ? digest
    : undefined;
}

function normalizeDeclaredArchivePath(value: string | undefined): string | undefined {
  if (!value || value.includes("\\")) {
    return undefined;
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
    || normalized !== value
    || /[\u0000-\u001f\u007f-\u009f:]/u.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function unavailableNugetEvidence(packageId: string, warning: string): LicenseEvidence {
  return { packageId, files: [], source: "unavailable", warnings: [warning] };
}

function safeDisplayPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._+-]/gu, "_").slice(0, 120) || "package";
}

function nugetPackageError(
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
