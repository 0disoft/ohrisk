import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

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

const PUBSPEC_MAX_BYTES = 1024 * 1024;
const PUB_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const PUB_LICENSE_FILE_LIMIT = 50;

export function collectPubPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  pubspecMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findPubPackageDir({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Dart pub package source was not found in .dart_tool/package_config.json or a local Pub cache."]
    });
  }

  const pubspec = readPubspec({
    pubspecPath: path.join(packageDir, "pubspec.yaml"),
    packageId: input.packageId,
    maxBytes: input.pubspecMaxBytes ?? PUBSPEC_MAX_BYTES
  });

  if (!pubspec.ok) {
    return err(pubspec.error);
  }

  const warnings: string[] = [];
  const files = readPubEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? PUB_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Dart pub package source.");
  }

  const metadataLicense = pubspec.value?.license;
  if (!metadataLicense) {
    warnings.push("Dart pubspec.yaml did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadataLicense ? { metadataLicense, metadataSource: "pubspec.yaml" } : {}),
    files,
    source: "local",
    warnings
  });
}

function findPubPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const packageConfigDir = findPackageConfigPackageDir(input);
  if (packageConfigDir) {
    return packageConfigDir;
  }

  const packageDirName = `${input.packageName}-${input.version}`;
  for (const cacheRoot of pubCacheRoots(input.projectRoot)) {
    for (const hostedRoot of ["pub.dev", "pub.dartlang.org"]) {
      const candidate = path.resolve(cacheRoot, "hosted", hostedRoot, packageDirName);
      const hostedDir = path.resolve(cacheRoot, "hosted", hostedRoot);
      if (
        isPathInside(hostedDir, candidate)
        && existsSync(candidate)
        && isReadableDirectory(candidate)
      ) {
        return candidate;
      }
    }
  }

  return undefined;
}

function findPackageConfigPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const packageConfigPath = path.join(input.projectRoot, ".dart_tool", "package_config.json");
  if (!existsSync(packageConfigPath)) {
    return undefined;
  }

  const text = readTextFileWithLimit({
    filePath: packageConfigPath,
    maxBytes: PUBSPEC_MAX_BYTES
  });
  if (!text.ok) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
    return undefined;
  }

  for (const item of parsed.packages) {
    if (!isRecord(item) || item.name !== input.packageName || typeof item.rootUri !== "string") {
      continue;
    }

    const candidate = resolvePackageConfigRootUri({
      rootUri: item.rootUri,
      projectRoot: input.projectRoot
    });
    if (
      candidate
      && path.basename(candidate) === `${input.packageName}-${input.version}`
      && existsSync(candidate)
      && isReadableDirectory(candidate)
    ) {
      return candidate;
    }
  }

  return undefined;
}

function resolvePackageConfigRootUri(input: {
  rootUri: string;
  projectRoot: string;
}): string | undefined {
  try {
    if (input.rootUri.startsWith("file:")) {
      return fileURLToPath(input.rootUri);
    }
  } catch {
    return undefined;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.rootUri)) {
    return undefined;
  }

  return path.resolve(input.projectRoot, ".dart_tool", input.rootUri);
}

function pubCacheRoots(projectRoot: string): string[] {
  const roots = [
    path.join(projectRoot, ".pub-cache")
  ];

  const pubCache = process.env.PUB_CACHE;
  if (pubCache) {
    roots.push(pubCache);
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".pub-cache"));
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    roots.push(path.join(localAppData, "Pub", "Cache"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function readPubspec(input: {
  pubspecPath: string;
  packageId: string;
  maxBytes: number;
}): Result<{ license?: string } | undefined, OhriskError> {
  if (!existsSync(input.pubspecPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.pubspecPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: pubspecReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          pubspecPath: input.pubspecPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text.value);
  } catch {
    return ok(undefined);
  }

  if (!isRecord(parsed) || typeof parsed.license !== "string" || parsed.license.trim() === "") {
    return ok(undefined);
  }

  return ok({
    license: parsed.license.trim()
  });
}

function readPubEvidenceFiles(input: {
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

    if (files.length >= PUB_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Dart pub package evidence file limit reached at ${PUB_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Dart pub evidence file ${candidate.relativePath}: ${pubEvidenceReadError(text.error)}.`);
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
  try {
    return readdirSync(packageDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        absolutePath: path.join(packageDir, entry.name),
        relativePath: entry.name
      }));
  } catch {
    return [];
  }
}

function pubspecReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Dart pubspec.yaml metadata exceeded the maximum supported size."
    : "Failed to read Dart pubspec.yaml metadata.";
}

function pubEvidenceReadError(error: TextFileReadError): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
