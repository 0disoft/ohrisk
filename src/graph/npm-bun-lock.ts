import { readFileSync } from "node:fs";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  addUniqueInstallName,
  dependencyInstallName,
  formatDependencyPathSegment,
  parseNpmPackageReference,
  resolveNpmDependencyReference
} from "./npm-spec";
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
  registry?: unknown,
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
  dependencies: Record<string, string>;
};

type BunLockShape = {
  workspaces?: Record<string, BunLockWorkspace>;
  packages?: Record<string, BunLockPackageTuple>;
};

export function parseBunLockfile(
  lockfilePath: string
): Result<DependencyGraph, OhriskError> {
  try {
    return parseBunLockText(readFileSync(lockfilePath, "utf8"), lockfilePath);
  } catch (cause) {
    return err(
      createError({
        code: "BUN_LOCK_READ_FAILED",
        category: "filesystem",
        message: "Failed to read bun.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
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
  const rootWorkspace = lockfile.workspaces?.[""] ?? firstWorkspace(lockfile.workspaces);
  const rootName = typeof rootWorkspace?.name === "string" ? rootWorkspace.name : undefined;
  const rootDependencies = collectRootDependencies(rootWorkspace);
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootDependency of rootDependencies) {
    const record = resolvePackageRecord(packageIndex, rootDependency.name, rootDependency.range);
    if (!record) {
      continue;
    }

    walkDependency({
      record,
      dependencyType: rootDependency.type,
      direct: true,
      path: [rootName ?? "<root>"],
      packageIndex,
      nodeMap,
      seen: new Set(),
      requestedName: rootDependency.name
    });
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
        message: "Failed to parse bun.lock. Ohrisk v0 expects Bun's text lockfile shape.",
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

    const metadata = isObjectRecord(tuple[2]) ? tuple[2] : {};
    const dependencies = readDependencyMap(metadata.dependencies);
    const resolved = typeof tuple[1] === "string" && tuple[1] !== "" ? tuple[1] : undefined;
    const integrity = typeof tuple[3] === "string" && tuple[3] !== "" ? tuple[3] : undefined;

    records.push({
      key,
      name: identity.name,
      version: identity.version,
      id: `${identity.name}@${identity.version}`,
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      dependencies
    });
  }

  return records;
}

function parsePackageIdentity(input: string): { name: string; version: string } | undefined {
  const withoutProtocol = input.startsWith("npm:") ? input.slice("npm:".length) : input;
  const parsed = parseNpmPackageReference(withoutProtocol);

  if (!parsed) {
    return undefined;
  }

  return { name: parsed.name, version: parsed.reference };
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

function firstWorkspace(
  workspaces: Record<string, BunLockWorkspace> | undefined
): BunLockWorkspace | undefined {
  if (!workspaces) {
    return undefined;
  }

  return Object.values(workspaces)[0];
}

function collectRootDependencies(workspace: BunLockWorkspace | undefined): Array<{
  name: string;
  range: string;
  type: DependencyType;
}> {
  if (!workspace) {
    return [];
  }

  return [
    ...dependencyEntries(workspace.dependencies, "production"),
    ...dependencyEntries(workspace.devDependencies, "development"),
    ...dependencyEntries(workspace.optionalDependencies, "optional"),
    ...dependencyEntries(workspace.peerDependencies, "peer")
  ];
}

function dependencyEntries(
  value: unknown,
  type: DependencyType
): Array<{ name: string; range: string; type: DependencyType }> {
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
    ?? candidates.find((candidate) => reference.lookupRange.includes(candidate.version))
    ?? candidates[0];
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

  for (const [childName, childRange] of Object.entries(input.record.dependencies)) {
    const child = resolvePackageRecord(input.packageIndex, childName, childRange);
    if (!child) {
      continue;
    }

    walkDependency({
      record: child,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      packageIndex: input.packageIndex,
      nodeMap: input.nodeMap,
      seen: nextSeen,
      requestedName: childName
    });
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
