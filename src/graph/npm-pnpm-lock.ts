import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  addUniqueInstallName,
  dependencyInstallName,
  formatDependencyPathSegment,
  resolveNpmDependencyReference
} from "./npm-spec";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PnpmLockShape = {
  lockfileVersion?: unknown;
  importers?: unknown;
  packages?: unknown;
  snapshots?: unknown;
};

type PnpmPackageRecord = {
  key: string;
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

export function parsePnpmLockfile(
  lockfilePath: string
): Result<DependencyGraph, OhriskError> {
  try {
    return parsePnpmLockText(readFileSync(lockfilePath, "utf8"), lockfilePath);
  } catch (cause) {
    return err(
      createError({
        code: "PNPM_LOCK_READ_FAILED",
        category: "filesystem",
        message: "Failed to read pnpm-lock.yaml.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

export function parsePnpmLockText(
  input: string,
  lockfilePath = "pnpm-lock.yaml"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseLockfileYaml(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const lockfile = parsed.value;
  const importers = readRecord(lockfile.importers);
  if (!importers) {
    return err(
      createError({
        code: "PNPM_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pnpm-lock.yaml. Ohrisk expects a lockfile with an importers section.",
        details: {
          lockfilePath,
          lockfileVersion: lockfile.lockfileVersion ?? "unknown"
        }
      })
    );
  }

  const rootImporter = readRootImporter(importers);
  const packages = readRecord(lockfile.packages) ?? {};
  const snapshots = readRecord(lockfile.snapshots) ?? {};
  const records = parsePackageRecords({ packages, snapshots });
  const packageIndex = indexPackagesByName(records);
  const rootDependencies = collectRootDependencies(rootImporter);
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootDependency of rootDependencies) {
    const record = resolvePackageRecord({
      packageIndex,
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
      path: ["<root>"],
      packageIndex,
      nodeMap,
      seen: new Set(),
      requestedName: rootDependency.name
    });
  }

  return ok({
    lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function parseLockfileYaml(
  input: string,
  lockfilePath: string
): Result<PnpmLockShape, OhriskError> {
  try {
    const parsed = parseYaml(input) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error("Expected a YAML mapping at the document root.");
    }

    return ok(parsed as PnpmLockShape);
  } catch (cause) {
    return err(
      createError({
        code: "PNPM_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pnpm-lock.yaml.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readRootImporter(importers: Record<string, unknown>): Record<string, unknown> | undefined {
  return readRecord(importers["."]) ?? Object.values(importers).map(readRecord).find(Boolean);
}

function parsePackageRecords(input: {
  packages: Record<string, unknown>;
  snapshots: Record<string, unknown>;
}): PnpmPackageRecord[] {
  const records: PnpmPackageRecord[] = [];
  const keys = new Set([...Object.keys(input.packages), ...Object.keys(input.snapshots)]);

  for (const key of keys) {
    const packageEntry = readRecord(input.packages[key]) ?? {};
    const snapshotEntry = readRecord(input.snapshots[key]) ?? {};
    const identity = readPackageIdentity(key, packageEntry);

    if (!identity) {
      continue;
    }

    const resolution = readRecord(packageEntry.resolution);
    const resolved = readResolvedArtifact(resolution);
    const integrity = typeof resolution?.integrity === "string" && resolution.integrity !== ""
      ? resolution.integrity
      : undefined;

    records.push({
      key,
      name: identity.name,
      version: identity.version,
      id: `${identity.name}@${identity.version}`,
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      dependencies: {
        ...readDependencyMap(packageEntry.dependencies),
        ...readDependencyMap(snapshotEntry.dependencies)
      }
    });
  }

  return records;
}

function readPackageIdentity(
  key: string,
  packageEntry: Record<string, unknown>
): { name: string; version: string } | undefined {
  const parsedKey = parsePackageKey(key);
  const name = typeof packageEntry.name === "string" && packageEntry.name !== ""
    ? packageEntry.name
    : parsedKey?.name;
  const version = typeof packageEntry.version === "string" && packageEntry.version !== ""
    ? packageEntry.version
    : parsedKey?.version;

  if (!name || !version || version.startsWith("file:") || version.startsWith("link:")) {
    return undefined;
  }

  return { name, version };
}

function parsePackageKey(key: string): { name: string; version: string } | undefined {
  const withoutLeadingSlash = key.replace(/^\//, "");
  const withoutPeerSuffix = withoutLeadingSlash.replace(/\(.+\)$/, "").split("_")[0] ?? "";
  const atIndex = withoutPeerSuffix.lastIndexOf("@");

  if (atIndex <= 0) {
    return undefined;
  }

  const name = withoutPeerSuffix.slice(0, atIndex);
  const version = withoutPeerSuffix.slice(atIndex + 1);

  if (!name || !version) {
    return undefined;
  }

  return { name, version };
}

function readResolvedArtifact(
  resolution: Record<string, unknown> | undefined
): string | undefined {
  if (!resolution) {
    return undefined;
  }

  if (typeof resolution.tarball === "string" && resolution.tarball !== "") {
    return resolution.tarball;
  }

  if (typeof resolution.directory === "string" && resolution.directory !== "") {
    return `file:${resolution.directory}`;
  }

  return undefined;
}

function collectRootDependencies(importer: Record<string, unknown> | undefined): RootDependency[] {
  if (!importer) {
    return [];
  }

  return [
    ...dependencyEntries(importer.dependencies, "production"),
    ...dependencyEntries(importer.devDependencies, "development"),
    ...dependencyEntries(importer.optionalDependencies, "optional"),
    ...dependencyEntries(importer.peerDependencies, "peer")
  ];
}

function dependencyEntries(value: unknown, type: DependencyType): RootDependency[] {
  return Object.entries(readImporterDependencyMap(value)).map(([name, range]) => ({
    name,
    range,
    type
  }));
}

function readImporterDependencyMap(value: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const dependencyRecord = readRecord(value);
  if (!dependencyRecord) {
    return dependencies;
  }

  for (const [name, rawDependency] of Object.entries(dependencyRecord)) {
    if (typeof rawDependency === "string") {
      dependencies[name] = rawDependency;
      continue;
    }

    const dependency = readRecord(rawDependency);
    const version = dependency?.version;
    const specifier = dependency?.specifier;
    if (typeof version === "string" && version !== "") {
      dependencies[name] = version;
    } else if (typeof specifier === "string" && specifier !== "") {
      dependencies[name] = specifier;
    }
  }

  return dependencies;
}

function readDependencyMap(value: unknown): Record<string, string> {
  const dependencies: Record<string, string> = {};
  const dependencyRecord = readRecord(value);
  if (!dependencyRecord) {
    return dependencies;
  }

  for (const [name, range] of Object.entries(dependencyRecord)) {
    if (typeof range === "string") {
      dependencies[name] = range;
    }
  }

  return dependencies;
}

function indexPackagesByName(records: PnpmPackageRecord[]): Map<string, PnpmPackageRecord[]> {
  const index = new Map<string, PnpmPackageRecord[]>();

  for (const record of records) {
    const entries = index.get(record.name) ?? [];
    entries.push(record);
    index.set(record.name, entries);
  }

  return index;
}

function resolvePackageRecord(input: {
  packageIndex: Map<string, PnpmPackageRecord[]>;
  name: string;
  range: string;
}): PnpmPackageRecord | undefined {
  const normalizedRange = normalizePnpmReference(input.range);
  const reference = resolveNpmDependencyReference(input.name, normalizedRange);
  const candidates = input.packageIndex.get(reference.lookupName) ?? [];

  if (candidates.length <= 1) {
    return candidates[0];
  }

  return candidates.find((candidate) => candidate.version === reference.lookupRange)
    ?? candidates.find((candidate) => reference.lookupRange.includes(candidate.version))
    ?? candidates[0];
}

function normalizePnpmReference(value: string): string {
  return value.replace(/^\//, "").replace(/\(.+\)$/, "").split("_")[0] ?? value;
}

function walkDependency(input: {
  record: PnpmPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  packageIndex: Map<string, PnpmPackageRecord[]>;
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
  requestedName?: string;
}): void {
  if (input.seen.has(input.record.key)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.key);

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

  for (const [childName, childRange] of Object.entries(input.record.dependencies)) {
    const child = resolvePackageRecord({
      packageIndex: input.packageIndex,
      name: childName,
      range: childRange
    });

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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
