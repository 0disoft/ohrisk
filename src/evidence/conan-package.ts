import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
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

const CONANFILE_PY_MAX_BYTES = 1024 * 1024;
const CONAN_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const CONAN_LICENSE_FILE_LIMIT = 50;
const CONAN_SOURCE_ROOT_LIMIT = 20;

export function collectConanPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  conanfileMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const sourceRoots = findConanPackageSourceRoots({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (sourceRoots.length === 0) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Conan package source was not found in local Conan cache directories."]
    });
  }

  const conanfileLicenses = readFirstConanfileLicenses({
    packageId: input.packageId,
    sourceRoots,
    maxBytes: input.conanfileMaxBytes ?? CONANFILE_PY_MAX_BYTES
  });
  if (!conanfileLicenses.ok) {
    return err(conanfileLicenses.error);
  }

  const warnings: string[] = [];
  const files = readConanEvidenceFiles({
    sourceRoots,
    maxBytes: input.evidenceFileMaxBytes ?? CONAN_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Conan package source.");
  }

  if (!conanfileLicenses.value || conanfileLicenses.value.length === 0) {
    warnings.push("Conan package conanfile.py did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(conanfileLicenses.value && conanfileLicenses.value.length === 1
      ? {
          metadataLicense: conanfileLicenses.value[0],
          metadataSource: "conanfile.py"
        }
      : {}),
    ...(conanfileLicenses.value && conanfileLicenses.value.length > 1
      ? {
          metadataLicenses: conanfileLicenses.value,
          metadataSource: "conanfile.py"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findConanPackageSourceRoots(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string[] {
  const roots: string[] = [];

  for (const cacheRoot of conanDataRoots(input.projectRoot)) {
    for (const sourceRoot of sourceRootsForConanDataRoot({
      cacheRoot,
      packageName: input.packageName,
      version: input.version
    })) {
      if (!roots.includes(sourceRoot)) {
        roots.push(sourceRoot);
      }

      if (roots.length >= CONAN_SOURCE_ROOT_LIMIT) {
        return roots;
      }
    }
  }

  return roots;
}

function conanDataRoots(projectRoot: string): string[] {
  const candidates = [
    path.resolve(projectRoot, ".conan", "data"),
    path.resolve(os.homedir(), ".conan", "data")
  ];
  return [...new Set(candidates)].filter((candidate) => isReadableDirectory(candidate));
}

function sourceRootsForConanDataRoot(input: {
  cacheRoot: string;
  packageName: string;
  version: string;
}): string[] {
  const packageName = conanCachePackageName(input.packageName);
  if (!packageName) {
    return [];
  }

  const packageDir = path.resolve(input.cacheRoot, packageName, input.version);
  if (!isPathInside(input.cacheRoot, packageDir) || !isReadableDirectory(packageDir)) {
    return [];
  }

  const roots: string[] = [];
  for (const userDir of childDirectories(packageDir)) {
    for (const channelDir of childDirectories(userDir)) {
      for (const childName of ["export", "source"]) {
        const sourceRoot = path.resolve(channelDir, childName);
        if (
          isPathInside(input.cacheRoot, sourceRoot)
          && isReadableDirectory(sourceRoot)
        ) {
          roots.push(sourceRoot);
        }
      }
    }
  }

  return roots.sort();
}

function conanCachePackageName(packageName: string): string | undefined {
  const normalized = packageName.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return /^[A-Za-z0-9_.+~-]+$/.test(basename) ? basename : undefined;
}

function childDirectories(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.resolve(parent, entry.name))
      .filter((candidate) => isPathInside(parent, candidate) && isReadableDirectory(candidate))
      .sort();
  } catch {
    return [];
  }
}

function readFirstConanfileLicenses(input: {
  packageId: string;
  sourceRoots: string[];
  maxBytes: number;
}): Result<string[] | undefined, OhriskError> {
  for (const sourceRoot of input.sourceRoots) {
    const conanfilePath = path.join(sourceRoot, "conanfile.py");
    if (!existsSync(conanfilePath)) {
      continue;
    }

    const text = readTextFileWithLimit({
      filePath: conanfilePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      return err(
        createError({
          code: "PACKAGE_EVIDENCE_READ_FAILED",
          category: textFileReadErrorCategory(text.error),
          message: text.error.kind === "too_large"
            ? "Conan conanfile.py metadata exceeded the maximum supported size."
            : "Failed to read Conan conanfile.py metadata.",
          details: {
            packageId: input.packageId,
            conanfilePath,
            ...textFileReadErrorDetails(text.error)
          }
        })
      );
    }

    const licenses = parseConanfilePyLicenses(text.value);
    if (licenses && licenses.length > 0) {
      return ok(licenses);
    }
  }

  return ok(undefined);
}

function parseConanfilePyLicenses(text: string): string[] | undefined {
  const singleMatch = text.match(/^\s*license\s*=\s*["']([^"']+)["']/m);
  if (singleMatch?.[1]) {
    return [singleMatch[1].trim()].filter((value) => value !== "");
  }

  const listMatch = text.match(/^\s*license\s*=\s*[\[(]([\s\S]*?)[\])]/m);
  if (!listMatch?.[1]) {
    return undefined;
  }

  const values = [...listMatch[1].matchAll(/["']([^"']+)["']/g)]
    .map((match) => match[1]?.trim())
    .filter((item): item is string => item !== undefined && item !== "");

  return values.length > 0 ? values : undefined;
}

function readConanEvidenceFiles(input: {
  sourceRoots: string[];
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files = new Map<string, LicenseEvidenceFile>();

  for (const sourceRoot of input.sourceRoots) {
    for (const candidate of evidenceFileCandidates(sourceRoot)) {
      const kind = classifyEvidenceFile(candidate.relativePath);
      if (!kind || files.has(candidate.relativePath)) {
        continue;
      }

      if (files.size >= CONAN_LICENSE_FILE_LIMIT) {
        input.warnings.push(`Conan package evidence file limit reached at ${CONAN_LICENSE_FILE_LIMIT} files.`);
        return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
      }

      const text = readTextFileWithLimit({
        filePath: candidate.absolutePath,
        maxBytes: input.maxBytes
      });

      if (!text.ok) {
        input.warnings.push(`Skipped Conan evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
        continue;
      }

      files.set(candidate.relativePath, {
        path: candidate.relativePath,
        kind,
        text: text.value
      });
    }
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function evidenceFileCandidates(dir: string): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        absolutePath: path.join(dir, entry.name),
        relativePath: entry.name
      }));
  } catch {
    return [];
  }
}

function evidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "read_failed":
      return error.cause;
  }
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
