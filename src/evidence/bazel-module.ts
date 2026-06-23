import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const BAZEL_REGISTRY_JSON_MAX_BYTES = 64 * 1024;
const BAZEL_SOURCE_JSON_MAX_BYTES = 64 * 1024;
const BAZEL_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const BAZEL_LICENSE_FILE_LIMIT = 50;

export function collectBazelModuleEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  registryJsonMaxBytes?: number;
  sourceJsonMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const sourceDir = findBazelLocalPathSourceDir({
    packageId: input.packageId,
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot,
    registryJsonMaxBytes: input.registryJsonMaxBytes ?? BAZEL_REGISTRY_JSON_MAX_BYTES,
    sourceJsonMaxBytes: input.sourceJsonMaxBytes ?? BAZEL_SOURCE_JSON_MAX_BYTES
  });

  if (!sourceDir.ok) {
    return err(sourceDir.error);
  }

  if (sourceDir.value) {
    const warnings: string[] = [];
    const files = readBazelEvidenceFiles({
      sourceDir: sourceDir.value,
      maxBytes: input.evidenceFileMaxBytes ?? BAZEL_EVIDENCE_FILE_MAX_BYTES,
      warnings
    });

    if (files.length === 0) {
      warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Bazel module source.");
    }

    return ok({
      packageId: input.packageId,
      files,
      source: "local",
      warnings
    });
  }

  return ok({
    packageId: input.packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Bazel module license evidence was not found in local Bazel registry local_path sources. Remote Bazel registry metadata fetching is not supported yet."
    ]
  });
}

function findBazelLocalPathSourceDir(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  registryJsonMaxBytes: number;
  sourceJsonMaxBytes: number;
}): Result<string | undefined, OhriskError> {
  for (const registryRoot of findLocalBazelRegistryRoots(input.projectRoot)) {
    const sourceJsonPath = path.join(
      registryRoot,
      "modules",
      input.packageName,
      input.version,
      "source.json"
    );
    if (!existsSync(sourceJsonPath)) {
      continue;
    }

    const sourceJson = readJsonFile({
      packageId: input.packageId,
      filePath: sourceJsonPath,
      maxBytes: input.sourceJsonMaxBytes,
      label: "Bazel source metadata"
    });
    if (!sourceJson.ok) {
      return err(sourceJson.error);
    }

    if (
      !isRecord(sourceJson.value)
      || sourceJson.value.type !== "local_path"
      || typeof sourceJson.value.path !== "string"
    ) {
      continue;
    }

    const registryJson = readBazelRegistryJson({
      packageId: input.packageId,
      registryRoot,
      maxBytes: input.registryJsonMaxBytes
    });
    if (!registryJson.ok) {
      return err(registryJson.error);
    }

    const sourceDir = resolveBazelLocalPathSourceDir({
      registryRoot,
      moduleBasePath: registryJson.value,
      sourcePath: sourceJson.value.path
    });
    if (sourceDir && isReadableDirectory(sourceDir)) {
      return ok(sourceDir);
    }
  }

  return ok(undefined);
}

function findLocalBazelRegistryRoots(projectRoot: string): string[] {
  const roots = new Set<string>();
  const projectRegistry = path.resolve(projectRoot);
  if (isReadableDirectory(path.join(projectRegistry, "modules"))) {
    roots.add(projectRegistry);
  }

  for (const registry of readBazelrcRegistries(path.join(projectRoot, ".bazelrc"))) {
    if (registry.startsWith("file://")) {
      try {
        const registryRoot = path.resolve(fileURLToPath(registry));
        if (isReadableDirectory(path.join(registryRoot, "modules"))) {
          roots.add(registryRoot);
        }
      } catch {
        continue;
      }
    }
  }

  return [...roots];
}

function readBazelrcRegistries(bazelrcPath: string): string[] {
  if (!existsSync(bazelrcPath)) {
    return [];
  }

  const text = readTextFileWithLimit({
    filePath: bazelrcPath,
    maxBytes: BAZEL_SOURCE_JSON_MAX_BYTES
  });
  if (!text.ok) {
    return [];
  }

  return [...text.value.matchAll(/(?:^|\s)--registry=("[^"]+"|'[^']+'|\S+)/gm)]
    .map((match) => (match[1] ?? "").replace(/^["']|["']$/g, ""))
    .filter((value) => value !== "");
}

function readBazelRegistryJson(input: {
  packageId: string;
  registryRoot: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const registryJsonPath = path.join(input.registryRoot, "bazel_registry.json");
  if (!existsSync(registryJsonPath)) {
    return ok(undefined);
  }

  const registryJson = readJsonFile({
    packageId: input.packageId,
    filePath: registryJsonPath,
    maxBytes: input.maxBytes,
    label: "Bazel registry metadata"
  });
  if (!registryJson.ok) {
    return err(registryJson.error);
  }

  return ok(
    isRecord(registryJson.value) && typeof registryJson.value.module_base_path === "string"
      ? registryJson.value.module_base_path
      : undefined
  );
}

function resolveBazelLocalPathSourceDir(input: {
  registryRoot: string;
  moduleBasePath: string | undefined;
  sourcePath: string;
}): string | undefined {
  if (path.isAbsolute(input.sourcePath)) {
    return path.resolve(input.sourcePath);
  }

  const moduleBasePath = input.moduleBasePath ?? "";
  if (moduleBasePath !== "" && path.isAbsolute(moduleBasePath)) {
    return path.resolve(moduleBasePath, input.sourcePath);
  }

  return path.resolve(input.registryRoot, moduleBasePath, input.sourcePath);
}

function readBazelEvidenceFiles(input: {
  sourceDir: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const entry of readDirectoryEntries(input.sourceDir)) {
    if (!entry.isFile()) {
      continue;
    }

    const kind = classifyEvidenceFile(entry.name);
    if (!kind) {
      continue;
    }

    if (files.length >= BAZEL_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Bazel module evidence file limit reached at ${BAZEL_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: path.join(input.sourceDir, entry.name),
      maxBytes: input.maxBytes
    });
    if (!text.ok) {
      input.warnings.push(`Skipped Bazel evidence file ${entry.name}: ${evidenceReadError(text.error)}.`);
      continue;
    }

    files.push({
      path: entry.name,
      kind,
      text: text.value
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function readJsonFile(input: {
  packageId: string;
  filePath: string;
  maxBytes: number;
  label: string;
}): Result<unknown, OhriskError> {
  const text = readTextFileWithLimit({
    filePath: input.filePath,
    maxBytes: input.maxBytes
  });
  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? `${input.label} exceeded the maximum supported size.`
          : `Failed to read ${input.label}.`,
        details: {
          packageId: input.packageId,
          metadataPath: input.filePath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  try {
    return ok(JSON.parse(text.value) as unknown);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        message: `Failed to parse ${input.label}.`,
        details: {
          packageId: input.packageId,
          metadataPath: input.filePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readDirectoryEntries(dir: string): Dirent[] {
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
    case "read_failed":
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
