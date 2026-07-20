import { omitUndefined } from "../shared/object";
import type { LicenseEvidence } from "../evidence/types";
import { parseSpdxExpression } from "../license/spdx";
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
  license?: unknown;
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
  license?: string;
  dependencies: PackageLockDependencyEdge[];
};

type PackageLockDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
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

  for (const rootEntry of rootEntries) {
    for (const rootDependency of collectRootDependencies(rootEntry.pkg)) {
      const record = resolvePackageRecord(omitUndefined({
        recordIndex,
        name: rootDependency.name,
        range: rootDependency.range,
        parentPath: rootEntry.packagePath
      }));

      if (!record) {
        continue;
      }

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

  walkDependencies({
    states: traversalStates,
    recordIndex,
    nodeMap,
    pathLimitAffected
  });

  const embeddedEvidence = packageLockEmbeddedEvidence(records, nodeMap, lockfileLabel);

  return ok(omitUndefined({
    rootName,
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    embeddedEvidence: embeddedEvidence.length > 0 ? embeddedEvidence : undefined,
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

  for (const [name, dependency] of Object.entries(rootDependencies)) {
    if (!dependency || typeof dependency.version !== "string") {
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
      seen: new Set()
    });
  }

  return ok(omitUndefined({
    rootName,
    lockfilePath: input.lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
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
    const license = typeof pkg.license === "string" && pkg.license.trim() !== ""
      ? pkg.license.trim()
      : undefined;

    records.push({
      packagePath,
      name,
      version: pkg.version,
      id: `${name}@${pkg.version}`,
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      ...(license ? { license } : {}),
      dependencies: collectDependencyEdges(pkg)
    });
  }

  return records;
}

function packageLockEmbeddedEvidence(
  records: PackageLockRecord[],
  nodeMap: ReadonlyMap<string, DependencyNode>,
  metadataSource: string
): LicenseEvidence[] {
  const licensesByPackageId = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.license) {
      continue;
    }
    const licenses = licensesByPackageId.get(record.id) ?? new Set<string>();
    licenses.add(record.license);
    licensesByPackageId.set(record.id, licenses);
  }

  const evidence: LicenseEvidence[] = [];
  for (const [packageId, licenses] of licensesByPackageId) {
    const node = nodeMap.get(packageId);
    if (!node || licenses.size !== 1) {
      continue;
    }
    const metadataLicense = licenses.values().next().value;
    if (!metadataLicense) {
      continue;
    }
    const parsed = parseSpdxExpression(metadataLicense);
    if (parsed.malformed || parsed.choices.length === 0) {
      continue;
    }
    evidence.push({
      packageId,
      metadataLicense,
      metadataSource,
      files: [],
      source: "local",
      warnings: []
    });
  }

  return evidence.sort((left, right) => left.packageId.localeCompare(right.packageId));
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
  return [
    ...dependencyEntries(pkg.dependencies, "production"),
    ...dependencyEntries(pkg.devDependencies, "development"),
    ...dependencyEntries(pkg.optionalDependencies, "optional"),
    ...dependencyEntries(pkg.peerDependencies, "peer")
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
}): PackageLockRecord | undefined {
  const reference = resolveNpmDependencyReference(input.name, input.range);
  const nestedPath = input.parentPath
    ? `${input.parentPath}/node_modules/${reference.requestedName}`
    : undefined;
  const topLevelPath = `node_modules/${reference.requestedName}`;

  return (nestedPath ? input.recordIndex.byPackagePath.get(nestedPath) : undefined)
    ?? input.recordIndex.byPackagePath.get(topLevelPath)
    ?? input.recordIndex.byNameAndVersion.get(
      `${reference.lookupName}\0${reference.lookupRange}`
    )
    ?? onlyPackageRecordWithName(input.recordIndex, reference.lookupName);
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
      const childRecord = resolvePackageRecord({
        recordIndex: input.recordIndex,
        name: child.name,
        range: child.range,
        parentPath: state.record.packagePath
      });
      if (!childRecord) {
        continue;
      }

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
    if (!child) {
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
