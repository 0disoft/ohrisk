import { omitUndefined } from "../shared/object";
import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  createDiskPythonLocalSourceFileReader,
  readPythonLocalSourcePackage,
  type PythonLocalSourceFileReader
} from "./python-local-source";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type PylockPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencies: PylockDependencyRef[];
  evidence?: LicenseEvidence;
};

type PylockParseRecordsResult = {
  records: PylockPackageRecord[];
  unsupportedSourceTreeRecords: UnsupportedPylockSourceTreeRecord[];
};

type UnsupportedPylockSourceTreeRecord = {
  name?: string;
  path?: string;
};

type PylockDependencyRef = {
  name: string;
  version?: string;
};

type PartialPylockDependencyRef = {
  name?: string;
  version?: string;
};

type PartialPylockPackageRecord = {
  name?: string;
  version?: string;
  directoryPath?: string;
  dependencies: PylockDependencyRef[];
};

type PylockParseOptions = {
  readLocalSourceFile?: PythonLocalSourceFileReader;
};

const PYLOCK_LOCAL_SOURCE_ERRORS = {
  parseCode: "PYLOCK_PARSE_FAILED",
  readCode: "PYLOCK_READ_FAILED",
  displayName: "pylock.toml"
} as const;

export function parsePylockFile(
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
        code: "PYLOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "pylock.toml exceeded the maximum supported size."
          : "Failed to read pylock.toml.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parsePylockText(lockfileText.value, lockfilePath, {
    readLocalSourceFile: createDiskPythonLocalSourceFileReader({
      rootDir: path.dirname(lockfilePath),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES,
      errors: PYLOCK_LOCAL_SOURCE_ERRORS
    })
  });
}

