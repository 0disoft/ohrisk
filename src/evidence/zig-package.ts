import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  readTextFileWithLimit,
  type TextFileReadError
} from "../shared/read-text-file";
import { ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";
import type { OhriskError } from "../shared/errors";

const ZIG_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ZIG_LICENSE_FILE_LIMIT = 50;

export function collectZigPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  resolved?: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  if (!input.resolved) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Zig package has no resolved URL or path."]
    });
  }

  const localDir = resolveLocalZigPath({
    resolved: input.resolved,
    projectRoot: input.projectRoot
  });

  if (!localDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Zig package source was not found as a local path or was outside the project root."]
    });
  }

  const warnings: string[] = [];
  const files = readZigEvidenceFiles({
    packageDir: localDir,
    maxBytes: input.evidenceFileMaxBytes ?? ZIG_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Zig package source.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function resolveLocalZigPath(input: {
  resolved: string;
  projectRoot: string;
}): string | undefined {
  if (looksRemote(input.resolved)) {
    return undefined;
  }

  const candidate = path.resolve(input.projectRoot, input.resolved);
  if (!isPathInside(input.projectRoot, candidate) || !isReadableDirectory(candidate)) {
    return undefined;
  }

  return candidate;
}

function readZigEvidenceFiles(input: {
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

    if (files.length >= ZIG_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Zig package evidence file limit reached at ${ZIG_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Zig evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
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
  if (!existsSync(dir) || !isReadableDirectory(dir)) {
    return [];
  }

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

function looksRemote(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return existsSync(pathname) && statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
