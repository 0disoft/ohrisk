import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type GradleLockRecord = {
  groupId: string;
  artifactId: string;
  version: string;
  configurations: string[];
  dependencyType: DependencyType;
};

export function parseGradleLockfile(
  lockfilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "GRADLE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "gradle.lockfile exceeded the maximum supported size."
          : "Failed to read gradle.lockfile.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseGradleLockText(lockfileText.value, lockfilePath);
}

export function parseGradleLockText(
  input: string,
  lockfilePath = "gradle.lockfile"
): Result<DependencyGraph, OhriskError> {
  const rootName = path.basename(path.dirname(lockfilePath)) || "<root>";
  const records = new Map<string, GradleLockRecord>();

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("empty=")) {
      continue;
    }

    const parsed = parseGradleLockLine(line);
    if (!parsed) {
      return err(
        createError({
          code: "GRADLE_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse gradle.lockfile dependency entry.",
          details: {
            lockfilePath,
            line: index + 1,
            entry: line
          }
        })
      );
    }

    const id = gradleRecordId(parsed);
    const existing = records.get(id);
    if (!existing) {
      records.set(id, parsed);
      continue;
    }

    existing.configurations = [...new Set([
      ...existing.configurations,
      ...parsed.configurations
    ])].sort();
    existing.dependencyType = mergeDependencyType(existing.dependencyType, parsed.dependencyType);
  }

  return ok({
    rootName,
    lockfilePath,
    nodes: [...records.values()]
      .sort((left, right) => gradleRecordId(left).localeCompare(gradleRecordId(right)))
      .map((record): DependencyNode => {
        const name = `${record.groupId}:${record.artifactId}`;
        const id = `${name}@${record.version}`;
        return {
          id,
          name,
          version: record.version,
          ecosystem: "maven",
          dependencyType: record.dependencyType,
          direct: true,
          paths: [[rootName, id]]
        };
      })
  });
}

function parseGradleLockLine(line: string): GradleLockRecord | undefined {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const coordinates = line.slice(0, separatorIndex).trim();
  const configurations = line.slice(separatorIndex + 1)
    .split(",")
    .map((configuration) => configuration.trim())
    .filter((configuration) => configuration.length > 0);

  const [groupId, artifactId, version, extra] = coordinates.split(":");
  if (!groupId || !artifactId || !version || extra !== undefined) {
    return undefined;
  }

  return {
    groupId,
    artifactId,
    version,
    configurations,
    dependencyType: dependencyTypeForGradleConfigurations(configurations)
  };
}

function dependencyTypeForGradleConfigurations(configurations: string[]): DependencyType {
  const lower = configurations.map((configuration) => configuration.toLowerCase());

  if (lower.some(isProductionGradleConfiguration)) {
    return "production";
  }

  if (lower.some(isDevelopmentGradleConfiguration)) {
    return "development";
  }

  return "unknown";
}

function isProductionGradleConfiguration(configuration: string): boolean {
  return !isDevelopmentGradleConfiguration(configuration)
    && (
      configuration.includes("runtimeclasspath")
      || configuration.includes("compileclasspath")
      || configuration.includes("runtimeelements")
      || configuration.includes("apielements")
      || configuration === "implementation"
      || configuration === "api"
    );
}

function isDevelopmentGradleConfiguration(configuration: string): boolean {
  return configuration.includes("test")
    || configuration.includes("fixture")
    || configuration.includes("checkstyle")
    || configuration.includes("pmd")
    || configuration.includes("detekt")
    || configuration.includes("ktlint")
    || configuration.includes("annotationprocessor");
}

function gradleRecordId(record: GradleLockRecord): string {
  return `${record.groupId}:${record.artifactId}@${record.version}`;
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  return dependencyTypeRank(left) >= dependencyTypeRank(right) ? left : right;
}

function dependencyTypeRank(type: DependencyType): number {
  switch (type) {
    case "production":
      return 4;
    case "optional":
      return 3;
    case "peer":
      return 2;
    case "development":
      return 1;
    case "unknown":
      return 0;
  }
}
