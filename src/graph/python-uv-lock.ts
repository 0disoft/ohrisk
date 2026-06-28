import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  createDiskPythonLocalSourceFileReader,
  normalizePythonLocalSourcePathSpec,
  readPythonLocalSourcePackage,
  type PythonLocalSourceFileReader
} from "./python-local-source";
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
  evidence?: LicenseEvidence;
};

type UvDependencyEdge = {
  name: string;
  type: DependencyType;
};

type PartialUvPackageRecord = {
  name?: string;
  version?: string;
  sourcePath?: string;
  unsupportedSource?: UnsupportedUvSource;
  virtual: boolean;
  dependencies: UvDependencyEdge[];
};

type UnsupportedUvSource = {
  value: string;
  reason: string;
};

type UvLockParseOptions = {
  readLocalSourceFile?: PythonLocalSourceFileReader;
};

const UV_LOCK_LOCAL_SOURCE_ERRORS = {
  parseCode: "UV_LOCK_PARSE_FAILED",
  readCode: "UV_LOCK_READ_FAILED",
  displayName: "uv.lock"
} as const;

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

  return parseUvLockText(lockfileText.value, lockfilePath, {
    readLocalSourceFile: createDiskPythonLocalSourceFileReader({
      rootDir: path.dirname(lockfilePath),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES,
      errors: UV_LOCK_LOCAL_SOURCE_ERRORS
    })
  });
}

export function parseUvLockText(
  input: string,
  lockfilePath = "uv.lock",
  options: UvLockParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const parsedRecords = parseUvPackageRecords(input, {
      lockfilePath,
      readLocalSourceFile: options.readLocalSourceFile
    });
    if (!parsedRecords.ok) {
      return parsedRecords;
    }

    const records = parsedRecords.value;
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
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ...embeddedEvidenceFromUvRecords(records)
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

function parseUvPackageRecords(input: string, options: {
  lockfilePath: string;
  readLocalSourceFile?: PythonLocalSourceFileReader;
}): Result<UvPackageRecord[], OhriskError> {
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

  const flushCurrent = (): Result<void, OhriskError> => {
    flushActiveArray();
    if (!current) {
      return ok(undefined);
    }

    if (!current.name || !current.version) {
      throw new Error("Encountered a [[package]] record without a string name and version.");
    }

    if (current.unsupportedSource) {
      return err(
        createError({
          code: "UV_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse uv.lock package source. Remote VCS package sources are not supported yet; use locked PyPI package records or project-root-contained local source paths.",
          details: {
            lockfilePath: options.lockfilePath,
            packageName: current.name,
            reason: current.unsupportedSource.reason,
            source: current.unsupportedSource.value,
            supportedSourceForms: [
              "locked PyPI package record",
              "project-root-contained local source path"
            ]
          }
        })
      );
    }

    if (current.sourcePath && !current.virtual) {
      const localSource = readPythonLocalSourcePackage({
        source: {
          sourcePath: current.sourcePath,
          expectedName: current.name
        },
        fromFilePath: options.lockfilePath,
        readLocalSourceFile: options.readLocalSourceFile,
        errors: UV_LOCK_LOCAL_SOURCE_ERRORS
      });
      if (!localSource.ok) {
        return localSource;
      }

      records.push({
        name: localSource.value.name,
        version: localSource.value.version,
        id: localSource.value.id,
        virtual: current.virtual,
        dependencies: current.dependencies,
        evidence: localSource.value.evidence
      });
      return ok(undefined);
    }

    records.push({
      name: current.name,
      version: current.version,
      id: `${current.name}@${current.version}`,
      virtual: current.virtual,
      dependencies: current.dependencies
    });

    return ok(undefined);
  };

  try {
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
        const flushed = flushCurrent();
        if (!flushed.ok) {
          return flushed;
        }

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

        const source = readUvSourceAssignment(line);
        if (source !== undefined) {
          if (source.unsupportedSource) {
            current.unsupportedSource = source.unsupportedSource;
          } else if (source.sourcePath) {
            current.sourcePath = source.sourcePath;
            if (source.sourcePath === ".") {
              current.virtual = true;
            }
          }
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

    const flushed = flushCurrent();
    if (!flushed.ok) {
      return flushed;
    }

    return ok(records);
  } catch (cause) {
    return err(
      createError({
        code: "UV_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse uv.lock.",
        details: {
          lockfilePath: options.lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
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

function readUvSourceAssignment(line: string): {
  sourcePath?: string;
  unsupportedSource?: UnsupportedUvSource;
} | undefined {
  const rawSource = readUvLocalSourceAssignmentValue(line);
  if (rawSource !== undefined) {
    const sourcePath = normalizePythonLocalSourcePathSpec(rawSource);
    return sourcePath
      ? { sourcePath }
      : {
          unsupportedSource: {
            value: rawSource,
            reason: classifyUnsupportedPythonSource(rawSource)
          }
        };
  }

  const remoteSource = readUvRemoteSourceAssignment(line);
  if (remoteSource === undefined) {
    return undefined;
  }

  return {
    unsupportedSource: {
      value: remoteSource.value,
      reason: classifyUnsupportedPythonSource(remoteSource.value, remoteSource.sourceKey)
    }
  };
}

function readUvLocalSourceAssignmentValue(line: string): string | undefined {
  if (!/^source\s*=/.test(line)) {
    return undefined;
  }

  return readInlineTableStringValue(line, "editable")
    ?? readInlineTableStringValue(line, "directory");
}

function readUvRemoteSourceAssignment(line: string): { value: string; sourceKey: "git" | "url" } | undefined {
  if (!/^source\s*=/.test(line)) {
    return undefined;
  }

  const git = readInlineTableStringValue(line, "git");
  if (git !== undefined) {
    return { value: git, sourceKey: "git" };
  }

  const url = readInlineTableStringValue(line, "url");
  return url === undefined ? undefined : { value: url, sourceKey: "url" };
}

function readInlineTableStringValue(line: string, key: "editable" | "directory" | "git" | "url"): string | undefined {
  const match = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
}

function classifyUnsupportedPythonSource(value: string, sourceKey?: "git" | "url"): string {
  const source = value.trim();
  if (sourceKey === "git" || /^(?:git|hg|svn|bzr)\+(?:https?|ssh|git):\/\//i.test(source)) {
    return "unsupported_remote_vcs_source";
  }

  if (path.isAbsolute(source) || source.startsWith("file://")) {
    return "unsupported_absolute_source_path";
  }

  if (/^(?:https?|ssh|git):\/\//i.test(source)) {
    return "unsupported_remote_source";
  }

  return "unsupported_source_entry";
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

function embeddedEvidenceFromUvRecords(records: UvPackageRecord[]): Pick<DependencyGraph, "embeddedEvidence"> {
  const embeddedEvidence = records
    .map((record) => record.evidence)
    .filter((evidence): evidence is LicenseEvidence => evidence !== undefined)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));

  return embeddedEvidence.length > 0 ? { embeddedEvidence } : {};
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
