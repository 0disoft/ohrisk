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

const CARGO_MANIFEST_MAX_BYTES = 1024 * 1024;
const CARGO_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const CARGO_LICENSE_FILE_LIMIT = 50;

type CargoManifestMetadata = {
  license?: string;
  licenseFile?: string;
};

export function collectCargoPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  manifestMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findCargoPackageDir({
    projectRoot: input.projectRoot,
    packageName: input.packageName,
    version: input.version
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Cargo package source was not found in a local Cargo registry cache."
      ]
    });
  }

  const manifest = readCargoManifestMetadata({
    packageId: input.packageId,
    manifestPath: path.join(packageDir, "Cargo.toml"),
    maxBytes: input.manifestMaxBytes ?? CARGO_MANIFEST_MAX_BYTES
  });

  if (!manifest.ok) {
    return err(manifest.error);
  }

  const warnings: string[] = [];
  const files = readCargoEvidenceFiles({
    packageDir,
    manifest: manifest.value,
    maxBytes: input.evidenceFileMaxBytes ?? CARGO_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Cargo package source.");
  }

  if (!manifest.value.license) {
    warnings.push("Cargo.toml did not declare a package license.");
  }

  return ok({
    packageId: input.packageId,
    ...(manifest.value.license
      ? {
          metadataLicense: manifest.value.license,
          metadataSource: "Cargo.toml"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findCargoPackageDir(input: {
  projectRoot: string;
  packageName: string;
  version: string;
}): string | undefined {
  const crateDirName = `${input.packageName}-${input.version}`;

  for (const registrySourceRoot of cargoRegistrySourceRoots(input.projectRoot)) {
    if (!existsSync(registrySourceRoot) || !isReadableDirectory(registrySourceRoot)) {
      continue;
    }

    let registryDirs;
    try {
      registryDirs = readdirSync(registrySourceRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const registryDir of registryDirs) {
      if (!registryDir.isDirectory()) {
        continue;
      }

      const candidate = path.join(registrySourceRoot, registryDir.name, crateDirName);
      if (existsSync(candidate) && isReadableDirectory(candidate)) {
        return candidate;
      }
    }
  }

  const vendoredCandidate = path.join(input.projectRoot, "vendor", input.packageName);
  if (existsSync(vendoredCandidate) && isReadableDirectory(vendoredCandidate)) {
    return vendoredCandidate;
  }

  return undefined;
}

function cargoRegistrySourceRoots(projectRoot: string): string[] {
  const roots = [
    path.join(projectRoot, ".cargo", "registry", "src")
  ];

  const cargoHome = process.env.CARGO_HOME;
  if (cargoHome) {
    roots.push(path.join(cargoHome, "registry", "src"));
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".cargo", "registry", "src"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function readCargoManifestMetadata(input: {
  packageId: string;
  manifestPath: string;
  maxBytes: number;
}): Result<CargoManifestMetadata, OhriskError> {
  if (!existsSync(input.manifestPath)) {
    return ok({});
  }

  const text = readTextFileWithLimit({
    filePath: input.manifestPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: manifestReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          manifestPath: input.manifestPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseCargoManifestMetadata(text.value));
}

function parseCargoManifestMetadata(text: string): CargoManifestMetadata {
  let section = "";
  const metadata: CargoManifestMetadata = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }

    if (section !== "package") {
      continue;
    }

    const license = readStringAssignment(line, "license");
    if (license !== undefined) {
      metadata.license = license;
      continue;
    }

    const licenseFile = readStringAssignment(line, "license-file");
    if (licenseFile !== undefined) {
      metadata.licenseFile = licenseFile;
    }
  }

  return metadata;
}

function readCargoEvidenceFiles(input: {
  packageDir: string;
  manifest: CargoManifestMetadata;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const candidates = evidenceFileCandidates(input.packageDir);

  if (input.manifest.licenseFile) {
    candidates.unshift({
      absolutePath: path.resolve(input.packageDir, input.manifest.licenseFile),
      relativePath: input.manifest.licenseFile
    });
  }

  const files: LicenseEvidenceFile[] = [];
  const seen = new Set<string>();
  const packageRoot = path.resolve(input.packageDir);

  for (const candidate of candidates.slice(0, CARGO_LICENSE_FILE_LIMIT)) {
    if (seen.has(candidate.absolutePath)) {
      continue;
    }

    seen.add(candidate.absolutePath);
    const kind = classifyEvidenceFile(candidate.relativePath);
    if (!kind || !isPathInside(packageRoot, candidate.absolutePath)) {
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

function readStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}

function isReadableDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function manifestReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Cargo.toml metadata exceeded the maximum supported size."
    : "Failed to read Cargo.toml metadata.";
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
