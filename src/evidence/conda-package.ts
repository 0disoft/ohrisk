import { omitUndefined } from "../shared/object";
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

type CondaPackageIndex = {
  name?: string;
  version?: string;
  license?: string;
  licenseFamily?: string;
};

const CONDA_INDEX_MAX_BYTES = 1024 * 1024;
const CONDA_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const CONDA_EVIDENCE_FILE_LIMIT = 50;

export function collectCondaPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  resolved?: string;
  projectRoot: string;
  indexMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findCondaPackageDir(omitUndefined({
    packageName: input.packageName,
    version: input.version,
    resolved: input.resolved,
    projectRoot: input.projectRoot
  }));

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Conda package source was not found in local conda package cache directories."]
    });
  }

  const packageIndex = readCondaPackageIndex({
    indexPath: path.join(packageDir, "info", "index.json"),
    packageId: input.packageId,
    maxBytes: input.indexMaxBytes ?? CONDA_INDEX_MAX_BYTES
  });
  if (!packageIndex.ok) {
    return err(packageIndex.error);
  }

  const warnings: string[] = [];
  const files = readCondaEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? CONDA_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Conda package source.");
  }

  const metadataLicense = readCondaMetadataLicense(packageIndex.value);
  if (!metadataLicense) {
    warnings.push("Conda info/index.json did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadataLicense ? { metadataLicense, metadataSource: "info/index.json" } : {}),
    files,
    source: "local",
    warnings
  });
}

function findCondaPackageDir(input: {
  packageName: string;
  version: string;
  resolved?: string;
  projectRoot: string;
}): string | undefined {
  const exactDirName = condaPackageDirNameFromUrl(input.resolved);
  for (const cacheRoot of condaPackageCacheRoots(input.projectRoot)) {
    if (exactDirName) {
      const exactCandidate = path.join(cacheRoot, exactDirName);
      if (isReadableDirectory(exactCandidate)) {
        return exactCandidate;
      }
    }

    const prefix = `${input.packageName}-${input.version}-`;
    for (const entry of readDirectoryEntries(cacheRoot)) {
      if (
        entry.isDirectory()
        && entry.name.startsWith(prefix)
        && isReadableDirectory(path.join(cacheRoot, entry.name))
      ) {
        return path.join(cacheRoot, entry.name);
      }
    }
  }

  return undefined;
}

function condaPackageCacheRoots(projectRoot: string): string[] {
  const roots = [
    path.join(projectRoot, ".conda", "pkgs"),
    path.join(projectRoot, "pkgs")
  ];

  const explicitCacheRoots = process.env.CONDA_PKGS_DIRS;
  if (explicitCacheRoots) {
    roots.push(...explicitCacheRoots.split(path.delimiter));
  }

  const condaPrefix = process.env.CONDA_PREFIX;
  if (condaPrefix) {
    roots.push(path.resolve(condaPrefix, "..", "pkgs"));
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".conda", "pkgs"));
    roots.push(path.join(home, "miniconda3", "pkgs"));
    roots.push(path.join(home, "anaconda3", "pkgs"));
    roots.push(path.join(home, "mambaforge", "pkgs"));
    roots.push(path.join(home, "miniforge3", "pkgs"));
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    roots.push(path.join(localAppData, "conda", "conda", "pkgs"));
  }

  return [...new Set(
    roots
      .filter((root) => root.trim() !== "")
      .map((root) => path.resolve(root))
  )].filter(isReadableDirectory);
}

function condaPackageDirNameFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let basename = value;
  try {
    basename = path.posix.basename(new URL(value).pathname);
  } catch {
    basename = path.basename(value);
  }

  const withoutExtension = basename.endsWith(".tar.bz2")
    ? basename.slice(0, -".tar.bz2".length)
    : basename.endsWith(".conda")
      ? basename.slice(0, -".conda".length)
      : undefined;

  return withoutExtension && withoutExtension.includes("-") ? withoutExtension : undefined;
}

function readCondaPackageIndex(input: {
  indexPath: string;
  packageId: string;
  maxBytes: number;
}): Result<CondaPackageIndex | undefined, OhriskError> {
  if (!existsSync(input.indexPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.indexPath,
    maxBytes: input.maxBytes
  });
  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: condaIndexReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          indexPath: input.indexPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    return ok(undefined);
  }

  if (!isRecord(parsed)) {
    return ok(undefined);
  }

  return ok(omitUndefined({
    name: readString(parsed.name),
    version: readString(parsed.version),
    license: readString(parsed.license),
    licenseFamily: readString(parsed.license_family)
  }));
}

function readCondaEvidenceFiles(input: {
  packageDir: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const candidate of evidenceFileCandidates(input.packageDir)) {
    const kind = classifyEvidenceFile(candidate.relativePath);
    if (!kind) {
      continue;
    }

    if (files.length >= CONDA_EVIDENCE_FILE_LIMIT) {
      input.warnings.push(`Conda package evidence file limit reached at ${CONDA_EVIDENCE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Conda evidence file ${candidate.relativePath}: ${condaEvidenceReadError(text.error)}.`);
      continue;
    }

    files.push({
      path: candidate.relativePath,
      kind,
      text: text.value
    });
  }

  return files;
}

function evidenceFileCandidates(packageDir: string): Array<{ absolutePath: string; relativePath: string }> {
  const candidates: Array<{ absolutePath: string; relativePath: string }> = [];
  const roots = [packageDir, path.join(packageDir, "info"), path.join(packageDir, "info", "licenses")];

  for (const root of roots) {
    for (const entry of readDirectoryEntries(root)) {
      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = path.join(root, entry.name);
      candidates.push({
        absolutePath,
        relativePath: path.relative(packageDir, absolutePath).replace(/\\/g, "/")
      });
    }
  }

  return candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readCondaMetadataLicense(index: CondaPackageIndex | undefined): string | undefined {
  return index?.license ?? index?.licenseFamily;
}

function condaIndexReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Conda info/index.json metadata exceeded the maximum supported size."
    : "Failed to read Conda info/index.json metadata.";
}

function condaEvidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "filesystem":
      return error.cause;
  }
}

function readDirectoryEntries(pathname: string): Dirent<string>[] {
  try {
    return readdirSync(pathname, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
