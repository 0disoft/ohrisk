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

const TERRAFORM_PROVIDER_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const TERRAFORM_PROVIDER_EVIDENCE_FILE_LIMIT = 50;

export function collectTerraformProviderEvidence(input: {
  packageId: string;
  sourceAddress: string;
  version: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const providerRoot = findTerraformProviderRoot({
    sourceAddress: input.sourceAddress,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (!providerRoot) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Terraform provider package was not found in the local .terraform/providers cache."]
    });
  }

  const warnings: string[] = [];
  const files = readEvidenceFilesRecursively({
    rootDir: providerRoot,
    maxBytes: input.evidenceFileMaxBytes ?? TERRAFORM_PROVIDER_EVIDENCE_FILE_MAX_BYTES,
    limit: TERRAFORM_PROVIDER_EVIDENCE_FILE_LIMIT,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Terraform provider cache.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

function findTerraformProviderRoot(input: {
  sourceAddress: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const providerRoot = path.resolve(
    input.projectRoot,
    ".terraform",
    "providers",
    ...input.sourceAddress.split("/"),
    input.version
  );

  return isReadableDirectory(providerRoot) ? providerRoot : undefined;
}

function readEvidenceFilesRecursively(input: {
  rootDir: string;
  maxBytes: number;
  limit: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files = new Map<string, LicenseEvidenceFile>();
  const queue = [input.rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift() as string;
    for (const entry of directoryEntries(currentDir)) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(input.rootDir, absolutePath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const kind = classifyEvidenceFile(relativePath);
      if (!kind || files.has(relativePath)) {
        continue;
      }

      if (files.size >= input.limit) {
        input.warnings.push(`Terraform provider evidence file limit reached at ${input.limit} files.`);
        return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
      }

      const text = readTextFileWithLimit({
        filePath: absolutePath,
        maxBytes: input.maxBytes
      });

      if (!text.ok) {
        input.warnings.push(`Skipped Terraform provider evidence file ${relativePath}: ${evidenceReadError(text.error)}.`);
        continue;
      }

      files.set(relativePath, {
        path: relativePath,
        kind,
        text: text.value
      });
    }
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

function isReadableDirectory(pathname: string): boolean {
  try {
    return existsSync(pathname) && statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}
