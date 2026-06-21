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

type CargoPackageRecord = {
  name: string;
  version: string;
  id: string;
  source?: string;
  dependencies: CargoDependencyEdge[];
};

type CargoDependencyEdge = {
  name: string;
  version?: string;
};

type PartialCargoPackageRecord = {
  name?: string;
  version?: string;
  source?: string;
  dependencies: CargoDependencyEdge[];
};

type CargoRootDependency = {
  name: string;
  version?: string;
  type: DependencyType;
};

export function parseCargoLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; manifestMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "CARGO_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Cargo.lock exceeded the maximum supported size."
          : "Failed to read Cargo.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const manifest = readOptionalCargoManifest({
    lockfilePath,
    maxBytes: options.manifestMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!manifest.ok) {
    return manifest;
  }

  return parseCargoLockText(lockfileText.value, lockfilePath, {
    manifestText: manifest.value
  });
}

export function parseCargoLockText(
  input: string,
  lockfilePath = "Cargo.lock",
  options: { manifestText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const records = parseCargoPackageRecords(input);
    if (records.length === 0) {
      return err(
        createError({
          code: "CARGO_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse Cargo.lock. Ohrisk expected at least one [[package]] record.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const rootName = readCargoPackageName(options.manifestText)
      ?? path.basename(path.dirname(lockfilePath))
      ?? "<cargo-project>";
    const rootDependencies = readCargoRootDependencies({
      manifestText: options.manifestText,
      records
    });
    const nodeMap = new Map<string, DependencyNode>();

    for (const rootDependency of rootDependencies) {
      const record = resolveCargoPackageRecord(records, {
        name: rootDependency.name,
        version: rootDependency.version
      });
      if (!record) {
        continue;
      }

      walkCargoDependency({
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
        code: "CARGO_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Cargo.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readOptionalCargoManifest(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const manifestPath = path.join(path.dirname(input.lockfilePath), "Cargo.toml");
  if (!existsSync(manifestPath)) {
    return ok(undefined);
  }

  const manifestText = readInputTextFile({
    filePath: manifestPath,
    maxBytes: input.maxBytes
  });
  if (!manifestText.ok) {
    return err(
      createError({
        code: "CARGO_MANIFEST_READ_FAILED",
        category: inputFileReadErrorCategory(manifestText.error),
        message: manifestText.error.kind === "too_large"
          ? "Cargo.toml exceeded the maximum supported size."
          : "Failed to read Cargo.toml.",
        details: {
          manifestPath,
          ...inputFileReadErrorDetails(manifestText.error)
        }
      })
    );
  }

  return ok(manifestText.value);
}

function parseCargoPackageRecords(input: string): CargoPackageRecord[] {
  const records: CargoPackageRecord[] = [];
  let current: PartialCargoPackageRecord | undefined;
  let activeArray: { key: string; lines: string[] } | undefined;

  const flushArray = (): void => {
    if (!activeArray || !current) {
      activeArray = undefined;
      return;
    }

    if (activeArray.key === "dependencies") {
      current.dependencies.push(...readCargoDependencyEdges(activeArray.lines.join("\n")));
    }

    activeArray = undefined;
  };

  const flushCurrent = (): void => {
    flushArray();
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
      ...(current.source ? { source: current.source } : {}),
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
      if (line.includes("]")) {
        flushArray();
      }
      continue;
    }

    if (line === "[[package]]") {
      flushCurrent();
      current = {
        dependencies: []
      };
      continue;
    }

    if (!current) {
      continue;
    }

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

    const source = readStringAssignment(line, "source");
    if (source !== undefined) {
      current.source = source;
      continue;
    }

    if (line.startsWith("dependencies") && line.includes("=")) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value.includes("[") && value.includes("]")) {
        current.dependencies.push(...readCargoDependencyEdges(value));
      } else if (value.startsWith("[")) {
        activeArray = {
          key: "dependencies",
          lines: [value]
        };
      }
    }
  }

  flushCurrent();

  return records;
}

function readCargoRootDependencies(input: {
  manifestText?: string;
  records: CargoPackageRecord[];
}): CargoRootDependency[] {
  if (input.manifestText) {
    const roots = parseCargoManifestRootDependencies(input.manifestText, input.records);
    if (roots.length > 0) {
      return roots;
    }
  }

  return inferCargoRootDependencies(input.records);
}

function parseCargoManifestRootDependencies(
  input: string,
  records: CargoPackageRecord[]
): CargoRootDependency[] {
  const roots = new Map<string, DependencyType>();
  let section = "";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }

    const dependencyType = dependencyTypeForCargoManifestSection(section);
    if (!dependencyType) {
      continue;
    }

    const dependency = readCargoManifestDependency(line);
    if (dependency) {
      mergeRootDependency(roots, dependency, dependencyType);
    }
  }

  const rootPackage = resolveCargoRootPackageRecord(input, records);

  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({
      name,
      ...cargoRootDependencyVersion(rootPackage, name),
      type
    }));
}

function dependencyTypeForCargoManifestSection(section: string): DependencyType | undefined {
  if (section === "dependencies" || /^target\..+\.dependencies$/.test(section)) {
    return "production";
  }

  if (
    section === "dev-dependencies"
    || section === "build-dependencies"
    || /^target\..+\.(dev-dependencies|build-dependencies)$/.test(section)
  ) {
    return "development";
  }

  return undefined;
}

function readCargoManifestDependency(line: string): string | undefined {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = unquoteTomlKey(line.slice(0, separatorIndex).trim());
  const value = line.slice(separatorIndex + 1).trim();
  const packageName = readInlineTableString(value, "package");
  return packageName ?? key;
}

function inferCargoRootDependencies(records: CargoPackageRecord[]): CargoRootDependency[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      const resolved = resolveCargoPackageRecord(records, dependency);
      if (resolved) {
        referenced.add(resolved.id);
      }
    }
  }

  return records
    .filter((record) => !referenced.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      name: record.name,
      type: "unknown"
    }));
}

