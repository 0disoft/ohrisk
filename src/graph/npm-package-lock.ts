import { omitUndefined } from "../shared/object";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  addUniqueInstallName,
  dependencyInstallName,
  formatDependencyPathSegment,
  resolveNpmDependencyReference
} from "./npm-spec";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType, UnresolvedDependency } from "./types";
import { unresolvedDependencyKey, uniqueUnresolvedDependencies } from "./unresolved-dependencies";

type PackageLockPackage = {
  name?: unknown;
  version?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  peerDependenciesMeta?: unknown;
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
  dependencies: PackageLockDependencyEdge[];
};

type PackageLockDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
  optional?: boolean;
};

type PackageLockRootEntry = {
  pkg: PackageLockPackage;
  pathSegment: string;
  packagePath?: string;
};

type PackageLockRecordIndex = {
  byPackagePath: Map<string, PackageLockRecord>;
  byNameAndVersion: Map<string, PackageLockRecord>;
  byName: Map<string, PackageLockRecord[]>;
};

type PackageLockTraversalState = {
  record: PackageLockRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  packagePathTrail: string[];
  requestedName?: string;
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

const NPM_MAX_PATHS_PER_PACKAGE = 64;

export function parsePackageLockfile(
  lockfilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileLabel = packageLockLabel(lockfilePath);
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "PACKAGE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? `${lockfileLabel} exceeded the maximum supported size.`
          : `Failed to read ${lockfileLabel}.`,
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parsePackageLockText(lockfileText.value, lockfilePath);
}

export function parsePackageLockText(
  input: string,
  lockfilePath = "package-lock.json"
): Result<DependencyGraph, OhriskError> {
  const lockfileLabel = packageLockLabel(lockfilePath);
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
        message: `Failed to parse ${lockfileLabel}. Ohrisk expects either a modern packages section or an npm v1 dependencies tree.`,
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
  const rootEntries = readPackageLockRootEntries({
    packages: lockfile.packages,
    rootPackage,
    ...(rootName !== undefined ? { rootName } : {})
  });
  const nodeMap = new Map<string, DependencyNode>();
  const recordIndex = indexPackageLockRecords(records);
  const traversalStates: PackageLockTraversalState[] = [];
  const pathLimitAffected = new Set<string>();
  const unresolved = new Map<string, UnresolvedDependency>();

  for (const rootEntry of rootEntries) {
    for (const rootDependency of collectRootDependencies(rootEntry.pkg)) {
      const resolution = resolvePackageRecord(omitUndefined({
        recordIndex,
        name: rootDependency.name,
        range: rootDependency.range,
        parentPath: rootEntry.packagePath
      }));
      if ((!resolution || resolution.inferred) && !rootDependency.optional) {
        addUnresolved(unresolved, {
          name: rootDependency.name, dependencyType: rootDependency.type,
          reason: resolution ? "unproven_installation" : "missing_installation"
        });
      }
      if (!resolution || (rootDependency.optional && resolution.inferred)) {
        continue;
      }
      const record = resolution.record;

      traversalStates.push({
        record,
        dependencyType: rootDependency.type,
        direct: true,
        path: [rootEntry.pathSegment],
        packagePathTrail: [],
        requestedName: rootDependency.name
      });
    }
  }

  collectUnresolvedInstallations(traversalStates, recordIndex, unresolved);

  walkDependencies({
    states: traversalStates,
    recordIndex,
    nodeMap,
    pathLimitAffected
  });

  return ok(omitUndefined({
    rootName,
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(unresolved.size > 0 ? { unresolvedDependencies: uniqueUnresolvedDependencies([...unresolved.values()]) } : {}),
    diagnostics: pathLimitAffected.size > 0
      ? [{
          code: "dependency_paths_truncated" as const,
          affectedNodeCount: pathLimitAffected.size,
          limit: NPM_MAX_PATHS_PER_PACKAGE,
          message: "npm dependency paths were limited."
        }]
      : undefined
  }));
}

function parsePackageLockV1(input: {
  lockfile: PackageLockShape;
  lockfilePath: string;
  dependencies: Record<string, unknown>;
}): Result<DependencyGraph, OhriskError> {
  const rootName = typeof input.lockfile.name === "string" ? input.lockfile.name : undefined;
  const rootDependencies = readV1DependencyMap(input.dependencies);
  const referencedRootDependencies = collectReferencedRootV1DependencyNames(rootDependencies);
  const nodeMap = new Map<string, DependencyNode>();
  const unresolved = new Map<string, UnresolvedDependency>();

  for (const [name, dependency] of Object.entries(rootDependencies)) {
    if (!dependency || typeof dependency.version !== "string") {
      if (dependency?.optional !== true) addUnresolved(unresolved, {
        name, dependencyType: dependencyTypeForV1Dependency(dependency ?? {}), reason: "missing_installation"
      });
      continue;
    }

    if (referencedRootDependencies.has(name)) {
      continue;
    }

    walkV1Dependency({
      name,
      dependency,
      dependencyType: dependencyTypeForV1Dependency(dependency),
      direct: true,
      path: [rootName ?? "<root>"],
      rootDependencies,
      nodeMap,
      unresolved,
      seen: new Set()
    });
  }

  return ok(omitUndefined({
    rootName,
    lockfilePath: input.lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(unresolved.size > 0 ? { unresolvedDependencies: uniqueUnresolvedDependencies([...unresolved.values()]) } : {})
  }));
}

function parseLockfileJson(
  input: string,
  lockfilePath: string
): Result<PackageLockShape, OhriskError> {
  const lockfileLabel = packageLockLabel(lockfilePath);

  try {
    return ok(JSON.parse(input) as PackageLockShape);
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: `Failed to parse ${lockfileLabel}.`,
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function packageLockLabel(lockfilePath: string): "package-lock.json" | "npm-shrinkwrap.json" {
  return lockfilePath.endsWith("npm-shrinkwrap.json") ? "npm-shrinkwrap.json" : "package-lock.json";
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
      dependencies: collectDependencyEdges(pkg)
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

function readPackageLockRootEntries(input: {
  packages: Record<string, unknown>;
  rootPackage: PackageLockPackage | undefined;
  rootName?: string;
}): PackageLockRootEntry[] {
  const entries: PackageLockRootEntry[] = [];

  if (input.rootPackage) {
    entries.push({
      pkg: input.rootPackage,
      pathSegment: input.rootName ?? "<root>"
    });
  }

  for (const [packagePath, rawPackage] of Object.entries(input.packages)) {
    if (!isWorkspacePackagePath(packagePath)) {
      continue;
    }

    const pkg = readPackage(rawPackage);
    if (!pkg) {
      continue;
    }

    entries.push({
      pkg,
      pathSegment: readPackageName(pkg) ?? packagePath,
      packagePath
    });
  }

  return entries;
}

function isWorkspacePackagePath(packagePath: string): boolean {
  return packagePath !== "" && !isNodeModulesPackagePath(packagePath);
}

function isNodeModulesPackagePath(packagePath: string): boolean {
  return packagePath === "node_modules"
    || packagePath.startsWith("node_modules/")
    || packagePath.includes("/node_modules/");
}

function readPackageName(pkg: PackageLockPackage): string | undefined {
  return typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : undefined;
}

function collectRootDependencies(rootPackage: PackageLockPackage | undefined): PackageLockDependencyEdge[] {
  if (!rootPackage) {
    return [];
  }

  return collectDependencyEdges(rootPackage);
}

function collectDependencyEdges(pkg: PackageLockPackage): PackageLockDependencyEdge[] {
  const optional = readDependencyMap(pkg.optionalDependencies);
  const peers = dependencyEntries(pkg.peerDependencies, "peer").map((edge) => {
    const metadata = isObjectRecord(pkg.peerDependenciesMeta) ? pkg.peerDependenciesMeta[edge.name] : undefined;
    return { ...edge, ...(isObjectRecord(metadata) && metadata.optional === true ? { optional: true } : {}) };
  });
  return [
    ...dependencyEntries(pkg.dependencies, "production").filter((edge) => !Object.hasOwn(optional, edge.name)),
    ...dependencyEntries(pkg.devDependencies, "development"),
    ...dependencyEntries(optional, "optional").map((edge) => ({ ...edge, optional: true })),
    ...peers
  ];
}

function dependencyEntries(value: unknown, type: DependencyType): PackageLockDependencyEdge[] {
  return Object.entries(readDependencyMap(value)).map(([name, range]) => ({
    name,
    range,
    type
  }));
}

function indexPackageLockRecords(records: PackageLockRecord[]): PackageLockRecordIndex {
  const byPackagePath = new Map<string, PackageLockRecord>();
  const byNameAndVersion = new Map<string, PackageLockRecord>();
  const byName = new Map<string, PackageLockRecord[]>();

  for (const record of records) {
    byPackagePath.set(record.packagePath, record);
    const nameAndVersionKey = `${record.name}\0${record.version}`;
    if (!byNameAndVersion.has(nameAndVersionKey)) {
      byNameAndVersion.set(nameAndVersionKey, record);
    }
    const nameMatches = byName.get(record.name) ?? [];
    nameMatches.push(record);
    byName.set(record.name, nameMatches);
  }

  return { byPackagePath, byNameAndVersion, byName };
}

function resolvePackageRecord(input: {
  recordIndex: PackageLockRecordIndex;
  name: string;
  range: string;
  parentPath?: string;
}): { record: PackageLockRecord; inferred: boolean } | undefined {
  const reference = resolveNpmDependencyReference(input.name, input.range);
  let directory = input.parentPath ?? "";
  while (true) {
    // Node skips a node_modules directory itself while walking its ancestors.
    if (directory.split("/").at(-1) !== "node_modules") {
      const candidate = input.recordIndex.byPackagePath.get(
        `${directory ? `${directory}/` : ""}node_modules/${reference.requestedName}`
      );
      if (candidate) return { record: candidate, inferred: false };
    }
    if (!directory) break;
    const separator = directory.lastIndexOf("/");
    directory = separator < 0 ? "" : directory.slice(0, separator);
  }

  const inferred = input.recordIndex.byNameAndVersion.get(
      `${reference.lookupName}\0${reference.lookupRange}`
    )
    ?? onlyPackageRecordWithName(input.recordIndex, reference.lookupName);
  return inferred ? { record: inferred, inferred: true } : undefined;
}

function addUnresolved(target: Map<string, UnresolvedDependency>, item: UnresolvedDependency): void {
  target.set(unresolvedDependencyKey(item), item);
}

/** Traverse installation records independently of the bounded display-path walk. */
function collectUnresolvedInstallations(
  roots: readonly PackageLockTraversalState[], index: PackageLockRecordIndex,
  unresolved: Map<string, UnresolvedDependency>
): void {
  const queue = roots.map((state) => ({ record: state.record, type: state.dependencyType }));
  const seen = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor]!;
    const key = JSON.stringify([state.record.packagePath, state.type]);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const edge of state.record.dependencies) {
      const resolution = resolvePackageRecord({
        recordIndex: index, name: edge.name, range: edge.range, parentPath: state.record.packagePath
      });
      const type = dependencyTypeForChildEdge(state.type, edge.type);
      if ((!resolution || resolution.inferred) && !edge.optional) addUnresolved(unresolved, {
        from: state.record.id, name: edge.name, dependencyType: type,
        reason: resolution ? "unproven_installation" : "missing_installation"
      });
      if (resolution && !(edge.optional && resolution.inferred)) queue.push({ record: resolution.record, type });
    }
  }
}

function onlyPackageRecordWithName(
  recordIndex: PackageLockRecordIndex,
  name: string
): PackageLockRecord | undefined {
  const matches = recordIndex.byName.get(name) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function walkDependencies(input: {
  states: PackageLockTraversalState[];
  recordIndex: PackageLockRecordIndex;
  nodeMap: Map<string, DependencyNode>;
  pathLimitAffected: Set<string>;
}): void {
  const stack = [...input.states].reverse();
  const pathKeysByNodeId = new Map<string, Set<string>>();
  const expandedPathTypesByNodeId = new Map<string, Set<string>>();

  while (stack.length > 0) {
    const state = stack.pop();
    if (!state || state.packagePathTrail.includes(state.record.packagePath)) {
      continue;
    }

    const requestedName = state.requestedName ?? state.record.name;
    const installName = dependencyInstallName({
      requestedName,
      actualName: state.record.name
    });
    const nextPath = [
      ...state.path,
      formatDependencyPathSegment({
        requestedName,
        actualName: state.record.name,
        packageId: state.record.id
      })
    ];
    const nextPackagePathTrail = [...state.packagePathTrail, state.record.packagePath];
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
      ecosystem: "npm",
      ...(installName ? { installNames: [installName] } : {}),
      ...(state.record.resolved ? { resolved: state.record.resolved } : {}),
      ...(state.record.integrity ? { integrity: state.record.integrity } : {}),
      dependencyType: mergedDependencyType,
      direct: state.direct,
      paths: []
    };
    node.direct = node.direct || state.direct;
    node.dependencyType = mergedDependencyType;
    const installNames = addUniqueInstallName({
      current: node.installNames,
      installName
    });
    if (installNames !== undefined) {
      node.installNames = installNames;
    }
    if (!existing) {
      input.nodeMap.set(state.record.id, node);
    }

    const pathKeys = pathKeysByNodeId.get(state.record.id) ?? new Set<string>();
    let traversalPath: string[] | undefined;
    if (pathKeys.has(pathKey)) {
      traversalPath = dependencyTypeStrengthened ? nextPath : undefined;
    } else if (pathKeys.size < NPM_MAX_PATHS_PER_PACKAGE) {
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
      const child = state.record.dependencies[index];
      if (!child) {
        continue;
      }
      const resolution = resolvePackageRecord({
        recordIndex: input.recordIndex,
        name: child.name,
        range: child.range,
        parentPath: state.record.packagePath
      });
      if (!resolution || (child.optional && resolution.inferred)) {
        continue;
      }
      const childRecord = resolution.record;

      stack.push({
        record: childRecord,
        dependencyType: dependencyTypeForChildEdge(state.dependencyType, child.type),
        direct: false,
        path: traversalPath,
        packagePathTrail: nextPackagePathTrail,
        requestedName: child.name
      });
    }
  }
}

function walkV1Dependency(input: {
  name: string;
  dependency: PackageLockV1Dependency;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  rootDependencies: Record<string, PackageLockV1Dependency>;
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
  unresolved: Map<string, UnresolvedDependency>;
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
    const child = nestedDependencies[childName] ?? input.rootDependencies[childName];
    if (!child || typeof child.version !== "string") {
      if (child?.optional !== true) addUnresolved(input.unresolved, {
        from: id, name: childName,
        dependencyType: dependencyTypeForChildEdge(input.dependencyType, child ? dependencyTypeForV1Dependency(child) : "production"),
        reason: "missing_installation"
      });
      continue;
    }

    walkV1Dependency({
      name: childName,
      dependency: child,
      dependencyType: dependencyTypeForChildEdge(
        input.dependencyType,
        dependencyTypeForV1Dependency(child)
      ),
      direct: false,
      path: nextPath,
      rootDependencies: input.rootDependencies,
      nodeMap: input.nodeMap,
      unresolved: input.unresolved,
      seen: nextSeen
    });
  }
}

function collectReferencedRootV1DependencyNames(
  rootDependencies: Record<string, PackageLockV1Dependency>
): Set<string> {
  const referenced = new Set<string>();

  for (const dependency of Object.values(rootDependencies)) {
    for (const name of Object.keys(readDependencyMap(dependency.requires))) {
      if (rootDependencies[name]) {
        referenced.add(name);
      }
    }
  }

  return referenced;
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  return dependencyTypeRank(left) >= dependencyTypeRank(right) ? left : right;
}

function dependencyTypeForChildEdge(
  parentType: DependencyType,
  childEdgeType: DependencyType
): DependencyType {
  return parentType === "production" ? childEdgeType : parentType;
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
