import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  readTextFileWithLimit,
  type TextFileReadError
} from "../shared/read-text-file";
import { ok, type Result } from "../shared/result";
import type { OhriskError } from "../shared/errors";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const CARTHAGE_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const CARTHAGE_LICENSE_FILE_LIMIT = 50;

export function collectCarthagePackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findCarthageCheckoutDir({
    packageName: input.packageName,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Carthage package source was not found in Carthage/Checkouts."]
    });
  }

  const warnings: string[] = [];
  const files = readCarthageEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? CARTHAGE_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Carthage checkout.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function findCarthageCheckoutDir(input: {
  packageName: string;
  projectRoot: string;
}): string | undefined {
  const checkoutName = checkoutNameForCarthagePackage(input.packageName);
  if (!checkoutName) {
    return undefined;
  }

  const checkoutsRoot = path.resolve(input.projectRoot, "Carthage", "Checkouts");
  const exactCandidate = path.resolve(checkoutsRoot, checkoutName);
  if (
    isPathInside(checkoutsRoot, exactCandidate)
    && existsSync(exactCandidate)
    && isReadableDirectory(exactCandidate)
  ) {
    return exactCandidate;
  }

  return findCaseInsensitiveChildDirectory({
    parent: checkoutsRoot,
    childName: checkoutName
  });
}

function checkoutNameForCarthagePackage(packageName: string): string | undefined {
  const normalized = packageName.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const checkoutName = basename.endsWith(".git") ? basename.slice(0, -4) : basename;
  return checkoutName.trim() === "" ? undefined : checkoutName.trim();
}

function findCaseInsensitiveChildDirectory(input: {
  parent: string;
  childName: string;
}): string | undefined {
  if (!existsSync(input.parent) || !isReadableDirectory(input.parent)) {
    return undefined;
  }

  let entries;
  try {
    entries = readdirSync(input.parent, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const normalizedName = input.childName.toLowerCase();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.toLowerCase() !== normalizedName) {
      continue;
    }

    const candidate = path.resolve(input.parent, entry.name);
    if (isPathInside(input.parent, candidate) && isReadableDirectory(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function readCarthageEvidenceFiles(input: {
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

    if (files.length >= CARTHAGE_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Carthage package evidence file limit reached at ${CARTHAGE_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Carthage evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
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
    case "filesystem":
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
