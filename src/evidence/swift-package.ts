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

const SWIFT_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const SWIFT_LICENSE_FILE_LIMIT = 50;

export function collectSwiftPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findSwiftPackageDir({
    packageName: input.packageName,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Swift package source was not found in .build/checkouts or SourcePackages/checkouts."
      ]
    });
  }

  const warnings: string[] = [];
  const files = readSwiftEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? SWIFT_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Swift package checkout.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function findSwiftPackageDir(input: {
  packageName: string;
  projectRoot: string;
}): string | undefined {
  for (const checkoutsRoot of swiftCheckoutsRoots(input.projectRoot)) {
    if (!existsSync(checkoutsRoot) || !isReadableDirectory(checkoutsRoot)) {
      continue;
    }

    const exactCandidate = path.resolve(checkoutsRoot, input.packageName);
    if (
      isPathInside(checkoutsRoot, exactCandidate)
      && existsSync(exactCandidate)
      && isReadableDirectory(exactCandidate)
    ) {
      return exactCandidate;
    }

    const caseInsensitiveCandidate = findCaseInsensitiveChildDirectory({
      parent: checkoutsRoot,
      childName: input.packageName
    });
    if (caseInsensitiveCandidate) {
      return caseInsensitiveCandidate;
    }
  }

  return undefined;
}

function swiftCheckoutsRoots(projectRoot: string): string[] {
  return [...new Set([
    path.resolve(projectRoot, ".build", "checkouts"),
    path.resolve(projectRoot, "SourcePackages", "checkouts")
  ])];
}

function findCaseInsensitiveChildDirectory(input: {
  parent: string;
  childName: string;
}): string | undefined {
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

function readSwiftEvidenceFiles(input: {
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

    if (files.length >= SWIFT_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Swift package evidence file limit reached at ${SWIFT_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Swift package evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
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
