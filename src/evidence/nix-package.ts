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

const NIX_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const NIX_EVIDENCE_FILE_LIMIT = 50;

export function collectNixPackageEvidence(input: {
  packageId: string;
  resolved: string | undefined;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const sourceRoot = localNixSourceRoot({
    resolved: input.resolved,
    projectRoot: input.projectRoot
  });

  if (!sourceRoot) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Nix flake input source was not found as a local path."]
    });
  }

  const warnings: string[] = [];
  const files = readEvidenceFiles({
    sourceRoot,
    maxBytes: input.evidenceFileMaxBytes ?? NIX_EVIDENCE_FILE_MAX_BYTES,
    limit: NIX_EVIDENCE_FILE_LIMIT,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in local Nix flake input source.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function localNixSourceRoot(input: {
  resolved: string | undefined;
  projectRoot: string;
}): string | undefined {
  if (!input.resolved || looksRemote(input.resolved)) {
    return undefined;
  }

  const candidate = path.resolve(input.projectRoot, input.resolved);
  if (!isPathInside(input.projectRoot, candidate) || !isReadableDirectory(candidate)) {
    return undefined;
  }

  return candidate;
}

function readEvidenceFiles(input: {
  sourceRoot: string;
  maxBytes: number;
  limit: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files = new Map<string, LicenseEvidenceFile>();
  for (const entry of directoryEntries(input.sourceRoot)) {
    if (!entry.isFile()) {
      continue;
    }

    const kind = classifyEvidenceFile(entry.name);
    if (!kind) {
      continue;
    }

    if (files.size >= input.limit) {
      input.warnings.push(`Nix flake input evidence file limit reached at ${input.limit} files.`);
      break;
    }

    const absolutePath = path.join(input.sourceRoot, entry.name);
    const text = readTextFileWithLimit({
      filePath: absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Nix evidence file ${entry.name}: ${evidenceReadError(text.error)}.`);
      continue;
    }

    files.set(entry.name, {
      path: entry.name,
      kind,
      text: text.value
    });
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function directoryEntries(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
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
