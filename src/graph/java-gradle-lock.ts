import { readdirSync, statSync } from "node:fs";
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
  if (isDirectory(lockfilePath)) {
    return parseGradleDependencyLocksDirectory(lockfilePath, options);
  }

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

function parseGradleDependencyLocksDirectory(
  lockfilePath: string,
  options: { maxBytes?: number }
): Result<DependencyGraph, OhriskError> {
  let entries: string[];
  try {
    entries = readdirSync(lockfilePath)
      .filter((entry) => entry.toLowerCase().endsWith(".lockfile"))
      .filter((entry) => isFile(path.join(lockfilePath, entry)))
      .sort();
  } catch (cause) {
    return err(
      createError({
        code: "GRADLE_LOCK_READ_FAILED",
        category: "filesystem",
        message: "Failed to read Gradle dependency locks directory.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (entries.length === 0) {
    return err(
      createError({
        code: "GRADLE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Gradle dependency locks directory. Ohrisk expected at least one *.lockfile.",
        details: {
          lockfilePath,
          reason: "no_lockfiles"
        }
      })
    );
  }

  const nodeMap = new Map<string, DependencyNode>();
  for (const entry of entries) {
    const filePath = path.join(lockfilePath, entry);
    const graph = parseGradleLockfile(filePath, options);
    if (!graph.ok) {
      return graph;
    }

    mergeGradleGraphNodes(nodeMap, graph.value.nodes);
  }

  const rootName = rootNameForGradleLockfile(lockfilePath);
  return ok({
    rootName,
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

export function parseGradleLockText(
  input: string,
  lockfilePath = "gradle.lockfile"
): Result<DependencyGraph, OhriskError> {
  const rootName = rootNameForGradleLockfile(lockfilePath);
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

function rootNameForGradleLockfile(lockfilePath: string): string {
  const segments = path.normalize(lockfilePath).split(path.sep);
  const isDependencyLockDirectory = segments.length >= 2
    && segments[segments.length - 1] === "dependency-locks"
    && segments[segments.length - 2] === "gradle";
  const isDependencyLockfile = segments.length >= 3
    && segments[segments.length - 1]?.toLowerCase().endsWith(".lockfile") === true
    && segments[segments.length - 2] === "dependency-locks"
    && segments[segments.length - 3] === "gradle";

  if (isDependencyLockDirectory) {
    const projectDir = segments[segments.length - 3];
    return projectDir && projectDir !== "" ? projectDir : "<root>";
  }

  if (isDependencyLockfile) {
    const projectDir = segments[segments.length - 4];
    return projectDir && projectDir !== "" ? projectDir : "<root>";
  }

  return path.basename(path.dirname(lockfilePath)) || "<root>";
}

function mergeGradleGraphNodes(
  nodeMap: Map<string, DependencyNode>,
  nodes: DependencyNode[]
): void {
  for (const node of nodes) {
    const existing = nodeMap.get(node.id);
    if (!existing) {
      nodeMap.set(node.id, { ...node });
      continue;
    }

    existing.dependencyType = mergeDependencyType(existing.dependencyType, node.dependencyType);
    existing.direct = existing.direct || node.direct;
    existing.paths = uniquePaths([...existing.paths, ...node.paths]);
  }
}

function uniquePaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const pathParts of paths) {
    const key = pathParts.join("\0");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(pathParts);
  }

  return unique;
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

function isFile(pathname: string): boolean {
  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function isDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}
