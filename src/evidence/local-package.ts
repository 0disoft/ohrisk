import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

export function collectLocalPackageEvidence(input: {
  packageId: string;
  packageDir: string;
}): Result<LicenseEvidence, OhriskError> {
  const warnings: string[] = [];
  const packageJsonPath = path.join(input.packageDir, "package.json");

  try {
    if (!existsSync(input.packageDir) || !statSync(input.packageDir).isDirectory()) {
      return err(
        createError({
          code: "PACKAGE_EVIDENCE_READ_FAILED",
          category: "filesystem",
          message: "Package evidence path is not a readable directory.",
          details: {
            packageId: input.packageId,
            packageDir: input.packageDir
          }
        })
      );
    }

    const packageJson = readPackageJson(packageJsonPath, input.packageId);
    if (!packageJson.ok) {
      return packageJson;
    }

    const files = readEvidenceFiles(input.packageDir, warnings);

    if (files.length === 0) {
      warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found.");
    }

    return ok({
      packageId: input.packageId,
      ...readLicenseFields(packageJson.value),
      files,
      source: "local",
      warnings
    });
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read local package evidence.",
        details: {
          packageId: input.packageId,
          packageDir: input.packageDir,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readPackageJson(
  packageJsonPath: string,
  packageId: string
): Result<Record<string, unknown>, OhriskError> {
  if (!existsSync(packageJsonPath)) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Package artifact is missing package.json.",
        details: {
          packageId,
          packageJsonPath
        }
      })
    );
  }

  try {
    return ok(JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json from package artifact.",
        details: {
          packageId,
          packageJsonPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readLicenseFields(packageJson: Record<string, unknown>): {
  packageJsonLicense?: string;
  packageJsonLicenses?: unknown;
} {
  const license = packageJson.license;
  const licenses = packageJson.licenses;
  const legacyLicenseObject = isPlainLicenseObject(license) ? license : undefined;

  return {
    ...(typeof license === "string" ? { packageJsonLicense: license } : {}),
    ...(legacyLicenseObject !== undefined ? { packageJsonLicenses: legacyLicenseObject } : {}),
    ...(licenses !== undefined ? { packageJsonLicenses: licenses } : {})
  };
}

function isPlainLicenseObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEvidenceFiles(packageDir: string, warnings: string[]): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const kind = classifyEvidenceFile(entry.name);
    if (!kind) {
      continue;
    }

    const filePath = path.join(packageDir, entry.name);

    try {
      files.push({
        path: entry.name,
        kind,
        text: readFileSync(filePath, "utf8")
      });
    } catch (cause) {
      warnings.push(
        `Failed to read ${entry.name}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}
