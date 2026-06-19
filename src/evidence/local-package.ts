import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync
} from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const LOCAL_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const LOCAL_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_TEXT_READ_CHUNK_BYTES = 64 * 1024;

export function collectLocalPackageEvidence(input: {
  packageId: string;
  packageDir: string;
  packageJsonMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const warnings: string[] = [];
  const packageJsonPath = path.join(input.packageDir, "package.json");
  const packageJsonMaxBytes = input.packageJsonMaxBytes ?? LOCAL_PACKAGE_JSON_MAX_BYTES;
  const evidenceFileMaxBytes = input.evidenceFileMaxBytes ?? LOCAL_EVIDENCE_FILE_MAX_BYTES;

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

    const packageJson = readPackageJson({
      packageJsonPath,
      packageId: input.packageId,
      maxBytes: packageJsonMaxBytes
    });
    if (!packageJson.ok) {
      return packageJson;
    }

    const evidenceFiles = readEvidenceFiles({
      packageDir: input.packageDir,
      maxBytes: evidenceFileMaxBytes,
      warnings
    });

    if (!evidenceFiles.foundEvidenceFile) {
      warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found.");
    }

    return ok({
      packageId: input.packageId,
      ...readLicenseFields(packageJson.value),
      files: evidenceFiles.files,
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

function readPackageJson(input: {
  packageJsonPath: string;
  packageId: string;
  maxBytes: number;
}): Result<Record<string, unknown>, OhriskError> {
  const { packageJsonPath, packageId } = input;

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
    const packageJsonText = readTextFileWithLimit({
      filePath: packageJsonPath,
      maxBytes: input.maxBytes
    });

    if (!packageJsonText.ok) {
      return err(
        createError({
          code: "PACKAGE_EVIDENCE_READ_FAILED",
          category: "unsupported_input",
          message: "Package artifact package.json exceeded the maximum supported size.",
          details: {
            packageId,
            packageJsonPath,
            ...readLimitDetails(packageJsonText.error)
          }
        })
      );
    }

    const packageJson = JSON.parse(packageJsonText.value) as unknown;
    if (!isObjectRecord(packageJson)) {
      throw new Error("Expected package.json to contain an object.");
    }

    return ok(packageJson);
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
  const legacyLicenseObject = isObjectRecord(license) ? license : undefined;

  return {
    ...(typeof license === "string" ? { packageJsonLicense: license } : {}),
    ...(legacyLicenseObject !== undefined ? { packageJsonLicenses: legacyLicenseObject } : {}),
    ...(licenses !== undefined ? { packageJsonLicenses: licenses } : {})
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEvidenceFiles(input: {
  packageDir: string;
  maxBytes: number;
  warnings: string[];
}): {
  files: LicenseEvidenceFile[];
  foundEvidenceFile: boolean;
} {
  const files: LicenseEvidenceFile[] = [];
  let foundEvidenceFile = false;

  for (const entry of readdirSync(input.packageDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const kind = classifyEvidenceFile(entry.name);
    if (!kind) {
      continue;
    }

    foundEvidenceFile = true;
    const filePath = path.join(input.packageDir, entry.name);

    try {
      const text = readTextFileWithLimit({
        filePath,
        maxBytes: input.maxBytes
      });

      if (!text.ok) {
        input.warnings.push(oversizedEvidenceFileWarning(entry.name, text.error));
        continue;
      }

      files.push({
        path: entry.name,
        kind,
        text: text.value
      });
    } catch (cause) {
      input.warnings.push(
        `Failed to read ${entry.name}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }

  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    foundEvidenceFile
  };
}

type ReadLimitExceeded = {
  maxBytes: number;
  observedBytes: number;
};

function readTextFileWithLimit(input: {
  filePath: string;
  maxBytes: number;
}): Result<string, ReadLimitExceeded> {
  const stats = statSync(input.filePath);
  if (stats.size > input.maxBytes) {
    return err({
      maxBytes: input.maxBytes,
      observedBytes: stats.size
    });
  }

  const chunks: Buffer[] = [];
  let observedBytes = 0;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(input.filePath, "r");

    while (true) {
      const readSize = Math.min(
        LOCAL_TEXT_READ_CHUNK_BYTES,
        Math.max(1, input.maxBytes + 1 - observedBytes)
      );
      const chunk = Buffer.alloc(readSize);
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        return ok(Buffer.concat(chunks, observedBytes).toString("utf8"));
      }

      observedBytes += bytesRead;
      if (observedBytes > input.maxBytes) {
        return err({
          maxBytes: input.maxBytes,
          observedBytes
        });
      }

      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the primary read or size result.
      }
    }
  }
}

function readLimitDetails(limit: ReadLimitExceeded): Record<string, unknown> {
  return {
    maxBytes: limit.maxBytes,
    observedBytes: limit.observedBytes
  };
}

function oversizedEvidenceFileWarning(fileName: string, limit: ReadLimitExceeded): string {
  return `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${limit.maxBytes}, observedBytes: ${limit.observedBytes}).`;
}
