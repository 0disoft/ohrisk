import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PylockPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencies: PylockDependencyRef[];
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
  dependencies: PylockDependencyRef[];
};

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

  return parsePylockText(lockfileText.value, lockfilePath);
}

export function parsePylockText(
  input: string,
  lockfilePath = "pylock.toml"
): Result<DependencyGraph, OhriskError> {
  try {
    const records = parsePylockPackageRecords(input);
    if (records.length === 0) {
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

    return ok({
      rootName,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
    });
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

function parsePylockPackageRecords(input: string): PylockPackageRecord[] {
  const records: PylockPackageRecord[] = [];
  let current: PartialPylockPackageRecord | undefined;
  let currentDependency: PartialPylockDependencyRef | undefined;
  let currentTable: "packages" | "packages.dependencies" | "other" = "other";
  let activeDependencyArray: string[] | undefined;

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
      current.dependencies.push({
        name: currentDependency.name,
        version: currentDependency.version
      });
    }

    currentDependency = undefined;
  };

  const flushCurrent = (): void => {
    flushDependencyArray();
    flushCurrentDependency();
    if (!current) {
      return;
    }

    if (current.name && current.version) {
      records.push({
        name: current.name,
        version: current.version,
        id: `${current.name}@${current.version}`,
        dependencies: current.dependencies
      });
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
  }

  flushCurrent();

  return records;
}

function readDependencyRefsFromInlineTableArray(value: string): PylockDependencyRef[] {
  const refs: PylockDependencyRef[] = [];
  for (const match of value.matchAll(/\{([^}]*)\}/g)) {
    const table = match[1] ?? "";
    const name = readStringAssignment(table.trim(), "name");
    if (!name) {
      continue;
    }

    refs.push({
      name,
      version: readStringAssignment(table.trim(), "version")
    });
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
