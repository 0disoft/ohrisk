import { existsSync, readdirSync, statSync } from "node:fs";
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

const R_DESCRIPTION_MAX_BYTES = 1024 * 1024;
const R_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const R_PACKAGE_SEARCH_MAX_DEPTH = 6;
const R_PACKAGE_SEARCH_MAX_DIRS = 4000;

type RDescription = {
  packageName?: string;
  version?: string;
  license?: string;
};

export function collectRPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  descriptionMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findRPackageDir({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot,
    descriptionMaxBytes: input.descriptionMaxBytes ?? R_DESCRIPTION_MAX_BYTES
  });

  if (!packageDir.ok) {
    return err(packageDir.error);
  }

  if (!packageDir.value) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["R package source was not found in local renv/library or project library paths."]
    });
  }

  const description = readRDescription({
    packageId: input.packageId,
    descriptionPath: path.join(packageDir.value, "DESCRIPTION"),
    maxBytes: input.descriptionMaxBytes ?? R_DESCRIPTION_MAX_BYTES
  });
  if (!description.ok) {
    return err(description.error);
  }

  const warnings: string[] = [];
  const files = readRPackageEvidenceFiles({
    packageDir: packageDir.value,
    maxBytes: input.evidenceFileMaxBytes ?? R_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in R package source.");
  }

  if (!description.value?.license) {
    warnings.push("R package DESCRIPTION did not declare License metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(description.value?.license
      ? {
          metadataLicense: description.value.license,
          metadataSource: "DESCRIPTION"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findRPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
  descriptionMaxBytes: number;
}): Result<string | undefined, OhriskError> {
  for (const root of rPackageSearchRoots(input.projectRoot)) {
    const found = findRPackageDirUnderRoot({
      root,
      packageName: input.packageName,
      version: input.version,
      descriptionMaxBytes: input.descriptionMaxBytes
    });
    if (!found.ok) {
      return found;
    }

    if (found.value) {
      return ok(found.value);
    }
  }

  return ok(undefined);
}

function rPackageSearchRoots(projectRoot: string): string[] {
  return [
    path.join(projectRoot, "renv", "library"),
    path.join(projectRoot, "library")
  ].map((root) => path.resolve(root));
}

function findRPackageDirUnderRoot(input: {
  root: string;
  packageName: string;
  version: string;
  descriptionMaxBytes: number;
}): Result<string | undefined, OhriskError> {
  if (!existsSync(input.root) || !isReadableDirectory(input.root)) {
    return ok(undefined);
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: input.root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < R_PACKAGE_SEARCH_MAX_DIRS) {
    const item = queue.shift();
    if (!item) {
      continue;
    }

    visited += 1;
    if (path.basename(item.dir) === input.packageName) {
      const description = readRDescription({
        packageId: `${input.packageName}@${input.version}`,
        descriptionPath: path.join(item.dir, "DESCRIPTION"),
        maxBytes: input.descriptionMaxBytes
      });
      if (!description.ok) {
        return err(description.error);
      }

      if (
        description.value?.packageName === input.packageName
        && description.value.version === input.version
      ) {
        return ok(item.dir);
      }
    }

    if (item.depth >= R_PACKAGE_SEARCH_MAX_DEPTH) {
      continue;
    }

    for (const child of childDirectories(item.dir)) {
      queue.push({
        dir: child,
        depth: item.depth + 1
      });
    }
  }

  return ok(undefined);
}

function readRDescription(input: {
  packageId: string;
  descriptionPath: string;
  maxBytes: number;
}): Result<RDescription | undefined, OhriskError> {
  if (!existsSync(input.descriptionPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.descriptionPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "R package DESCRIPTION metadata exceeded the maximum supported size."
          : "Failed to read R package DESCRIPTION metadata.",
        details: {
          packageId: input.packageId,
          descriptionPath: input.descriptionPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  const fields = parseDcfFields(text.value);
  return ok({
    packageName: fields.get("Package"),
    version: fields.get("Version"),
    license: fields.get("License")
  });
}

function parseDcfFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      currentKey = undefined;
      continue;
    }

    if (/^\s/.test(line) && currentKey) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ""} ${line.trim()}`.trim());
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      currentKey = undefined;
      continue;
    }

    currentKey = line.slice(0, separatorIndex);
    fields.set(currentKey, line.slice(separatorIndex + 1).trim());
  }

  return fields;
}

function readRPackageEvidenceFiles(input: {
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

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });
    if (!text.ok) {
      input.warnings.push(evidenceFileReadWarning(candidate.relativePath, text.error));
      continue;
    }

    files.push({
      path: candidate.relativePath,
      kind,
      text: text.value
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function evidenceFileCandidates(dir: string): Array<{ absolutePath: string; relativePath: string }> {
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

function childDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}
