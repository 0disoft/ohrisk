import { omitUndefined } from "../shared/object";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType, PackageEcosystem } from "./types";

type CondaPackageRecord = {
  id: string;
  name: string;
  version: string;
  ecosystem: "conda" | "pypi";
  manager: "conda" | "pip";
  platform?: string;
  url?: string;
  dependencies: string[];
  dependencyType: DependencyType;
};

export function parseCondaLockfile(
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
        code: "CONDA_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "conda-lock.yml exceeded the maximum supported size."
          : "Failed to read conda-lock.yml.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseCondaLockText(lockfileText.value, lockfilePath);
}

export function parseCondaLockText(
  input: string,
  lockfilePath = "conda-lock.yml"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (cause) {
    return err(
      createError({
        code: "CONDA_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse conda-lock.yml.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readCondaPackageRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = readRootName(parsed, lockfilePath);
  return ok({
    rootName,
    lockfilePath,
    nodes: buildCondaNodes({
      rootName,
      records: records.value
    })
  });
}

function readCondaPackageRecords(
  parsed: unknown,
  lockfilePath: string
): Result<CondaPackageRecord[], OhriskError> {
  if (!isRecord(parsed) || !Array.isArray(parsed.package)) {
    return err(
      createError({
        code: "CONDA_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse conda-lock.yml. Ohrisk expected a package array.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const records: CondaPackageRecord[] = [];
  for (const [index, item] of parsed.package.entries()) {
    if (!isRecord(item)) {
      return condaPackageParseError({ lockfilePath, index, reason: "package_not_object" });
    }

    const name = readRequiredString(item.name);
    const version = readRequiredString(item.version);
    const manager = readManager(item.manager);
    if (!name || !version || !manager) {
      return condaPackageParseError({ lockfilePath, index, reason: "missing_package_identity" });
    }

    const ecosystem = ecosystemForCondaManager(manager);
    records.push(omitUndefined({
      id: packageIdForCondaRecord({
        ecosystem,
        name,
        version
      }),
      name,
      version,
      ecosystem,
      manager,
      platform: readOptionalString(item.platform),
      url: readOptionalString(item.url),
      dependencies: readDependencyNames(item.dependencies),
      dependencyType: dependencyTypeForCondaPackage(item)
    }));
  }

  if (records.length === 0) {
    return err(
      createError({
        code: "CONDA_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse conda-lock.yml. Ohrisk expected at least one package entry.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok(records);
}

function buildCondaNodes(input: {
  rootName: string;
  records: CondaPackageRecord[];
}): DependencyNode[] {
  const nodeMap = new Map<string, DependencyNode>();
  const referenced = new Set<string>();

  for (const record of input.records) {
    for (const dependency of record.dependencies) {
      const resolved = resolveCondaDependency({
        records: input.records,
        record,
        dependency
      });
      if (resolved) {
        referenced.add(resolved.id);
      }
    }
  }

  const roots = input.records.filter((record) => !referenced.has(record.id));
  const graphRoots = roots.length > 0 ? roots : input.records;

  for (const record of graphRoots) {
    walkCondaDependency({
      record,
      records: input.records,
      nodeMap,
      path: [rootLabel(input.rootName, record), record.id],
      direct: true,
      inheritedDependencyType: record.dependencyType,
      seen: new Set()
    });
  }

  return [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function walkCondaDependency(input: {
  record: CondaPackageRecord;
  records: CondaPackageRecord[];
  nodeMap: Map<string, DependencyNode>;
  path: string[];
  direct: boolean;
  inheritedDependencyType: DependencyType;
  seen: Set<string>;
}): void {
  const dependencyType = mergeDependencyType(
    input.record.dependencyType,
    input.inheritedDependencyType
  );

  const existing = input.nodeMap.get(input.record.id);
  input.nodeMap.set(input.record.id, existing
    ? {
        ...existing,
        direct: existing.direct || input.direct,
        dependencyType: mergeDependencyType(existing.dependencyType, dependencyType),
        paths: appendUniquePath(existing.paths, input.path)
      }
    : {
        id: input.record.id,
        name: input.record.name,
        version: input.record.version,
        ecosystem: input.record.ecosystem,
        ...(input.record.url ? { resolved: input.record.url } : {}),
        dependencyType,
        direct: input.direct,
        paths: [input.path]
      });

  if (input.seen.has(input.record.id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.id);
  for (const dependency of input.record.dependencies) {
    const child = resolveCondaDependency({
      records: input.records,
      record: input.record,
      dependency
    });
    if (!child) {
      continue;
    }

    walkCondaDependency({
      record: child,
      records: input.records,
      nodeMap: input.nodeMap,
      path: [...input.path, child.id],
      direct: false,
      inheritedDependencyType: dependencyType,
      seen: nextSeen
    });
  }
}

function resolveCondaDependency(input: {
  records: CondaPackageRecord[];
  record: CondaPackageRecord;
  dependency: string;
}): CondaPackageRecord | undefined {
  const candidates = input.records.filter((candidate) =>
    normalizeCondaName(candidate.name) === normalizeCondaName(input.dependency)
    && candidate.platform === input.record.platform
  );
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.find((candidate) => candidate.manager === input.record.manager)
    ?? candidates[0];
}

function readDependencyNames(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value)
    .map((name) => name.trim())
    .filter((name) => name !== "" && !name.startsWith("__"))
    .sort((left, right) => left.localeCompare(right));
}

function dependencyTypeForCondaPackage(item: Record<string, unknown>): DependencyType {
  const category = readOptionalString(item.category)?.toLowerCase();
  if (category === "dev" || category === "develop" || category === "development") {
    return "development";
  }

  if (item.optional === true) {
    return "optional";
  }

  return "production";
}

function ecosystemForCondaManager(manager: "conda" | "pip"): "conda" | "pypi" {
  return manager === "pip" ? "pypi" : "conda";
}

function packageIdForCondaRecord(input: {
  ecosystem: PackageEcosystem;
  name: string;
  version: string;
}): string {
  return `${input.ecosystem}:${input.name}@${input.version}`;
}

function rootLabel(rootName: string, record: CondaPackageRecord): string {
  return record.platform ? `${rootName}:${record.platform}` : rootName;
}

function readRootName(parsed: unknown, lockfilePath: string): string {
  if (isRecord(parsed) && isRecord(parsed.metadata) && Array.isArray(parsed.metadata.sources)) {
    const firstSource = parsed.metadata.sources.find((source) =>
      typeof source === "string" && source.trim() !== ""
    );
    if (typeof firstSource === "string") {
      return path.basename(firstSource, path.extname(firstSource)) || "<conda-project>";
    }
  }

  return path.basename(path.dirname(lockfilePath)) || "<conda-project>";
}

function readManager(value: unknown): "conda" | "pip" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "conda" || normalized === "pip" ? normalized : undefined;
}

function readRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeCondaName(value: string): string {
  return value.toLowerCase().replace(/[._-]+/g, "-");
}

function appendUniquePath(paths: string[][], pathToAdd: string[]): string[][] {
  return paths.some((candidate) => pathsEqual(candidate, pathToAdd))
    ? paths
    : [...paths, pathToAdd];
}

function pathsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
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

function condaPackageParseError(input: {
  lockfilePath: string;
  index: number;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "CONDA_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse conda-lock.yml package entry. Ohrisk requires package entries with name, version, and manager fields.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
