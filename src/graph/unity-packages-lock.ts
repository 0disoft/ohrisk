import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type UnityPackageRecord = {
  name: string;
  version: string;
  source?: string;
  resolved?: string;
  direct: boolean;
  dependencies: string[];
  id: string;
};

export function parseUnityPackagesLockfile(
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
        code: "UNITY_PACKAGES_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Packages/packages-lock.json exceeded the maximum supported size."
          : "Failed to read Packages/packages-lock.json.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseUnityPackagesLockText(lockfileText.value, lockfilePath);
}

export function parseUnityPackagesLockText(
  input: string,
  lockfilePath = path.join("Packages", "packages-lock.json")
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    return err(
      createError({
        code: "UNITY_PACKAGES_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Packages/packages-lock.json as JSON.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readUnityPackageRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = unityProjectName(lockfilePath);
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "unity",
        ...(record.resolved ? { resolved: record.resolved } : {}),
        dependencyType: "production",
        direct: record.direct,
        paths: packagePaths({
          record,
          records: records.value,
          rootName
        })
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readUnityPackageRecords(
  parsed: unknown,
  lockfilePath: string
): Result<UnityPackageRecord[], OhriskError> {
  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
    return unityPackagesLockShapeError({
      lockfilePath,
      reason: "missing_dependencies_object"
    });
  }

  const records = new Map<string, UnityPackageRecord>();
  for (const [packageName, value] of Object.entries(parsed.dependencies)) {
    if (!isUnityPackageName(packageName) || !isRecord(value)) {
      return unityPackagesLockShapeError({
        lockfilePath,
        packageName,
        reason: "invalid_package_entry"
      });
    }

    const source = typeof value.source === "string" ? value.source.trim().toLowerCase() : undefined;
    if (source === "builtin") {
      continue;
    }

    const version = typeof value.version === "string" ? value.version.trim() : "";
    if (version === "") {
      return unityPackagesLockShapeError({
        lockfilePath,
        packageName,
        reason: "missing_version"
      });
    }

    const dependencies = unityDependencyNames(value.dependencies, lockfilePath, packageName);
    if (!dependencies.ok) {
      return dependencies;
    }

    const direct = typeof value.depth === "number"
      ? value.depth === 0
      : dependencies.value.length === 0;
    const url = typeof value.url === "string" && value.url.trim() !== ""
      ? value.url.trim()
      : undefined;
    const id = `${packageName}@${version}`;
    records.set(id, {
      name: packageName,
      version,
      ...(source ? { source } : {}),
      ...(url ? { resolved: url } : {}),
      direct,
      dependencies: dependencies.value,
      id
    });
  }

  if (records.size === 0) {
    return unityPackagesLockShapeError({
      lockfilePath,
      reason: "no_supported_package_entries"
    });
  }

  return ok([...records.values()]);
}

function unityDependencyNames(
  value: unknown,
  lockfilePath: string,
  packageName: string
): Result<string[], OhriskError> {
  if (value === undefined) {
    return ok([]);
  }

  if (!isRecord(value)) {
    return unityPackagesLockShapeError({
      lockfilePath,
      packageName,
      reason: "dependencies_not_object"
    });
  }

  const dependencies: string[] = [];
  for (const dependencyName of Object.keys(value)) {
    if (!isUnityPackageName(dependencyName)) {
      return unityPackagesLockShapeError({
        lockfilePath,
        packageName,
        dependencyName,
        reason: "invalid_dependency_name"
      });
    }

    dependencies.push(dependencyName);
  }

  return ok(dependencies.sort());
}

function packagePaths(input: {
  record: UnityPackageRecord;
  records: UnityPackageRecord[];
  rootName: string;
  visiting?: Set<string>;
}): string[][] {
  if (input.record.direct) {
    return [[input.rootName, input.record.id]];
  }

  const visiting = input.visiting ?? new Set<string>();
  if (visiting.has(input.record.id)) {
    return [[input.rootName, input.record.id]];
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(input.record.id);
  const parentPaths = input.records
    .filter((candidate) => candidate.dependencies.includes(input.record.name))
    .flatMap((parent) =>
      packagePaths({
        record: parent,
        records: input.records,
        rootName: input.rootName,
        visiting: nextVisiting
      }).map((parentPath) => [...parentPath, input.record.id])
    );

  return parentPaths.length > 0 ? deduplicatePaths(parentPaths) : [[input.rootName, input.record.id]];
}

function deduplicatePaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];
  for (const item of paths) {
    const key = item.join("\0");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function unityProjectName(lockfilePath: string): string {
  const lockfileDir = path.dirname(lockfilePath);
  if (path.basename(lockfileDir).toLowerCase() === "packages") {
    return path.basename(path.dirname(lockfileDir)) || "<unity-project>";
  }

  return path.basename(lockfileDir) || "<unity-project>";
}

function isUnityPackageName(value: string): boolean {
  return value.trim() !== "" && !/[\\/]/.test(value);
}

function unityPackagesLockShapeError(input: {
  lockfilePath: string;
  packageName?: string;
  dependencyName?: string;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "UNITY_PACKAGES_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Packages/packages-lock.json. Ohrisk supports Unity Package Manager lockfiles with a dependencies object.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
