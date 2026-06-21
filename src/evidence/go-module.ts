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

const GO_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const GO_LICENSE_FILE_LIMIT = 50;

export function collectGoModuleEvidence(input: {
  packageId: string;
  modulePath: string;
  version: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const moduleDir = findGoModuleDir({
    projectRoot: input.projectRoot,
    modulePath: input.modulePath,
    version: input.version
  });

  if (!moduleDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Go module source was not found in a local Go module cache."
      ]
    });
  }

  const warnings: string[] = [];
  const files = readGoEvidenceFiles({
    moduleDir,
    maxBytes: input.evidenceFileMaxBytes ?? GO_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Go module source.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function findGoModuleDir(input: {
  projectRoot: string;
  modulePath: string;
  version: string;
}): string | undefined {
  const escapedModulePath = encodeGoModuleCachePath(input.modulePath);
  const relativeModulePath = `${escapedModulePath}@${input.version}`;

  for (const moduleCacheRoot of goModuleCacheRoots(input.projectRoot)) {
    const candidate = path.join(moduleCacheRoot, ...relativeModulePath.split("/"));
    if (existsSync(candidate) && isReadableDirectory(candidate)) {
      return candidate;
    }
  }

  const vendorCandidate = path.join(input.projectRoot, "vendor", ...input.modulePath.split("/"));
  if (existsSync(vendorCandidate) && isReadableDirectory(vendorCandidate)) {
    return vendorCandidate;
  }

  return undefined;
}

function goModuleCacheRoots(projectRoot: string): string[] {
  const roots = [
    path.join(projectRoot, "pkg", "mod")
  ];

  const goModCache = process.env.GOMODCACHE;
  if (goModCache) {
    roots.push(goModCache);
  }

  for (const goPathRoot of goPathRoots()) {
    roots.push(path.join(goPathRoot, "pkg", "mod"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function goPathRoots(): string[] {
  const goPath = process.env.GOPATH;
  if (goPath) {
    return goPath.split(path.delimiter).filter((entry) => entry.trim() !== "");
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  return home ? [path.join(home, "go")] : [];
}

function readGoEvidenceFiles(input: {
  moduleDir: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const candidate of evidenceFileCandidates(input.moduleDir).slice(0, GO_LICENSE_FILE_LIMIT)) {
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

function encodeGoModuleCachePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
}

function isReadableDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}
