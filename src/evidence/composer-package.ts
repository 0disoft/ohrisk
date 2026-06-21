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

const COMPOSER_JSON_MAX_BYTES = 1024 * 1024;
const COMPOSER_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;

export function collectComposerPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  composerJsonMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const vendorRoot = path.resolve(input.projectRoot, "vendor");
  const packageDir = composerPackageDir({
    vendorRoot,
    packageName: input.packageName
  });

  if (!existsSync(packageDir) || !isReadableDirectory(packageDir)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Composer package source was not found in the local vendor directory."]
    });
  }

  const packageJson = readComposerPackageJson({
    packageId: input.packageId,
    composerJsonPath: path.join(packageDir, "composer.json"),
    maxBytes: input.composerJsonMaxBytes ?? COMPOSER_JSON_MAX_BYTES
  });

  if (!packageJson.ok) {
    return err(packageJson.error);
  }

  const warnings: string[] = [];
  const files = readComposerEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? COMPOSER_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Composer package source.");
  }

  if (packageJson.value.license === undefined) {
    warnings.push("Composer package composer.json did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(typeof packageJson.value.license === "string"
      ? {
          metadataLicense: packageJson.value.license,
          metadataSource: "composer.json"
        }
      : {}),
    ...(Array.isArray(packageJson.value.license)
      ? {
          metadataLicenses: packageJson.value.license,
          metadataSource: "composer.json"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function composerPackageDir(input: {
  vendorRoot: string;
  packageName: string;
}): string {
  const segments = input.packageName.split("/");
  if (
    segments.length !== 2
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return path.join(input.vendorRoot, ".ohrisk-invalid-composer-package");
  }

  const packageDir = path.resolve(input.vendorRoot, ...segments);
  return isPathInside(input.vendorRoot, packageDir)
    ? packageDir
    : path.join(input.vendorRoot, ".ohrisk-invalid-composer-package");
}

function readComposerPackageJson(input: {
  packageId: string;
  composerJsonPath: string;
  maxBytes: number;
}): Result<{ license?: unknown }, OhriskError> {
  if (!existsSync(input.composerJsonPath)) {
    return ok({});
  }

  const text = readTextFileWithLimit({
    filePath: input.composerJsonPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "Composer package metadata exceeded the maximum supported size."
          : "Failed to read Composer package metadata.",
        details: {
          packageId: input.packageId,
          composerJsonPath: input.composerJsonPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  try {
    const parsed = JSON.parse(text.value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "license" in parsed) {
      return ok({ license: (parsed as { license?: unknown }).license });
    }

    return ok({});
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        message: "Composer package metadata was not valid JSON.",
        details: {
          packageId: input.packageId,
          composerJsonPath: input.composerJsonPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readComposerEvidenceFiles(input: {
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

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}
