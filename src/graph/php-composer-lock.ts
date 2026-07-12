import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
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

type ComposerPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  dependencies: string[];
};

type ComposerRootDependency = {
  name: string;
  type: DependencyType;
};

export function parseComposerLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; composerJsonMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "COMPOSER_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "composer.lock exceeded the maximum supported size."
          : "Failed to read composer.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const manifest = readOptionalComposerJson({
    lockfilePath,
    maxBytes: options.composerJsonMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!manifest.ok) {
    return manifest;
  }

  return parseComposerLockText(lockfileText.value, lockfilePath, omitUndefined({
    composerJsonText: manifest.value
  }));
}

export function parseComposerLockText(
  input: string,
  lockfilePath = "composer.lock",
  options: { composerJsonText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  const parsed = parseComposerLockJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const rootName = readComposerProjectName(options.composerJsonText)
    ?? path.basename(path.dirname(lockfilePath))
    ?? "<composer-project>";
  const rootDependencies = readComposerRootDependencies(omitUndefined({
    composerJsonText: options.composerJsonText,
    records: parsed.value
  }));
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootDependency of rootDependencies) {
    const record = resolveComposerPackageRecord(parsed.value, rootDependency.name);
    if (!record) {
      continue;
    }

    walkComposerDependency({
      record,
      dependencyType: rootDependency.type,
      direct: true,
      path: [rootName],
      records: parsed.value,
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

function readOptionalComposerJson(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const composerJsonPath = path.join(path.dirname(input.lockfilePath), "composer.json");
  if (!existsSync(composerJsonPath)) {
    return ok(undefined);
  }

  const composerJsonText = readInputTextFile({
    filePath: composerJsonPath,
    maxBytes: input.maxBytes
  });
  if (!composerJsonText.ok) {
    return err(
      createError({
        code: "COMPOSER_JSON_READ_FAILED",
        category: inputFileReadErrorCategory(composerJsonText.error),
        message: composerJsonText.error.kind === "too_large"
          ? "composer.json exceeded the maximum supported size."
          : "Failed to read composer.json.",
        details: {
          composerJsonPath,
          ...inputFileReadErrorDetails(composerJsonText.error)
        }
      })
    );
  }

  return ok(composerJsonText.value);
}

function parseComposerLockJson(
  input: string,
  lockfilePath: string
): Result<ComposerPackageRecord[], OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "COMPOSER_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse composer.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed)) {
    return composerLockShapeError(lockfilePath);
  }

  let records: ComposerPackageRecord[];
  try {
    records = [
      ...readComposerPackageRecords(parsed.packages, "production", lockfilePath),
      ...readComposerPackageRecords(parsed["packages-dev"], "development", lockfilePath)
    ];
  } catch (cause) {
    return err(
      createError({
        code: "COMPOSER_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse composer.lock package entries.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (records.length === 0) {
    return composerLockShapeError(lockfilePath);
  }

  return ok(deduplicateComposerRecords(records));
}

function readComposerPackageRecords(
  value: unknown,
  dependencyType: DependencyType,
  lockfilePath: string
): ComposerPackageRecord[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid composer package list in ${lockfilePath}.`);
  }

  return value.map((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.version !== "string") {
      throw new Error(`Invalid composer package entry in ${lockfilePath}.`);
    }

    return {
      name: item.name,
      version: item.version,
      id: `${item.name}@${item.version}`,
      dependencyType,
      dependencies: readComposerDependencyNames(item.require)
    };
  });
}

function readComposerRootDependencies(input: {
  composerJsonText?: string;
  records: ComposerPackageRecord[];
}): ComposerRootDependency[] {
  if (input.composerJsonText) {
    const roots = parseComposerJsonRootDependencies(input.composerJsonText);
    if (roots.length > 0) {
      return roots;
    }
  }

  return inferComposerRootDependencies(input.records);
}

function parseComposerJsonRootDependencies(input: string): ComposerRootDependency[] {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!isRecord(parsed)) {
      return [];
    }

    return [
      ...readComposerRootDependencyObject(parsed.require, "production"),
      ...readComposerRootDependencyObject(parsed["require-dev"], "development")
    ].sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function readComposerProjectName(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

function readComposerRootDependencyObject(
  value: unknown,
  type: DependencyType
): ComposerRootDependency[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value)
    .filter((name) => isComposerPackageName(name))
    .map((name) => ({ name, type }));
}

function readComposerDependencyNames(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).filter(isComposerPackageName).sort();
}

function isComposerPackageName(name: string): boolean {
  return name.includes("/") && !name.startsWith("php/") && !name.startsWith("ext-") && !name.startsWith("lib-");
}

function inferComposerRootDependencies(records: ComposerPackageRecord[]): ComposerRootDependency[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      referenced.add(dependency);
    }
  }

  return records
    .filter((record) => !referenced.has(record.name))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      name: record.name,
      type: record.dependencyType
    }));
}

function walkComposerDependency(input: {
  record: ComposerPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: ComposerPackageRecord[];
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
      ecosystem: "composer",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolveComposerPackageRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkComposerDependency({
      record,
      dependencyType: dependencyTypeForChildEdge(input.dependencyType, record.dependencyType),
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveComposerPackageRecord(
  records: ComposerPackageRecord[],
  name: string
): ComposerPackageRecord | undefined {
  const matches = records.filter((record) => record.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function deduplicateComposerRecords(records: ComposerPackageRecord[]): ComposerPackageRecord[] {
  const seen = new Map<string, ComposerPackageRecord>();
  for (const record of records) {
    const existing = seen.get(record.id);
    seen.set(record.id, existing
      ? {
          ...existing,
          dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
          dependencies: [...new Set([...existing.dependencies, ...record.dependencies])].sort()
        }
      : record);
  }

  return [...seen.values()];
}

function composerLockShapeError(lockfilePath: string): Result<never, OhriskError> {
  return err(
    createError({
      code: "COMPOSER_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse composer.lock. Ohrisk expected packages or packages-dev arrays.",
      details: {
        lockfilePath
      }
    })
  );
}

function dependencyTypeForChildEdge(
  parentType: DependencyType,
  childType: DependencyType
): DependencyType {
  return parentType === "production" ? childType : parentType;
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
