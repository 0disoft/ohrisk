import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
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
  resolved?: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const replacement = parseGoReplacementResolved(input.resolved);
  const warnings = replacement.warnings;
  const evidenceModulePath = replacement.modulePath ?? input.modulePath;
  const evidenceVersion = replacement.version ?? input.version;
  const moduleDir = findGoModuleDir({
    projectRoot: input.projectRoot,
    modulePath: evidenceModulePath,
    version: evidenceVersion,
    localPath: replacement.localPath
  });

  if (!moduleDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        ...warnings,
        replacement.localPath
          ? "Go local replacement source was not found or was outside the project root."
          : "Go module source was not found in a local Go module cache."
      ]
    });
  }

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
  localPath?: string;
}): string | undefined {
  if (input.localPath) {
    return resolveLocalReplacementModuleDir({
      projectRoot: input.projectRoot,
      localPath: input.localPath
    });
  }

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

function parseGoReplacementResolved(resolved: string | undefined): {
  modulePath?: string;
  version?: string;
  localPath?: string;
  warnings: string[];
} {
  if (!resolved) {
    return { warnings: [] };
  }

  if (resolved.startsWith("go-module:")) {
    const specifier = resolved.slice("go-module:".length);
    const versionSeparator = specifier.lastIndexOf("@");
    if (versionSeparator <= 0 || versionSeparator === specifier.length - 1) {
      return {
        warnings: [`Go module replacement specifier was malformed: ${resolved}`]
      };
    }

    const modulePath = specifier.slice(0, versionSeparator);
    const version = specifier.slice(versionSeparator + 1);
    return {
      modulePath,
      version,
      warnings: [`Go replacement evidence was read from ${modulePath}@${version}.`]
    };
  }

  return {
    localPath: resolved,
    warnings: [`Go module uses local replacement path: ${resolved}.`]
  };
}

function resolveLocalReplacementModuleDir(input: {
  projectRoot: string;
  localPath: string;
}): string | undefined {
  const candidate = path.resolve(input.projectRoot, input.localPath);
  const projectRoot = resolveRealPathIfPossible(input.projectRoot);
  const moduleDir = resolveRealPathIfPossible(candidate);

  if (!isPathInsideOrEqual(moduleDir, projectRoot)) {
    return undefined;
  }

  if (!existsSync(moduleDir) || !isReadableDirectory(moduleDir)) {
    return undefined;
  }

  return moduleDir;
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

function resolveRealPathIfPossible(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}