export function parsePylockText(
  input: string,
  lockfilePath = "pylock.toml",
  options: PylockParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const parsedRecords = parsePylockPackageRecords(input, omitUndefined({
      lockfilePath,
      readLocalSourceFile: options.readLocalSourceFile
    }));
    if (!parsedRecords.ok) {
      return parsedRecords;
    }

    const parsed = parsedRecords.value;
    const { records } = parsed;
    if (records.length === 0) {
      if (parsed.unsupportedSourceTreeRecords.length > 0) {
        return err(
          createError({
            code: "PYLOCK_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pylock.toml. Source-tree package records require local source file access.",
            details: {
              lockfilePath,
              reason: "unsupported_unversioned_source_tree_record",
              unsupportedSourceTreePackages: parsed.unsupportedSourceTreeRecords
                .map((record) => record.name)
                .filter((name): name is string => name !== undefined),
              unsupportedSourceTreePaths: parsed.unsupportedSourceTreeRecords
                .map((record) => record.path)
                .filter((path): path is string => path !== undefined)
            }
          })
        );
      }

      return err(
        createError({
          code: "PYLOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse pylock.toml. Ohrisk expected at least one versioned [[packages]] record.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const nodeMap = new Map<string, DependencyNode>();
    const referenced = new Set<string>();
    for (const record of records) {
      for (const dependency of record.dependencies) {
        const resolved = resolvePylockPackageRecord(records, dependency);
        if (resolved) {
          referenced.add(resolved.id);
        }
      }
    }

    const roots = records.filter((record) => !referenced.has(record.id));
    const graphRoots = roots.length > 0 ? roots : records;

    const rootName = readPylockRootName(lockfilePath);
    const rootLabel = rootName ?? "<root>";

    for (const record of graphRoots) {
      walkPylockDependency({
        record,
        direct: true,
        path: [rootLabel],
        records,
        nodeMap,
        seen: new Set()
      });
    }

    return ok(omitUndefined({
      rootName,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ...embeddedEvidenceFromPylockRecords(records)
    }));
  } catch (cause) {
    return err(
      createError({
        code: "PYLOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pylock.toml.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parsePylockPackageRecords(input: string, options: {
  lockfilePath: string;
  readLocalSourceFile?: PythonLocalSourceFileReader;
}): Result<PylockParseRecordsResult, OhriskError> {
  const records: PylockPackageRecord[] = [];
  const unsupportedSourceTreeRecords: UnsupportedPylockSourceTreeRecord[] = [];
  let current: PartialPylockPackageRecord | undefined;
  let currentDependency: PartialPylockDependencyRef | undefined;
  let currentTable: "packages" | "packages.dependencies" | "packages.directory" | "other" = "other";
  let activeDependencyArray: string[] | undefined;
  let parseError: OhriskError | undefined;

  const flushDependencyArray = (): void => {
    if (!activeDependencyArray || !current) {
      activeDependencyArray = undefined;
      return;
    }

    current.dependencies.push(...readDependencyRefsFromInlineTableArray(
      activeDependencyArray.join("\n")
    ));
    activeDependencyArray = undefined;
  };

  const flushCurrentDependency = (): void => {
    if (!currentDependency || !current) {
      currentDependency = undefined;
      return;
    }

    if (currentDependency.name) {
      current.dependencies.push(omitUndefined({
        name: currentDependency.name,
        version: currentDependency.version
      }));
    }

    currentDependency = undefined;
  };

  const flushCurrent = (): void => {
    flushDependencyArray();
    flushCurrentDependency();
    if (!current || parseError) {
      return;
    }

    if (current.name && current.version) {
      records.push({
        name: current.name,
        version: current.version,
        id: `${current.name}@${current.version}`,
        dependencies: current.dependencies
      });
    } else if (current.directoryPath) {
      if (options.readLocalSourceFile) {
        const localSource = readPythonLocalSourcePackage({
          source: omitUndefined({
            sourcePath: current.directoryPath,
            expectedName: current.name
          }),
          fromFilePath: options.lockfilePath,
          readLocalSourceFile: options.readLocalSourceFile,
          errors: PYLOCK_LOCAL_SOURCE_ERRORS
        });
        if (!localSource.ok) {
          parseError = localSource.error;
          return;
        }

        records.push({
          name: localSource.value.name,
          version: localSource.value.version,
          id: localSource.value.id,
          dependencies: current.dependencies,
          evidence: localSource.value.evidence
        });
        return;
      }

      unsupportedSourceTreeRecords.push(omitUndefined({
        name: current.name,
        path: current.directoryPath
      }));
    }
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (activeDependencyArray) {
      activeDependencyArray.push(line);
      if (line.includes("]")) {
        flushDependencyArray();
      }
      continue;
    }

    if (line === "[[packages]]") {
      flushCurrent();
      current = {
        dependencies: []
      };
      currentTable = "packages";
      continue;
    }

    if (line === "[[packages.dependencies]]") {
      if (!current) {
        throw new Error("Encountered [[packages.dependencies]] before [[packages]].");
      }
      flushCurrentDependency();
      currentDependency = {};
      currentTable = "packages.dependencies";
      continue;
    }

    if (line === "[packages.directory]") {
      if (!current) {
        throw new Error("Encountered [packages.directory] before [[packages]].");
      }
      flushCurrentDependency();
      currentTable = "packages.directory";
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      flushCurrentDependency();
      currentTable = "other";
      continue;
    }

    if (!current) {
      continue;
    }

    if (currentTable === "packages") {
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

      if (line.startsWith("dependencies") && line.includes("=")) {
        const value = line.slice(line.indexOf("=") + 1).trim();
        if (value.includes("[") && value.includes("]")) {
          current.dependencies.push(...readDependencyRefsFromInlineTableArray(value));
        } else if (value.startsWith("[")) {
          activeDependencyArray = [value];
        }
        continue;
      }
    }

    if (currentTable === "packages.dependencies") {
      const name = readStringAssignment(line, "name");
      if (name !== undefined) {
        currentDependency = {
          ...currentDependency,
          name
        };
      }

      const version = readStringAssignment(line, "version");
      if (version !== undefined) {
        currentDependency = {
          ...currentDependency,
          version
        };
      }
    }

    if (currentTable === "packages.directory") {
      const path = readStringAssignment(line, "path");
      if (path !== undefined) {
        current.directoryPath = path;
      }
    }
  }

  flushCurrent();
  if (parseError) {
    return err(parseError);
  }

  return ok({
    records,
    unsupportedSourceTreeRecords
  });
}

function readDependencyRefsFromInlineTableArray(value: string): PylockDependencyRef[] {
  const refs: PylockDependencyRef[] = [];
  for (const match of value.matchAll(/\{([^}]*)\}/g)) {
    const table = match[1] ?? "";
    const name = readStringAssignment(table.trim(), "name");
    if (!name) {
      continue;
    }

    refs.push(omitUndefined({
      name,
      version: readStringAssignment(table.trim(), "version")
    }));
  }

  return refs;
}

function walkPylockDependency(input: {
  record: PylockPackageRecord;
  direct: boolean;
  path: string[];
  records: PylockPackageRecord[];
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
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "pypi",
      dependencyType: "unknown",
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolvePylockPackageRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkPylockDependency({
      record,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolvePylockPackageRecord(
  records: PylockPackageRecord[],
  dependency: PylockDependencyRef
): PylockPackageRecord | undefined {
  const normalized = normalizePythonPackageName(dependency.name);
  const matches = records.filter((record) =>
    normalizePythonPackageName(record.name) === normalized
    && (dependency.version === undefined || record.version === dependency.version)
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function embeddedEvidenceFromPylockRecords(records: PylockPackageRecord[]): Pick<DependencyGraph, "embeddedEvidence"> {
  const embeddedEvidence = records
    .map((record) => record.evidence)
    .filter((evidence): evidence is LicenseEvidence => evidence !== undefined)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));

  return embeddedEvidence.length > 0 ? { embeddedEvidence } : {};
}

function readPylockRootName(lockfilePath: string): string | undefined {
  const filename = lockfilePath.split(/[\\/]/).pop() ?? "";
  if (filename.startsWith("pylock.") && filename.endsWith(".toml") && filename !== "pylock.toml") {
    return filename.slice("pylock.".length, -".toml".length);
  }

  return undefined;
}

function readStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|[,\\s])${escapeRegExp(key)}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(line);
  return match?.[2] ?? match?.[3];
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;
  let quote: "\"" | "'" | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote === "\"") {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      inString = quote !== undefined;
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
