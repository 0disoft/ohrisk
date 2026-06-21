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

type NugetPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  direct: boolean;
  dependencies: string[];
};

export function parseNugetLockfile(
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
        code: "NUGET_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "packages.lock.json exceeded the maximum supported size."
          : "Failed to read packages.lock.json.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseNugetLockText(lockfileText.value, lockfilePath);
}

export function parseNugetLockText(
  input: string,
  lockfilePath = "packages.lock.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseNugetLockJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<dotnet-project>";
  const records = parsed.value;
  const roots = records.filter((record) => record.direct);
  const nodeMap = new Map<string, DependencyNode>();

  for (const root of roots.length > 0 ? roots : inferNugetRootRecords(records)) {
    walkNugetDependency({
      record: root,
      dependencyType: root.dependencyType,
      direct: true,
      path: [rootName],
      records,
      nodeMap,
      seen: new Set()
    });
  }

  return ok({
    rootName,
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function parseNugetLockJson(
  input: string,
  lockfilePath: string
): Result<NugetPackageRecord[], OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json. Ohrisk expected a dependencies object.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const records = new Map<string, NugetPackageRecord>();
  for (const [targetName, targetDependencies] of Object.entries(parsed.dependencies)) {
    if (!isRecord(targetDependencies)) {
      continue;
    }

    for (const [packageName, value] of Object.entries(targetDependencies)) {
      if (!isRecord(value)) {
        return nugetDependencyParseError(lockfilePath, targetName, packageName);
      }

      const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
      if (type === "project") {
        continue;
      }

      if (typeof value.resolved !== "string" || value.resolved.trim() === "") {
        return nugetDependencyParseError(lockfilePath, targetName, packageName);
      }

      const record = {
        name: packageName,
        version: value.resolved,
        id: `${packageName}@${value.resolved}`,
        dependencyType: "production" as const,
        direct: type === "direct",
        dependencies: readNugetDependencyNames(value.dependencies)
      };
      const existing = records.get(record.id);
      records.set(record.id, existing
        ? {
            ...existing,
            direct: existing.direct || record.direct,
            dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
            dependencies: [...new Set([...existing.dependencies, ...record.dependencies])].sort()
          }
        : record);
    }
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json. Ohrisk expected at least one package dependency.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function readNugetDependencyNames(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function inferNugetRootRecords(records: NugetPackageRecord[]): NugetPackageRecord[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      for (const resolved of resolveNugetPackageRecords(records, dependency)) {
        referenced.add(resolved.id);
      }
    }
  }

  return records
    .filter((record) => !referenced.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function walkNugetDependency(input: {
  record: NugetPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: NugetPackageRecord[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (input.seen.has(input.record.id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.id);
  const nextPath = [...input.path, input.record.id];
  const existing = input.nodeMap.get(input.record.id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "nuget",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const matches = resolveNugetPackageRecords(input.records, dependency);
    if (matches.length !== 1) {
      continue;
    }

    walkNugetDependency({
      record: matches[0] as NugetPackageRecord,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveNugetPackageRecords(records: NugetPackageRecord[], name: string): NugetPackageRecord[] {
  const normalized = name.toLowerCase();
  return records.filter((record) => record.name.toLowerCase() === normalized);
}

function nugetDependencyParseError(
  lockfilePath: string,
  targetName: string,
  packageName: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "NUGET_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse packages.lock.json dependency entry. Ohrisk requires package entries with resolved versions.",
      details: {
        lockfilePath,
        targetName,
        packageName
      }
    })
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
