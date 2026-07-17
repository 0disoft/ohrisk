import path from "node:path";

import { readArchiveBytes, type ArchiveFormat, type ArchiveSource } from "../archive/archive-reader";
import { parseSpdxExpression } from "../license/spdx";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import {
  normalizePythonPackageName,
  parsePythonMetadataText,
  readPythonMetadataLicense,
  type PythonMetadata
} from "./python-package";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const PYPI_METADATA_LICENSE_MAX_CHARS = 200;
const PYTHON_DISTRIBUTION_METADATA_MAX_BYTES = 1024 * 1024;
const PYTHON_DISTRIBUTION_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const PYTHON_DISTRIBUTION_LICENSE_FILE_LIMIT = 50;

export type PyPiReleaseArtifact = {
  filename: string;
  url: string;
  sha256: string;
  packageType: "sdist" | "bdist_wheel";
  yanked: boolean;
  size?: number;
};

export type PyPiReleaseMetadata = {
  artifact: PyPiReleaseArtifact;
  metadataLicense?: string;
};

export function parsePyPiReleaseMetadata(input: {
  packageId: string;
  packageName: string;
  version: string;
  registryUrl: string;
  text: string;
}): Result<PyPiReleaseMetadata, OhriskError> {
  let document: unknown;
  try {
    document = JSON.parse(input.text) as unknown;
  } catch (cause) {
    return err(pypiMetadataError(input, "PyPI release metadata was not valid JSON.", {
      cause: cause instanceof Error ? cause.message : String(cause)
    }));
  }

  if (!isRecord(document) || !isRecord(document.info) || !Array.isArray(document.urls)) {
    return err(pypiMetadataError(input, "PyPI release metadata did not have the expected shape."));
  }

  const infoName = document.info.name;
  const infoVersion = document.info.version;
  if (
    typeof infoName !== "string"
    || normalizePythonPackageName(infoName) !== normalizePythonPackageName(input.packageName)
    || typeof infoVersion !== "string"
    || infoVersion !== input.version
  ) {
    return err(pypiMetadataError(input, "PyPI release metadata did not match the requested package identity.", {
      requestedName: input.packageName,
      requestedVersion: input.version,
      ...(typeof infoName === "string" ? { metadataName: infoName } : {}),
      ...(typeof infoVersion === "string" ? { metadataVersion: infoVersion } : {})
    }));
  }

  const artifacts = document.urls
    .map(readPyPiReleaseArtifact)
    .filter((artifact): artifact is PyPiReleaseArtifact => artifact !== undefined)
    .sort(comparePyPiArtifacts);
  const artifact = artifacts[0];
  if (!artifact) {
    return err(pypiMetadataError(
      input,
      "PyPI release metadata did not include a supported distribution with a SHA-256 digest."
    ));
  }

  const metadataLicense = readPythonMetadataLicense({
    licenseExpression: readShortMetadataString(document.info.license_expression),
    license: readShortMetadataString(document.info.license),
    classifiers: readStringArray(document.info.classifiers),
    licenseFiles: readStringArray(document.info.license_files)
  });

  return ok({
    artifact,
    ...(metadataLicense ? { metadataLicense } : {})
  });
}

