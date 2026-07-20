import { omitUndefined } from "../shared/object";
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

type UvTraversalState = {
  record: UvPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
};

type PartialUvPackageRecord = {
  name?: string;
  version?: string;
  sourcePath?: string;
  remoteVcsCommit?: string;
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

const UV_MAX_PATHS_PER_PACKAGE = 64;

export function parseUvLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; localSourceRootDir?: string } = {}
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
      rootDir: options.localSourceRootDir ?? path.dirname(lockfilePath),
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
    const parsedRecords = parseUvPackageRecords(input, omitUndefined({
      lockfilePath,
      readLocalSourceFile: options.readLocalSourceFile
    }));
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
    const recordIndex = indexUvPackageRecords(records);
    const traversalStates: UvTraversalState[] = [];
    const pathLimitAffected = new Set<string>();

    if (roots.length === 0) {
      for (const record of records) {
        traversalStates.push({
          record,
          dependencyType: "unknown",
          direct: true,
          path: ["<root>"]
        });
      }
    } else {
      for (const root of roots) {
        for (const dependency of root.dependencies) {
          const record = resolveUvPackageRecord(recordIndex, dependency.name);
          if (!record) {
            continue;
          }

          traversalStates.push({
            record,
            dependencyType: dependency.type,
            direct: true,
            path: [root.name]
          });
        }
      }
    }

    walkUvDependencies({
      states: traversalStates,
      recordIndex,
      nodeMap,
      pathLimitAffected
    });

    return ok(omitUndefined({
      rootName: roots[0]?.name,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      diagnostics: pathLimitAffected.size > 0
        ? [{
            code: "dependency_paths_truncated" as const,
            affectedNodeCount: pathLimitAffected.size,
            limit: UV_MAX_PATHS_PER_PACKAGE,
            message: "uv dependency paths were limited."
          }]
        : undefined,
      ...embeddedEvidenceFromUvRecords(records)
    }));
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
          message: unsupportedUvSourceMessage(current.unsupportedSource.reason),
          details: {
            lockfilePath: options.lockfilePath,
            packageName: current.name,
            reason: current.unsupportedSource.reason,
            source: safeUvSourceForErrorDetails(
              current.unsupportedSource.value,
              current.unsupportedSource.reason
            ),
            supportedSourceForms: [
              "locked PyPI package record",
              "project-root-contained local source path",
              "remote VCS source pinned to a full commit"
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
      dependencies: current.dependencies,
      ...(current.remoteVcsCommit
        ? {
            evidence: unavailableRemoteVcsEvidence({
              packageId: `${current.name}@${current.version}`,
              commit: current.remoteVcsCommit
            })
          }
        : {})
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
          } else if (source.remoteVcsCommit) {
            current.remoteVcsCommit = source.remoteVcsCommit;
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
  remoteVcsCommit?: string;
  unsupportedSource?: UnsupportedUvSource;
} | undefined {
  const rawSource = readUvLocalSourceAssignmentValue(line);
  if (rawSource !== undefined) {
    const sourcePath = normalizePythonLocalSourcePathSpec(rawSource, {
      allowBareRelativePath: true
    });
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

  if (remoteSource.sourceKey === "git") {
    const remoteVcsCommit = immutableGitCommitFromUvSource(remoteSource.value);
    if (remoteVcsCommit) {
      return { remoteVcsCommit };
    }
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
    return "unpinned_remote_vcs_source";
  }

  if (path.isAbsolute(source) || source.startsWith("file://")) {
    return "unsupported_absolute_source_path";
  }

  if (/^(?:https?|ssh|git):\/\//i.test(source)) {
    return "unsupported_remote_source";
  }

  return "unsupported_source_entry";
}

function unsupportedUvSourceMessage(reason: string): string {
  if (reason === "unpinned_remote_vcs_source") {
    return "Failed to parse uv.lock package source. Remote VCS records must resolve to a full immutable Git commit; branches, tags, short revisions, and unresolved URLs are not reproducible enough to scan.";
  }

  if (reason === "unsupported_absolute_source_path") {
    return "Failed to parse uv.lock package source. Local source paths must be relative and stay inside the project root.";
  }

  if (reason === "unsupported_remote_source") {
    return "Failed to parse uv.lock package source. Direct remote package URLs are not supported yet; use locked PyPI package records or project-root-contained local source paths.";
  }

  return "Failed to parse uv.lock package source. Use a locked PyPI package record or a project-root-contained local source path.";
}

function immutableGitCommitFromUvSource(value: string): string | undefined {
  const source = value.trim();
  if (
    source.length === 0
    || source.length > 4_096
    || /[\u0000-\u001f\u007f]/.test(source)
    || !/^(?:git\+)?(?:https?|ssh|git):\/\//i.test(source)
  ) {
    return undefined;
  }

  const fragmentIndex = source.lastIndexOf("#");
  if (fragmentIndex < 0 || fragmentIndex === source.length - 1) {
    return undefined;
  }

  const commit = source.slice(fragmentIndex + 1);
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit)
    ? commit.toLowerCase()
    : undefined;
}

function unavailableRemoteVcsEvidence(input: {
  packageId: string;
  commit: string;
}): LicenseEvidence {
  return {
    packageId: input.packageId,
    metadataSource: "uv.lock remote VCS source",
    files: [],
    source: "unavailable",
    warnings: [
      `Remote VCS dependency is pinned to immutable commit ${input.commit}, but Ohrisk does not fetch VCS package evidence. Verify this dependency's license from that commit before approval.`
    ]
  };
}

function safeUvSourceForErrorDetails(value: string, reason: string): string {
  if (reason === "unsupported_absolute_source_path") {
    return "<absolute source path>";
  }

  if (reason !== "unpinned_remote_vcs_source" && reason !== "unsupported_remote_source") {
    return value;
  }

  const trimmed = value.trim();
  const gitPrefix = trimmed.toLowerCase().startsWith("git+") ? "git+" : "";
  const parseable = gitPrefix ? trimmed.slice(gitPrefix.length) : trimmed;
  try {
    const parsed = new URL(parseable);
    if (parsed.username !== "") {
      parsed.username = "redacted";
    }
    if (parsed.password !== "") {
      parsed.password = "redacted";
    }
    parsed.search = "";
    parsed.hash = "";
    return `${gitPrefix}${parsed.toString()}`;
  } catch {
    return "<remote source>";
  }
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

function walkUvDependencies(input: {
  states: UvTraversalState[];
  recordIndex: ReadonlyMap<string, UvPackageRecord[]>;
  nodeMap: Map<string, DependencyNode>;
  pathLimitAffected: Set<string>;
}): void {
  const stack = [...input.states].reverse();
  const pathKeysByNodeId = new Map<string, Set<string>>();
  const expandedPathTypesByNodeId = new Map<string, Set<string>>();

  while (stack.length > 0) {
    const state = stack.pop();
    if (!state || state.path.includes(state.record.id)) {
      continue;
    }

    const nextPath = [...state.path, state.record.id];
    const pathKey = JSON.stringify(nextPath);
    const existing = input.nodeMap.get(state.record.id);
    const previousDependencyType = existing?.dependencyType;
    const mergedDependencyType = previousDependencyType
      ? mergeDependencyType(previousDependencyType, state.dependencyType)
      : state.dependencyType;
    const dependencyTypeStrengthened = previousDependencyType !== undefined
      && mergedDependencyType !== previousDependencyType;

    const node = existing ?? {
      id: state.record.id,
      name: state.record.name,
      version: state.record.version,
      ecosystem: "pypi" as const,
      dependencyType: mergedDependencyType,
      direct: state.direct,
      paths: []
    };
    node.direct = node.direct || state.direct;
    node.dependencyType = mergedDependencyType;
    if (!existing) {
      input.nodeMap.set(state.record.id, node);
    }

    const pathKeys = pathKeysByNodeId.get(state.record.id) ?? new Set<string>();
    let traversalPath: string[] | undefined;
    if (pathKeys.has(pathKey)) {
      traversalPath = dependencyTypeStrengthened ? nextPath : undefined;
    } else if (pathKeys.size < UV_MAX_PATHS_PER_PACKAGE) {
      pathKeys.add(pathKey);
      pathKeysByNodeId.set(state.record.id, pathKeys);
      node.paths.push(nextPath);
      traversalPath = nextPath;
    } else {
      input.pathLimitAffected.add(state.record.id);
      traversalPath = dependencyTypeStrengthened ? node.paths[0] : undefined;
    }

    if (!traversalPath) {
      continue;
    }

    const expansionKey = `${JSON.stringify(traversalPath)}\0${state.dependencyType}`;
    const expandedPathTypes = expandedPathTypesByNodeId.get(state.record.id) ?? new Set<string>();
    if (expandedPathTypes.has(expansionKey)) {
      continue;
    }
    expandedPathTypes.add(expansionKey);
    expandedPathTypesByNodeId.set(state.record.id, expandedPathTypes);

    for (let index = state.record.dependencies.length - 1; index >= 0; index -= 1) {
      const dependency = state.record.dependencies[index];
      if (!dependency) {
        continue;
      }
      const record = resolveUvPackageRecord(input.recordIndex, dependency.name);
      if (!record) {
        continue;
      }

      stack.push({
        record,
        dependencyType: dependencyTypeForChildEdge(state.dependencyType, dependency.type),
        direct: false,
        path: traversalPath
      });
    }
  }
}

function indexUvPackageRecords(
  records: UvPackageRecord[]
): Map<string, UvPackageRecord[]> {
  const byName = new Map<string, UvPackageRecord[]>();
  for (const record of records) {
    if (record.virtual) {
      continue;
    }
    const normalized = normalizePythonPackageName(record.name);
    const matches = byName.get(normalized) ?? [];
    matches.push(record);
    byName.set(normalized, matches);
  }
  return byName;
}

function resolveUvPackageRecord(
  recordIndex: ReadonlyMap<string, UvPackageRecord[]>,
  name: string
): UvPackageRecord | undefined {
  const normalized = normalizePythonPackageName(name);
  const matches = recordIndex.get(normalized) ?? [];

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
