import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  addUniqueInstallName,
  dependencyInstallName,
  formatDependencyPathSegment,
  parseNpmPackageReference,
  resolveNpmDependencyReference
} from "./npm-spec";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type BunLockWorkspace = {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
};

type BunLockPackageTuple = [
  resolution?: unknown,
  registryOrMetadata?: unknown,
  metadata?: unknown,
  integrity?: unknown
];

type BunLockPackageRecord = {
  key: string;
  name: string;
  version: string;
  id: string;
  resolved?: string;
  integrity?: string;
  dependencies: BunLockDependencyEdge[];
};

type BunLockShape = {
  workspaces?: Record<string, BunLockWorkspace>;
  packages?: Record<string, BunLockPackageTuple>;
};

type BunLockDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
};

type BunWorkspaceEntry = {
  key: string;
  workspace: BunLockWorkspace;
  pathSegment: string;
};

export function parseBunLockfile(
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
        code: "BUN_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "bun.lock exceeded the maximum supported size."
          : "Failed to read bun.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseBunLockText(lockfileText.value, lockfilePath);
}

export function parseBunLockText(
  input: string,
  lockfilePath = "bun.lock"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseLockfileJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const lockfile = parsed.value;
  const packages = parsePackageRecords(lockfile.packages ?? {});
  const packageIndex = indexPackagesByName(packages);
  const workspaceEntries = readWorkspaceEntries(lockfile.workspaces);
  const rootName = readRootName(workspaceEntries);
  const nodeMap = new Map<string, DependencyNode>();

  for (const workspaceEntry of workspaceEntries) {
    for (const rootDependency of collectRootDependencies(workspaceEntry.workspace)) {
      const record = resolvePackageRecord(packageIndex, rootDependency.name, rootDependency.range);
      if (!record) {
        continue;
      }

      walkDependency({
        record,
        dependencyType: rootDependency.type,
        direct: true,
        path: [workspaceEntry.pathSegment],
        packageIndex,
        nodeMap,
        seen: new Set(),
        requestedName: rootDependency.name
      });
    }
  }

  return ok({
    rootName,
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function parseLockfileJson(
  input: string,
  lockfilePath: string
): Result<BunLockShape, OhriskError> {
  try {
    return ok(JSON.parse(toJson(input)) as BunLockShape);
  } catch (cause) {
    return err(
      createError({
        code: "BUN_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse bun.lock. Ohrisk expects Bun's text lockfile shape.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function toJson(input: string): string {
  const withoutHashComments = input
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  return stripTrailingCommas(withoutHashComments);
}

function stripTrailingCommas(input: string): string {
  let previous = input;

  while (true) {
    const next = previous.replace(/,\s*([}\]])/g, "$1");
    if (next === previous) {
      return next;
    }
    previous = next;
  }
}

function parsePackageRecords(packages: Record<string, BunLockPackageTuple>): BunLockPackageRecord[] {
  const records: BunLockPackageRecord[] = [];

  for (const [key, tuple] of Object.entries(packages)) {
    const resolution = typeof tuple[0] === "string" ? tuple[0] : key;
    const identity = parsePackageIdentity(resolution);

    if (!identity) {
      continue;
    }

    const tupleFields = readPackageTupleFields({
      identity,
      tuple
    });
    const metadata = tupleFields.metadata;
    const dependencies = collectDependencyEdges(metadata);

    records.push({
      key,
      name: identity.name,
      version: identity.version,
      id: `${identity.name}@${identity.version}`,
      ...(tupleFields.resolved ? { resolved: tupleFields.resolved } : {}),
      ...(tupleFields.integrity ? { integrity: tupleFields.integrity } : {}),
      dependencies
    });
  }

  return records;
}

function readPackageTupleFields(input: {
  identity: { name: string; version: string };
  tuple: BunLockPackageTuple;
}): {
  resolved?: string;
  metadata: Record<string, unknown>;
  integrity?: string;
} {
  const registryOrMetadata = input.tuple[1];
  const metadataOrIntegrity = input.tuple[2];
  const integrity = input.tuple[3];

  if (typeof registryOrMetadata === "string") {
    const resolved = registryOrMetadata !== "" ? registryOrMetadata : undefined;
    const parsedIntegrity = typeof integrity === "string" && integrity !== ""
      ? integrity
      : undefined;

    return {
      metadata: isObjectRecord(metadataOrIntegrity) ? metadataOrIntegrity : {},
      ...(resolved ? { resolved } : {}),
      ...(parsedIntegrity ? { integrity: parsedIntegrity } : {})
    };
  }

  const resolved = isLocalArtifactReference(input.identity.version)
    ? input.identity.version
    : undefined;
  const parsedIntegrity = typeof metadataOrIntegrity === "string" && metadataOrIntegrity !== ""
    ? metadataOrIntegrity
    : undefined;

  return {
    metadata: isObjectRecord(registryOrMetadata) ? registryOrMetadata : {},
    ...(resolved ? { resolved } : {}),
    ...(parsedIntegrity ? { integrity: parsedIntegrity } : {})
  };
}

function parsePackageIdentity(input: string): { name: string; version: string } | undefined {
  const withoutProtocol = input.startsWith("npm:") ? input.slice("npm:".length) : input;
  const parsed = parseNpmPackageReference(withoutProtocol);

  if (!parsed) {
    return undefined;
  }

  return { name: parsed.name, version: parsed.reference };
}

function isLocalArtifactReference(value: string): boolean {
  return value.startsWith("file:")
    || isWorkspaceLocalArtifactReference(value)
    || value.startsWith(".")
    || path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/.test(value);
}

function isWorkspaceLocalArtifactReference(value: string): boolean {
  if (!value.startsWith("workspace:")) {
    return false;
  }

  const specifier = value.slice("workspace:".length);
  return specifier.startsWith(".")
    || specifier.startsWith("/")
    || specifier.includes("/")
    || specifier.includes("\\");
}

function indexPackagesByName(records: BunLockPackageRecord[]): Map<string, BunLockPackageRecord[]> {
  const index = new Map<string, BunLockPackageRecord[]>();

  for (const record of records) {
    const entries = index.get(record.name) ?? [];
    entries.push(record);
    index.set(record.name, entries);
  }

  return index;
}

function readWorkspaceEntries(
  workspaces: Record<string, BunLockWorkspace> | undefined
): BunWorkspaceEntry[] {
  if (!workspaces) {
    return [];
  }

  const rootWorkspace = isObjectRecord(workspaces[""]) ? workspaces[""] : undefined;
  const rootName = readWorkspaceName(rootWorkspace);

  return Object.entries(workspaces).flatMap(([key, workspace]) => {
    if (!isObjectRecord(workspace)) {
      return [];
    }

    return [{
      key,
      workspace,
      pathSegment: workspacePathSegment({ key, workspace, rootName })
    }];
  });
}

function readRootName(workspaceEntries: BunWorkspaceEntry[]): string | undefined {
  const explicitRoot = workspaceEntries.find((entry) => entry.key === "");
  const explicitRootName = readWorkspaceName(explicitRoot?.workspace);
  if (explicitRootName) {
    return explicitRootName;
  }

  if (workspaceEntries.length === 1) {
    return readWorkspaceName(workspaceEntries[0]?.workspace);
  }

  return undefined;
}

function readWorkspaceName(workspace: BunLockWorkspace | undefined): string | undefined {
  return typeof workspace?.name === "string" && workspace.name !== ""
    ? workspace.name
    : undefined;
}

function workspacePathSegment(input: {
  key: string;
  workspace: BunLockWorkspace;
  rootName?: string;
}): string {
  if (input.key === "") {
    return input.rootName ?? "<root>";
  }

  const workspaceName = readWorkspaceName(input.workspace);
  if (workspaceName) {
    return workspaceName;
  }

  return input.key;
}

function collectRootDependencies(workspace: BunLockWorkspace | undefined): BunLockDependencyEdge[] {
  if (!workspace) {
    return [];
  }

  return collectDependencyEdges(workspace);
}

function collectDependencyEdges(source: {
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
}): BunLockDependencyEdge[] {
  return [
    ...dependencyEntries(source.dependencies, "production"),
    ...dependencyEntries(source.devDependencies, "development"),
    ...dependencyEntries(source.optionalDependencies, "optional"),
    ...dependencyEntries(source.peerDependencies, "peer")
  ];
}

function dependencyEntries(value: unknown, type: DependencyType): BunLockDependencyEdge[] {
  return Object.entries(readDependencyMap(value)).map(([name, range]) => ({
    name,
    range,
    type
  }));
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

function resolvePackageRecord(
  packageIndex: Map<string, BunLockPackageRecord[]>,
  name: string,
  range: string
): BunLockPackageRecord | undefined {
  const reference = resolveNpmDependencyReference(name, range);
  const candidates = packageIndex.get(reference.lookupName) ?? [];

  if (candidates.length <= 1) {
    return candidates[0];
  }

  return candidates.find((candidate) => candidate.version === reference.lookupRange)
    ?? undefined;
}

function walkDependency(input: {
  record: BunLockPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  packageIndex: Map<string, BunLockPackageRecord[]>;
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
  requestedName?: string;
}): void {
  if (input.seen.has(input.record.id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.id);

  const requestedName = input.requestedName ?? input.record.name;
  const installName = dependencyInstallName({
    requestedName,
    actualName: input.record.name
  });
  const nextPath = [
    ...input.path,
    formatDependencyPathSegment({
      requestedName,
      actualName: input.record.name,
      packageId: input.record.id
    })
  ];
  const existing = input.nodeMap.get(input.record.id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.installNames = addUniqueInstallName({
      current: existing.installNames,
      installName
    });
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "npm",
      ...(installName ? { installNames: [installName] } : {}),
      ...(input.record.resolved ? { resolved: input.record.resolved } : {}),
      ...(input.record.integrity ? { integrity: input.record.integrity } : {}),
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const child of input.record.dependencies) {
    const childRecord = resolvePackageRecord(input.packageIndex, child.name, child.range);
    if (!childRecord) {
      continue;
    }

    walkDependency({
      record: childRecord,
      dependencyType: dependencyTypeForChildEdge(input.dependencyType, child.type),
      direct: false,
      path: nextPath,
      packageIndex: input.packageIndex,
      nodeMap: input.nodeMap,
      seen: nextSeen,
      requestedName: child.name
    });
  }
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