export function collectPythonDistributionEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  artifactFilename: string;
  artifactBytes: Buffer | Uint8Array;
  artifactMaxBytes: number;
  registryMetadataLicense?: string;
  yanked?: boolean;
}): Result<LicenseEvidence, OhriskError> {
  const format = pythonDistributionArchiveFormat(input.artifactFilename);
  if (!format) {
    return err(createError({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      message: "Python distribution archive format is not supported.",
      details: {
        packageId: input.packageId,
        filename: safeArtifactFilename(input.artifactFilename)
      }
    }));
  }

  const archive = readArchiveBytes({
    displayName: safeArtifactFilename(input.artifactFilename),
    bytes: input.artifactBytes,
    formatHint: format,
    limits: { inputBytes: input.artifactMaxBytes }
  });
  if (!archive.ok) {
    return err(archive.error);
  }

  const metadata = findDistributionMetadata({
    packageId: input.packageId,
    packageName: input.packageName,
    version: input.version,
    archive: archive.value,
    packageType: format === "zip" && input.artifactFilename.toLowerCase().endsWith(".whl")
      ? "bdist_wheel"
      : "sdist"
  });
  if (!metadata.ok) {
    return err(metadata.error);
  }

  const warnings: string[] = [];
  const files = collectDistributionEvidenceFiles({
    archive: archive.value,
    metadataPath: metadata.value.path,
    metadata: metadata.value.metadata,
    warnings
  });

  const artifactMetadataLicense = readPythonMetadataLicense(metadata.value.metadata);
  const selectedMetadata = selectMetadataLicense({
    artifactLicense: artifactMetadataLicense,
    artifactSource: metadata.value.path,
    registryLicense: input.registryMetadataLicense
  });
  warnings.push(...selectedMetadata.warnings);
  if (input.yanked) {
    warnings.push("The selected PyPI distribution is yanked, but it was retained because the dependency pins this exact version.");
  }
  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in the Python distribution.");
  }
  if (!selectedMetadata.license) {
    warnings.push(
      "Python distribution metadata did not declare License-Expression, License, or a recognized license classifier."
    );
  }

  return ok({
    packageId: input.packageId,
    ...(selectedMetadata.license && selectedMetadata.source
      ? { metadataLicense: selectedMetadata.license, metadataSource: selectedMetadata.source }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

function selectMetadataLicense(input: {
  artifactLicense: string | undefined;
  artifactSource: string;
  registryLicense: string | undefined;
}): { license?: string; source?: string; warnings: string[] } {
  if (!input.artifactLicense) {
    return input.registryLicense
      ? { license: input.registryLicense, source: "PyPI release metadata", warnings: [] }
      : { warnings: [] };
  }
  if (!input.registryLicense) {
    return { license: input.artifactLicense, source: input.artifactSource, warnings: [] };
  }
  if (input.artifactLicense === input.registryLicense) {
    return { license: input.artifactLicense, source: input.artifactSource, warnings: [] };
  }

  const artifactMalformed = parseSpdxExpression(input.artifactLicense).malformed;
  const registryMalformed = parseSpdxExpression(input.registryLicense).malformed;
  if (artifactMalformed && !registryMalformed) {
    return {
      license: input.registryLicense,
      source: "PyPI release metadata",
      warnings: [
        "Distribution metadata contained a malformed license value; the valid PyPI release metadata license was preferred."
      ]
    };
  }

  return {
    license: input.artifactLicense,
    source: input.artifactSource,
    warnings: [
      "PyPI release metadata license did not match the distribution metadata; the verified distribution metadata was preferred."
    ]
  };
}

export function pythonDistributionArchiveFormat(filename: string): ArchiveFormat | undefined {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".whl") || normalized.endsWith(".zip")) {
    return "zip";
  }
  if (normalized.endsWith(".tar.gz") || normalized.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (normalized.endsWith(".tar")) {
    return "tar";
  }
  return undefined;
}

function readPyPiReleaseArtifact(value: unknown): PyPiReleaseArtifact | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const filename = value.filename;
  const url = value.url;
  const packageType = value.packagetype;
  const sha256 = isRecord(value.digests) ? value.digests.sha256 : undefined;
  if (
    typeof filename !== "string"
    || filename === ""
    || filename.includes("/")
    || filename.includes("\\")
    || !pythonDistributionArchiveFormat(filename)
    || typeof url !== "string"
    || url === ""
    || !isOfficialPyPiArtifactUrl(url)
    || (packageType !== "sdist" && packageType !== "bdist_wheel")
    || typeof sha256 !== "string"
    || !/^[a-f0-9]{64}$/iu.test(sha256)
  ) {
    return undefined;
  }

  const size = typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0
    ? value.size
    : undefined;
  return {
    filename,
    url,
    sha256: sha256.toLowerCase(),
    packageType,
    yanked: value.yanked === true,
    ...(size !== undefined ? { size } : {})
  };
}

function isOfficialPyPiArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "files.pythonhosted.org"
      && url.port === ""
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

function comparePyPiArtifacts(left: PyPiReleaseArtifact, right: PyPiReleaseArtifact): number {
  return Number(left.yanked) - Number(right.yanked)
    || artifactTypeRank(left.packageType) - artifactTypeRank(right.packageType)
    || left.filename.localeCompare(right.filename);
}

function artifactTypeRank(packageType: PyPiReleaseArtifact["packageType"]): number {
  return packageType === "bdist_wheel" ? 0 : 1;
}

function findDistributionMetadata(input: {
  packageId: string;
  packageName: string;
  version: string;
  archive: ArchiveSource;
  packageType: PyPiReleaseArtifact["packageType"];
}): Result<{ path: string; metadata: PythonMetadata }, OhriskError> {
  const candidates = input.archive.entries
    .filter((entry) => entry.type === "file" && isMetadataPath(entry.path, input.packageType))
    .sort((left, right) => metadataPathRank(left.path) - metadataPathRank(right.path)
      || left.path.localeCompare(right.path));

  for (const candidate of candidates) {
    const text = input.archive.readText(candidate.path, PYTHON_DISTRIBUTION_METADATA_MAX_BYTES);
    if (!text.ok) {
      return err(text.error);
    }
    const metadata = parsePythonMetadataText(text.value);
    if (
      normalizePythonPackageName(metadata.name ?? "") === normalizePythonPackageName(input.packageName)
      && metadata.version === input.version
    ) {
      return ok({ path: candidate.path, metadata });
    }
  }

  return err(createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Python distribution metadata did not match the requested package identity.",
    details: {
      packageId: input.packageId,
      requestedName: input.packageName,
      requestedVersion: input.version,
      metadataCandidates: candidates.length
    }
  }));
}

