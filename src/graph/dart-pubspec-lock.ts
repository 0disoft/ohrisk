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
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PubPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  direct: boolean;
};

export function parsePubspecLockfile(
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
        code: "PUBSPEC_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "pubspec.lock exceeded the maximum supported size."
          : "Failed to read pubspec.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parsePubspecLockText(lockfileText.value, lockfilePath);
}

export function parsePubspecLockText(
  input: string,
  lockfilePath = "pubspec.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (cause) {
    return err(
      createError({
        code: "PUBSPEC_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pubspec.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readPubPackageRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<dart-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "pub",
        dependencyType: record.dependencyType,
        direct: record.direct,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readPubPackageRecords(
  parsed: unknown,
  lockfilePath: string
): Result<PubPackageRecord[], OhriskError> {
  if (!isRecord(parsed) || !isRecord(parsed.packages)) {
    return err(
      createError({
        code: "PUBSPEC_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pubspec.lock. Ohrisk expected a packages object.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const records: PubPackageRecord[] = [];
  for (const [packageName, value] of Object.entries(parsed.packages)) {
    if (!isRecord(value)) {
      return pubPackageParseError(lockfilePath, packageName);
    }

    const source = typeof value.source === "string" ? value.source.toLowerCase() : "";
    if (source === "sdk") {
      continue;
    }

    if (typeof value.version !== "string" || value.version.trim() === "") {
      return pubPackageParseError(lockfilePath, packageName);
    }

    const dependency = typeof value.dependency === "string" ? value.dependency.toLowerCase() : "";
    records.push({
      name: packageName,
      version: value.version,
      id: `${packageName}@${value.version}`,
      dependencyType: dependencyTypeForPubDependency(dependency),
      direct: dependency.startsWith("direct")
    });
  }

  if (records.length === 0) {
    return err(
      createError({
        code: "PUBSPEC_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pubspec.lock. Ohrisk expected at least one non-SDK package entry.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok(deduplicatePubRecords(records));
}

function dependencyTypeForPubDependency(dependency: string): DependencyType {
  if (dependency === "direct dev") {
    return "development";
  }

  return "production";
}

function deduplicatePubRecords(records: PubPackageRecord[]): PubPackageRecord[] {
  const merged = new Map<string, PubPackageRecord>();
  for (const record of records) {
    const existing = merged.get(record.id);
    merged.set(record.id, existing
      ? {
          ...existing,
          direct: existing.direct || record.direct,
          dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType)
        }
      : record);
  }

  return [...merged.values()];
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

function pubPackageParseError(
  lockfilePath: string,
  packageName: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "PUBSPEC_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse pubspec.lock package entry. Ohrisk requires package entries with resolved versions.",
      details: {
        lockfilePath,
        packageName
      }
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
