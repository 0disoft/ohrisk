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

const JULIA_PROJECT_TOML_MAX_BYTES = 1024 * 1024;
const JULIA_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;

type JuliaProjectToml = {
  name?: string;
  version?: string;
  license?: string;
};

export function collectJuliaPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  projectTomlMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findJuliaPackageDir({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot,
    projectTomlMaxBytes: input.projectTomlMaxBytes ?? JULIA_PROJECT_TOML_MAX_BYTES
  });

  if (!packageDir.ok) {
    return err(packageDir.error);
  }

  if (!packageDir.value) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Julia package source was not found in local Julia depot package paths."]
    });
  }

  const projectToml = readJuliaProjectToml({
    packageId: input.packageId,
    projectTomlPath: path.join(packageDir.value, "Project.toml"),
    maxBytes: input.projectTomlMaxBytes ?? JULIA_PROJECT_TOML_MAX_BYTES
  });
  if (!projectToml.ok) {
    return err(projectToml.error);
  }

  const warnings: string[] = [];
  const files = readJuliaEvidenceFiles({
    packageDir: packageDir.value,
    maxBytes: input.evidenceFileMaxBytes ?? JULIA_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Julia package source.");
  }

  if (!projectToml.value?.license) {
    warnings.push("Julia Project.toml did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(projectToml.value?.license
      ? {
          metadataLicense: projectToml.value.license,
          metadataSource: "Project.toml"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findJuliaPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
  projectTomlMaxBytes: number;
}): Result<string | undefined, OhriskError> {
  for (const depotRoot of juliaDepotRoots(input.projectRoot)) {
    const packageRoot = path.resolve(depotRoot, "packages", input.packageName);
    if (!isPathInside(path.resolve(depotRoot, "packages"), packageRoot)) {
      continue;
    }

    if (!existsSync(packageRoot) || !isReadableDirectory(packageRoot)) {
      continue;
    }

    for (const candidate of childDirectories(packageRoot)) {
      const projectToml = readJuliaProjectToml({
        packageId: `${input.packageName}@${input.version}`,
        projectTomlPath: path.join(candidate, "Project.toml"),
        maxBytes: input.projectTomlMaxBytes
      });
      if (!projectToml.ok) {
        return err(projectToml.error);
      }

      if (
        projectToml.value?.name === input.packageName
        && projectToml.value.version === input.version
      ) {
        return ok(candidate);
      }
    }
  }

  return ok(undefined);
}

function juliaDepotRoots(projectRoot: string): string[] {
  const roots = [path.join(projectRoot, ".julia")];

  const juliaDepotPath = process.env.JULIA_DEPOT_PATH;
  if (juliaDepotPath) {
    roots.push(...juliaDepotPath.split(path.delimiter).filter((item) => item.trim() !== ""));
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".julia"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function readJuliaProjectToml(input: {
  packageId: string;
  projectTomlPath: string;
  maxBytes: number;
}): Result<JuliaProjectToml | undefined, OhriskError> {
  if (!existsSync(input.projectTomlPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.projectTomlPath,
    maxBytes: input.maxBytes
  });
  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "Julia Project.toml metadata exceeded the maximum supported size."
          : "Failed to read Julia Project.toml metadata.",
        details: {
          packageId: input.packageId,
          projectTomlPath: input.projectTomlPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseJuliaProjectToml(text.value));
}

function parseJuliaProjectToml(text: string): JuliaProjectToml {
  const fields: JuliaProjectToml = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"((?:\\"|[^"])*)"$/);
    if (!match?.[1] || match[2] === undefined) {
      continue;
    }

    const value = match[2].replace(/\\"/g, "\"");
    if (match[1] === "name") {
      fields.name = value;
    } else if (match[1] === "version") {
      fields.version = value;
    } else if (match[1] === "license") {
      fields.license = value;
    }
  }

  return fields;
}

function readJuliaEvidenceFiles(input: {
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

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