function resolveCargoRootPackageRecord(
  manifestText: string,
  records: CargoPackageRecord[]
): CargoPackageRecord | undefined {
  const packageName = readCargoPackageName(manifestText);
  if (!packageName) {
    return undefined;
  }

  return resolveCargoPackageRecord(records, { name: packageName });
}

function cargoRootDependencyVersion(
  rootPackage: CargoPackageRecord | undefined,
  dependencyName: string
): { version?: string } {
  const dependency = rootPackage?.dependencies.find((edge) => edge.name === dependencyName);
  return dependency?.version ? { version: dependency.version } : {};
}

function walkCargoDependency(input: {
  record: CargoPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: CargoPackageRecord[];
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
      ecosystem: "cargo",
      resolved: input.record.source,
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolveCargoPackageRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkCargoDependency({
      record,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveCargoPackageRecord(
  records: CargoPackageRecord[],
  dependency: { name: string; version?: string }
): CargoPackageRecord | undefined {
  const matches = records.filter((record) =>
    record.name === dependency.name
    && (dependency.version === undefined || record.version === dependency.version)
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function readCargoDependencyEdges(value: string): CargoDependencyEdge[] {
  const dependencies: CargoDependencyEdge[] = [];
  for (const match of value.matchAll(/"([^"]+)"/g)) {
    const dependency = parseCargoDependencyString(match[1] ?? "");
    if (dependency) {
      dependencies.push(dependency);
    }
  }

  return dependencies;
}

function parseCargoDependencyString(input: string): CargoDependencyEdge | undefined {
  const parts = input.trim().split(/\s+/);
  const name = parts[0];
  if (!name) {
    return undefined;
  }

  const version = parts.find((part, index) =>
    index > 0 && /^\d+\.\d+\.\d+/.test(part)
  );

  return {
    name,
    ...(version ? { version } : {})
  };
}

function readCargoPackageName(text: string | undefined): string | undefined {
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

    if (section === "package") {
      const name = readStringAssignment(line, "name");
      if (name) {
        return name;
      }
    }
  }

  return undefined;
}

function readStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
}

function readInlineTableString(value: string, key: string): string | undefined {
  const match = new RegExp(`\\b${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(value);
  return match?.[1];
}

function mergeRootDependency(
  roots: Map<string, DependencyType>,
  name: string,
  type: DependencyType
): void {
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
