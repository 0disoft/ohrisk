import { readFileSync } from "node:fs";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PackageLockPackage = {
  name?: unknown;
  version?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  dev?: unknown;
  optional?: unknown;
};

type PackageLockShape = {
  name?: unknown;
  lockfileVersion?: unknown;
  packages?: unknown;
  dependencies?: unknown;
};

type PackageLockRecord = {
  packagePath: string;
  name: string;
  version: string;
  id: string;
  resolved?: string;
  integrity?: string;
  dependencies: Record<string, string>;
};

type RootDependency = {
  name: string;
  range: string;
  type: DependencyType;
};

type PackageLockV1Dependency = {
  version?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  requires?: unknown;
  dependencies?: unknown;
  dev?: unknown;
  optional?: unknown;
};

export function parsePackageLockfile(
  lockfilePath: string
): Result<DependencyGraph, OhriskError> {
  try {
    return parsePackageLockText(readFileSync(lockfilePath, "utf8"), lockfilePath);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_LOCK_READ_FAILED",
        category: "filesystem",
        message: "Failed to read package-lock.json.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

export function parsePackageLockText(
  input: string,
  lockfilePath = "package-lock.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseLockfileJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const lockfile = parsed.value;
  if (!isObjectRecord(lockfile.packages) && isObjectRecord(lockfile.dependencies)) {
    return parsePackageLockV1({
      lockfile,
      lockfilePath,
      dependencies: lockfile.dependencies
    });
  }

  if (!isObjectRecord(lockfile.packages)) {
    return err(
      createError({
        code: "PACKAGE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package-lock.json. Ohrisk expects either a modern packages section or an npm v1 dependencies tree.",
        details: {
          lockfilePath,
          lockfileVersion: lockfile.lockfileVersion ?? "unknown"
        }
      })
    );
  }

  const rootPackage = readPackage(lockfile.packages[""]);
  const rootName = typeof rootPackage?.name === "string"
    ? rootPackage.name
    : typeof lockfile.name === "string"
      ? lockfile.name
      : undefined;
  const records = parsePackageRecords(lockfile.packages);
  const rootDependencies = collectRootDependencies(rootPackage);
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootDependency of rootDependencies) {
    const record = resolvePackageRecord({
      records,
      name: rootDependency.name,
      range: rootDependency.range
    });

    if (!record) {
      continue;
    }

    walkDependency({
      record,
      dependencyType: rootDependency.type,
      direct: true,
      path: [rootName ?? "<root>"],
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
}

function parsePackageLockV1(input: {
  lockfile: PackageLockShape;
  lockfilePath: string;
  dependencies: Record<string, unknown>;
}): Result<DependencyGraph, OhriskError> {
  const rootName = typeof input.lockfile.name === "string" ? input.lockfile.name : undefined;
  const nodeMap = new Map<string, DependencyNode>();

  for (const [name, rawDependency] of Object.entries(input.dependencies)) {
    const dependency = readV1Dependency(rawDependency);
    if (!dependency || typeof dependency.version !== "string") {
      continue;
    }

    walkV1Dependency({
      name,
      dependency,
      dependencyType: dependencyTypeForV1Dependency(dependency),
      direct: true,
      path: [rootName ?? "<root>"],
      nodeMap,
      seen: new Set()
    });
  }

  return ok({
    rootName,
    lockfilePath: input.lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function parseLockfileJson(
  input: string,
  lockfilePath: string
): Result<PackageLockShape, OhriskError> {
  try {
    return ok(JSON.parse(input) as PackageLockShape);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package-lock.json.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parsePackageRecords(packages: Record<string, unknown>): PackageLockRecord[] {
  const records: PackageLockRecord[] = [];

  for (const [packagePath, rawPackage] of Object.entries(packages)) {
    if (packagePath === "") {
      continue;
    }

    const pkg = readPackage(rawPackage);
    if (!pkg || typeof pkg.version !== "string") {
      continue;
    }

    const name = typeof pkg.name === "string" ? pkg.name : packageNameFromPath(packagePath);
    if (!name) {
      continue;
    }

    const resolved = typeof pkg.resolved === "string" && pkg.resolved !== ""
      ? pkg.resolved
      : undefined;
    const integrity = typeof pkg.integrity === "string" && pkg.integrity !== ""
      ? pkg.integrity
      : undefined;

    records.push({
      packagePath,
      name,
      version: pkg.version,
      id: `${name}@${pkg.version}`,
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      dependencies: readDependencyMap(pkg.dependencies)
    });
  }

  return records;
}

function packageNameFromPath(packagePath: string): string | undefined {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }

  const rest = packagePath.slice(markerIndex + marker.length);
  const parts = rest.split("/");
  if (parts[0]?.startsWith("@")) {
    return parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  }

  return parts[0] || undefined;
}

function collectRootDependencies(rootPackage: PackageLockPackage | undefined): RootDependency[] {
  if (!rootPackage) {
    return [];
  }

  return [
    ...dependencyEntries(rootPackage.dependencies, "production"),
    ...dependencyEntries(rootPackage.devDependencies, "development"),
    ...dependencyEntries(rootPackage.optionalDependencies, "optional"),
    ...dependencyEntries(rootPackage.peerDependencies, "peer")
  ];
}

function dependencyEntries(value: unknown, type: DependencyType): RootDependency[] {
  return Object.entries(readDependencyMap(value)).map(([name, range]) => ({
    name,
    range,
    type
  }));
}

function resolvePackageRecord(input: {
  records: PackageLockRecord[];
  name: string;
  range: string;
  parentPath?: string;
}): PackageLockRecord | undefined {
  const nestedPath = input.parentPath
    ? `${input.parentPath}/node_modules/${input.name}`
    : undefined;
  const topLevelPath = `node_modules/${input.name}`;

  return input.records.find((record) => nestedPath && record.packagePath === nestedPath)
    ?? input.records.find((record) => record.packagePath === topLevelPath)
    ?? input.records.find((record) => record.name === input.name && record.version === input.range)
    ?? input.records.find((record) => record.name === input.name && input.range.includes(record.version))
    ?? input.records.find((record) => record.name === input.name);
}

function walkDependency(input: {
  record: PackageLockRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: PackageLockRecord[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  const seenKey = input.record.packagePath;
  if (input.seen.has(seenKey)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(seenKey);

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
      ecosystem: "npm",
      ...(input.record.resolved ? { resolved: input.record.resolved } : {}),
      ...(input.record.integrity ? { integrity: input.record.integrity } : {}),
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const [childName, childRange] of Object.entries(input.record.dependencies)) {
    const child = resolvePackageRecord({
      records: input.records,
      name: childName,
      range: childRange,
      parentPath: input.record.packagePath
    });

    if (!child) {
      continue;
    }

    walkDependency({
      record: child,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function walkV1Dependency(input: {
  name: string;
  dependency: PackageLockV1Dependency;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (typeof input.dependency.version !== "string") {
    return;
  }

  const id = `${input.name}@${input.dependency.version}`;
  if (input.seen.has(id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(id);

  const nextPath = [...input.path, id];
  const resolved = typeof input.dependency.resolved === "string" && input.dependency.resolved !== ""
    ? input.dependency.resolved
    : undefined;
  const integrity = typeof input.dependency.integrity === "string" && input.dependency.integrity !== ""
    ? input.dependency.integrity
    : undefined;
  const existing = input.nodeMap.get(id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(id, {
      id,
      name: input.name,
      version: input.dependency.version,
      ecosystem: "npm",
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  const nestedDependencies = readV1DependencyMap(input.dependency.dependencies);
  const requiredNames = Object.keys(readDependencyMap(input.dependency.requires));
  const childNames = new Set([...Object.keys(nestedDependencies), ...requiredNames]);

  for (const childName of childNames) {
    const child = nestedDependencies[childName];
    if (!child) {
      continue;
    }

    walkV1Dependency({
      name: childName,
      dependency: child,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
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

function readPackage(value: unknown): PackageLockPackage | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function readV1Dependency(value: unknown): PackageLockV1Dependency | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function readV1DependencyMap(value: unknown): Record<string, PackageLockV1Dependency> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const dependencies: Record<string, PackageLockV1Dependency> = {};

  for (const [name, dependency] of Object.entries(value)) {
    const parsed = readV1Dependency(dependency);
    if (parsed) {
      dependencies[name] = parsed;
    }
  }

  return dependencies;
}

function dependencyTypeForV1Dependency(dependency: PackageLockV1Dependency): DependencyType {
  if (dependency.dev === true) {
    return "development";
  }

  if (dependency.optional === true) {
    return "optional";
  }

  return "production";
}

function readDependencyMap(value: unknown): Record<string, string> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const dependencies: Record<string, string> = {};

  for (const [name, range] of Object.entries(value)) {
    if (typeof range === "string") {
      dependencies[name] = range;
    }
  }

  return dependencies;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