function isMetadataPath(entryPath: string, packageType: PyPiReleaseArtifact["packageType"]): boolean {
  const normalized = entryPath.toLowerCase();
  return packageType === "bdist_wheel"
    ? /(?:^|\/)[^/]+\.dist-info\/metadata$/u.test(normalized)
    : /(?:^|\/)pkg-info$/u.test(normalized);
}

function metadataPathRank(entryPath: string): number {
  const segments = entryPath.split("/").length;
  return entryPath.toLowerCase().endsWith(".dist-info/metadata") ? segments : segments * 10;
}

function collectDistributionEvidenceFiles(input: {
  archive: ArchiveSource;
  metadataPath: string;
  metadata: PythonMetadata;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const packageRoot = distributionPackageRoot(input.metadataPath);
  const metadataDir = archiveDirname(input.metadataPath);
  const declaredPaths = declaredLicensePaths(packageRoot, metadataDir, input.metadata.licenseFiles);
  const candidates = input.archive.entries
    .filter((entry) => entry.type === "file")
    .filter((entry) => isDistributionEvidencePath({
      entryPath: entry.path,
      packageRoot,
      metadataDir,
      declaredPaths
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, PYTHON_DISTRIBUTION_LICENSE_FILE_LIMIT);

  const files: LicenseEvidenceFile[] = [];
  for (const candidate of candidates) {
    if (candidate.size > PYTHON_DISTRIBUTION_EVIDENCE_FILE_MAX_BYTES) {
      input.warnings.push(
        `Skipped ${candidate.path}: evidence file exceeded the maximum supported size.`
      );
      continue;
    }
    const text = input.archive.readText(candidate.path, PYTHON_DISTRIBUTION_EVIDENCE_FILE_MAX_BYTES);
    if (!text.ok) {
      input.warnings.push(`Failed to read ${candidate.path}: ${text.error.message}`);
      continue;
    }
    files.push({
      path: relativeEvidencePath(candidate.path, packageRoot),
      kind: classifyEvidenceFile(candidate.path) ?? "license",
      text: text.value
    });
  }
  return files;
}

function isDistributionEvidencePath(input: {
  entryPath: string;
  packageRoot: string;
  metadataDir: string;
  declaredPaths: ReadonlySet<string>;
}): boolean {
  if (input.declaredPaths.has(input.entryPath)) {
    return true;
  }

  if (
    input.metadataDir.toLowerCase().endsWith(".dist-info")
    && input.entryPath.startsWith(`${input.metadataDir}/licenses/`)
  ) {
    return true;
  }

  const relative = relativeEvidencePath(input.entryPath, input.packageRoot);
  return !relative.includes("/") && classifyEvidenceFile(relative) !== undefined;
}

function declaredLicensePaths(
  packageRoot: string,
  metadataDir: string,
  licenseFiles: string[]
): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const licenseFile of licenseFiles) {
    const normalized = licenseFile.replace(/\\/gu, "/").replace(/^\.\//u, "");
    if (!isSafeRelativeArchivePath(normalized)) {
      continue;
    }
    declared.add(joinArchivePath(packageRoot, normalized));
    if (metadataDir.toLowerCase().endsWith(".dist-info")) {
      declared.add(joinArchivePath(`${metadataDir}/licenses`, normalized));
    }
  }
  return declared;
}

function distributionPackageRoot(metadataPath: string): string {
  const segments = metadataPath.split("/");
  if (!metadataPath.toLowerCase().endsWith("/pkg-info") || segments.length <= 1) {
    return "";
  }
  const metadataDir = segments.at(-2)?.toLowerCase();
  return metadataDir?.endsWith(".egg-info")
    ? segments.slice(0, -2).join("/")
    : segments.slice(0, -1).join("/");
}

function relativeEvidencePath(entryPath: string, packageRoot: string): string {
  return packageRoot && entryPath.startsWith(`${packageRoot}/`)
    ? entryPath.slice(packageRoot.length + 1)
    : entryPath;
}

function archiveDirname(entryPath: string): string {
  const dirname = path.posix.dirname(entryPath);
  return dirname === "." ? "" : dirname;
}

function joinArchivePath(left: string, right: string): string {
  return left ? `${left}/${right}` : right;
}

function isSafeRelativeArchivePath(value: string): boolean {
  return value !== ""
    && !value.startsWith("/")
    && !value.endsWith("/")
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function pypiMetadataError(
  input: { packageId: string; registryUrl: string },
  message: string,
  details: Record<string, unknown> = {}
): OhriskError {
  return createError({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    category: "unsupported_input",
    message,
    details: {
      packageId: input.packageId,
      registryUrl: input.registryUrl,
      ...details
    }
  });
}

function readShortMetadataString(value: unknown): string | undefined {
  return typeof value === "string"
    && value.trim() !== ""
    && value.length <= PYPI_METADATA_LICENSE_MAX_CHARS
    && !value.includes("\n")
    ? value.trim()
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeArtifactFilename(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  return normalized.split("/").pop() || "python-distribution";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
