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

type PoetryPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  dependencies: string[];
};

type PartialPoetryPackageRecord = {
  name?: string;
  version?: string;
  category?: string;
  groups: string[];
  optional: boolean;
  dependencies: string[];
};

type PoetryRootDependency = {
  name: string;
  type: DependencyType;
};

export function parsePoetryLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; pyprojectMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "POETRY_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "poetry.lock exceeded the maximum supported size."
          : "Failed to read poetry.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const pyproject = readOptionalPyproject({
    lockfilePath,
    maxBytes: options.pyprojectMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!pyproject.ok) {
    return pyproject;
  }

  return parsePoetryLockText(lockfileText.value, lockfilePath, {
    pyprojectText: pyproject.value
  });
}

export function parsePoetryLockText(
  input: string,
  lockfilePath = "poetry.lock",
  options: { pyprojectText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const records = parsePoetryPackageRecords(input);
    if (records.length === 0) {
      return err(
        createError({
          code: "POETRY_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse poetry.lock. Ohrisk expected at least one [[package]] record.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const rootName = readPyprojectName(options.pyprojectText)
      ?? path.basename(path.dirname(lockfilePath))
      ?? "<root>";
    const rootDependencies = readPoetryRootDependencies({
      pyprojectText: options.pyprojectText,
      records
    });
    const nodeMap = new Map<string, DependencyNode>();

    for (const rootDependency of rootDependencies) {
      const record = resolvePoetryPackageRecord(records, rootDependency.name);
      if (!record) {
        continue;
      }

      walkPoetryDependency({
        record,
        dependencyType: rootDependency.type,
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
  } catch (cause) {
    return err(
      createError({
        code: "POETRY_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse poetry.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readOptionalPyproject(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const pyprojectPath = path.join(path.dirname(input.lockfilePath), "pyproject.toml");
  if (!existsSync(pyprojectPath)) {
    return ok(undefined);
  }

  const pyprojectText = readInputTextFile({
    filePath: pyprojectPath,
    maxBytes: input.maxBytes
  });
  if (!pyprojectText.ok) {
    return err(
      createError({
        code: "PYPROJECT_READ_FAILED",
        category: inputFileReadErrorCategory(pyprojectText.error),
        message: pyprojectText.error.kind === "too_large"
          ? "pyproject.toml exceeded the maximum supported size."
          : "Failed to read pyproject.toml.",
        details: {
          pyprojectPath,
          ...inputFileReadErrorDetails(pyprojectText.error)
        }
      })
    );
  }

  return ok(pyprojectText.value);
}

function parsePoetryPackageRecords(input: string): PoetryPackageRecord[] {
  const records: PoetryPackageRecord[] = [];
  let current: PartialPoetryPackageRecord | undefined;
  let currentTable: "package" | "package.dependencies" | "other" = "other";

  const flushCurrent = (): void => {
    if (!current) {
      return;
    }

    if (!current.name || !current.version) {
      throw new Error("Encountered a [[package]] record without a string name and version.");
    }

    records.push({
      name: current.name,
      version: current.version,
      id: `${current.name}@${current.version}`,
      dependencyType: dependencyTypeForPoetryRecord(current),
      dependencies: current.dependencies
    });
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line === "[[package]]") {
      flushCurrent();
      current = {
        groups: [],
        optional: false,
        dependencies: []
      };
      currentTable = "package";
      continue;
    }

    if (!current) {
      continue;
    }

    if (line === "[package.dependencies]") {
      currentTable = "package.dependencies";
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      currentTable = "other";
      continue;
    }

    if (currentTable === "package") {
      const name = readStringAssignment(line, "name");
      if (name !== undefined) {
        current.name = name;
        continue;
      }

      const version = readStringAssignment(line, "version");
      if (version !== undefined) {
        current.version = version;
        continue;
      }

      const category = readStringAssignment(line, "category");
      if (category !== undefined) {
        current.category = category;
        continue;
      }

      const groups = readStringArrayAssignment(line, "groups");
      if (groups !== undefined) {
        current.groups = groups;
        continue;
      }

      const optional = readBooleanAssignment(line, "optional");
      if (optional !== undefined) {
        current.optional = optional;
        continue;
      }
    }

    if (currentTable === "package.dependencies") {
      const dependencyName = readDependencyKey(line);
      if (dependencyName && normalizePythonPackageName(dependencyName) !== "python") {
        current.dependencies.push(dependencyName);
      }
    }
  }

  flushCurrent();

  return records;
}

function readPoetryRootDependencies(input: {
  pyprojectText?: string;
  records: PoetryPackageRecord[];
}): PoetryRootDependency[] {
  if (input.pyprojectText) {
    const roots = parsePyprojectRootDependencies(input.pyprojectText);
    if (roots.length > 0) {
      return roots;
    }
  }

  return inferPoetryRootDependencies(input.records);
}

function parsePyprojectRootDependencies(input: string): PoetryRootDependency[] {
  const roots = new Map<string, DependencyType>();
  let section = "";
  let activeArray: { type: DependencyType; lines: string[] } | undefined;

  const flushArray = (): void => {
    if (!activeArray) {
      return;
    }

    for (const name of dependencyNamesFromArray(activeArray.lines.join("\n"))) {
      mergeRootDependency(roots, name, activeArray.type);
    }

    activeArray = undefined;
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (activeArray) {
      activeArray.lines.push(line);
      if (line.includes("]")) {
        flushArray();
      }
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      flushArray();
      section = line.slice(1, -1);
      continue;
    }

    if (section === "tool.poetry.dependencies") {
      const dependencyName = readDependencyKey(line);
      if (dependencyName && normalizePythonPackageName(dependencyName) !== "python") {
        mergeRootDependency(roots, dependencyName, "production");
      }
      continue;
    }

    if (
      section === "tool.poetry.dev-dependencies"
      || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)
    ) {
      const dependencyName = readDependencyKey(line);
      if (dependencyName && normalizePythonPackageName(dependencyName) !== "python") {
        mergeRootDependency(roots, dependencyName, "development");
      }
      continue;
    }

    if (section === "project" && line.startsWith("dependencies")) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value.includes("[") && value.includes("]")) {
        for (const name of dependencyNamesFromArray(value)) {
          mergeRootDependency(roots, name, "production");
        }
      } else if (value.startsWith("[")) {
        activeArray = { type: "production", lines: [value] };
      }
      continue;
    }

    if (section === "dependency-groups" && line.includes("=")) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value.includes("[") && value.includes("]")) {
        for (const name of dependencyNamesFromArray(value)) {
          mergeRootDependency(roots, name, "development");
        }
      } else if (value.startsWith("[")) {
        activeArray = { type: "development", lines: [value] };
      }
    }
  }

  flushArray();

  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({ name, type }));
}

function inferPoetryRootDependencies(records: PoetryPackageRecord[]): PoetryRootDependency[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      referenced.add(normalizePythonPackageName(dependency));
    }
  }

  return records
    .filter((record) => !referenced.has(normalizePythonPackageName(record.name)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      name: record.name,
      type: record.dependencyType
    }));
}

function walkPoetryDependency(input: {
  record: PoetryPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: PoetryPackageRecord[];
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
      ecosystem: "pypi",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolvePoetryPackageRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkPoetryDependency({
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

function resolvePoetryPackageRecord(
  records: PoetryPackageRecord[],
  name: string
): PoetryPackageRecord | undefined {
  const normalized = normalizePythonPackageName(name);
  const matches = records.filter((record) =>
    normalizePythonPackageName(record.name) === normalized
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function readPyprojectName(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }

    if (section === "tool.poetry" || section === "project") {
      const name = readStringAssignment(line, "name");
      if (name) {
        return name;
      }
    }
  }

  return undefined;
}

function dependencyTypeForPoetryRecord(record: PartialPoetryPackageRecord): DependencyType {
  if (record.optional) {
    return "optional";
  }

  if (record.category) {
    return record.category === "dev" ? "development" : "production";
  }

  const groups = record.groups.map((group) => group.toLowerCase());
  if (groups.some((group) => group === "main")) {
    return "production";
  }

  if (groups.length > 0) {
    return "development";
  }

  return "unknown";
}

function readStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
}

function readBooleanAssignment(line: string, key: string): boolean | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(true|false)\\b`).exec(line);
  return match ? match[1] === "true" : undefined;
}

function readStringArrayAssignment(line: string, key: string): string[] | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\\[([^\\]]*)\\]`).exec(line);
  if (!match?.[1]) {
    return undefined;
  }

  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((item) => item[1]?.trim())
    .filter((item): item is string => item !== undefined && item.length > 0);
}

function readDependencyKey(line: string): string | undefined {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  return unquoteTomlKey(line.slice(0, separatorIndex).trim());
}

function dependencyNamesFromArray(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(/"([^"]+)"/g)) {
    const name = dependencyNameFromRequirement(match[1] ?? "");
    if (name && normalizePythonPackageName(name) !== "python") {
      names.push(name);
    }
  }

  return names;
}

function dependencyNameFromRequirement(requirement: string): string | undefined {
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?/.exec(requirement.trim());
  return match?.[1];
}

function mergeRootDependency(
  roots: Map<string, DependencyType>,
  rawName: string,
  type: DependencyType
): void {
  const name = dependencyNameFromRequirement(rawName) ?? rawName;
  const existing = roots.get(name);
  roots.set(name, existing ? mergeDependencyType(existing, type) : type);
}

function unquoteTomlKey(key: string): string {
  if ((key.startsWith("\"") && key.endsWith("\"")) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }

  return key;
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
