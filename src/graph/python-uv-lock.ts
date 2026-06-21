import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type UvPackageRecord = {
  name: string;
  version: string;
  id: string;
  virtual: boolean;
  dependencies: UvDependencyEdge[];
};

type UvDependencyEdge = {
  name: string;
  type: DependencyType;
};

type PartialUvPackageRecord = {
  name?: string;
  version?: string;
  virtual: boolean;
  dependencies: UvDependencyEdge[];
};

export function parseUvLockfile(
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
        code: "UV_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "uv.lock exceeded the maximum supported size."
          : "Failed to read uv.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseUvLockText(lockfileText.value, lockfilePath);
}

export function parseUvLockText(
  input: string,
  lockfilePath = "uv.lock"
): Result<DependencyGraph, OhriskError> {
  try {
    const records = parseUvPackageRecords(input);
    if (records.length === 0) {
      return err(
        createError({
          code: "UV_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse uv.lock. Ohrisk expected at least one [[package]] record.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const roots = records.filter((record) => record.virtual);
    const nodeMap = new Map<string, DependencyNode>();

    if (roots.length === 0) {
      for (const record of records) {
        walkUvDependency({
          record,
          dependencyType: "unknown",
          direct: true,
          path: ["<root>"],
          records,
          nodeMap,
          seen: new Set()
        });
      }
    } else {
      for (const root of roots) {
        for (const dependency of root.dependencies) {
          const record = resolveUvPackageRecord(records, dependency.name);
          if (!record) {
            continue;
          }

          walkUvDependency({
            record,
            dependencyType: dependency.type,
            direct: true,
            path: [root.name],
            records,
            nodeMap,
            seen: new Set()
          });
        }
      }
    }

    return ok({
      rootName: roots[0]?.name,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
    });
  } catch (cause) {
    return err(
      createError({
        code: "UV_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse uv.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseUvPackageRecords(input: string): UvPackageRecord[] {
  const records: UvPackageRecord[] = [];
  let current: PartialUvPackageRecord | undefined;
  let currentTable: "package" | "dev-dependencies" | "optional-dependencies" | "other" = "other";
  let activeArray: {
    key: string;
    type: DependencyType;
    lines: string[];
  } | undefined;

  const flushActiveArray = (): void => {
    if (!activeArray || !current) {
      activeArray = undefined;
      return;
    }

    for (const dependencyName of readDependencyNamesFromArray(activeArray.lines.join("\n"))) {
      current.dependencies.push({
        name: dependencyName,
        type: activeArray.type
      });
    }

    activeArray = undefined;
  };

  const flushCurrent = (): void => {
    flushActiveArray();
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
      virtual: current.virtual,
      dependencies: current.dependencies
    });
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (activeArray) {
      activeArray.lines.push(line);
      if (line === "]" || line.endsWith("]")) {
        flushActiveArray();
      }
      continue;
    }

    if (line === "[[package]]") {
      flushCurrent();
      current = {
        virtual: false,
        dependencies: []
      };
      currentTable = "package";
      continue;
    }

    if (!current) {
      continue;
    }

    if (line === "[package.dev-dependencies]") {
      currentTable = "dev-dependencies";
      continue;
    }

    if (line === "[package.optional-dependencies]") {
      currentTable = "optional-dependencies";
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

      if (/^source\s*=\s*\{[^}]*\bvirtual\s*=\s*"\."/.test(line)) {
        current.virtual = true;
        continue;
      }
    }

    const arrayDependencyType = dependencyTypeForArray(currentTable, line);
    if (arrayDependencyType) {
      const key = line.slice(0, line.indexOf("=")).trim();
      const value = line.slice(line.indexOf("=") + 1).trim();

      if (value.includes("[") && value.includes("]")) {
        for (const dependencyName of readDependencyNamesFromArray(value)) {
          current.dependencies.push({
            name: dependencyName,
            type: arrayDependencyType
          });
        }
        continue;
      }

      activeArray = {
        key,
        type: arrayDependencyType,
        lines: [value]
      };
    }
  }

  flushCurrent();

  return records;
}

function dependencyTypeForArray(
  currentTable: "package" | "dev-dependencies" | "optional-dependencies" | "other",
  line: string
): DependencyType | undefined {
  if (!line.includes("=") || !line.slice(line.indexOf("=") + 1).trim().startsWith("[")) {
    return undefined;
  }

  if (currentTable === "package" && line.startsWith("dependencies")) {
    return "production";
  }

  if (currentTable === "dev-dependencies") {
    return "development";
  }

  if (currentTable === "optional-dependencies") {
    return "optional";
  }

  return undefined;
}

function readDependencyNamesFromArray(value: string): string[] {
  const names: string[] = [];
  const matches = value.matchAll(/\{\s*name\s*=\s*"([^"]+)"/g);

  for (const match of matches) {
    const name = match[1]?.trim();
    if (name) {
      names.push(name);
    }
  }

  return names;
}

function readStringAssignment(line: string, key: "name" | "version"): string | undefined {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
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

function walkUvDependency(input: {
  record: UvPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: UvPackageRecord[];
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
    const record = resolveUvPackageRecord(input.records, dependency.name);
    if (!record) {
      continue;
    }

    walkUvDependency({
      record,
      dependencyType: dependencyTypeForChildEdge(input.dependencyType, dependency.type),
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveUvPackageRecord(records: UvPackageRecord[], name: string): UvPackageRecord | undefined {
  const normalized = normalizePythonPackageName(name);
  const matches = records.filter((record) =>
    !record.virtual && normalizePythonPackageName(record.name) === normalized
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function dependencyTypeForChildEdge(
  parentType: DependencyType,
  childEdgeType: DependencyType
): DependencyType {
  return parentType === "production" ? childEdgeType : parentType;
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
