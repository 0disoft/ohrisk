import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  addUniqueInstallName,
  dependencyInstallName,
  formatDependencyPathSegment,
  parseNpmAliasReference,
  resolveNpmDependencyReference
} from "./npm-spec";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PnpmLockShape = {
  lockfileVersion?: unknown;
  importers?: unknown;
  packages?: unknown;
  snapshots?: unknown;
};

type PnpmWorkspaceShape = {
  catalog?: unknown;
  catalogs?: unknown;
};

type PnpmCatalogs = {
  defaultCatalog: Record<string, string>;
  namedCatalogs: Map<string, Record<string, string>>;
};

type PnpmPackageRecord = {
  key: string;
  name: string;
  version: string;
  id: string;
  resolved?: string;
  integrity?: string;
  dependencies: PnpmDependencyEdge[];
};

type PnpmDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
};

type PnpmImporterEntry = {
  importer: Record<string, unknown>;
  pathSegment: string;
};

export function parsePnpmLockfile(
  lockfilePath: string,
  options: {
    maxBytes?: number;
    workspaceMaxBytes?: number;
  } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "PNPM_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "pnpm-lock.yaml exceeded the maximum supported size."
          : "Failed to read pnpm-lock.yaml.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const workspaceCatalogs = readPnpmWorkspaceCatalogs({
    lockfilePath,
    maxBytes: options.workspaceMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!workspaceCatalogs.ok) {
    return workspaceCatalogs;
  }

  return parsePnpmLockText(lockfileText.value, lockfilePath, {
    catalogs: workspaceCatalogs.value
  });
}

export function parsePnpmLockText(
  input: string,
  lockfilePath = "pnpm-lock.yaml",
  options: {
    workspaceText?: string;
    workspacePath?: string;
    catalogs?: PnpmCatalogs;
  } = {}
): Result<DependencyGraph, OhriskError> {
  const parsed = parseLockfileYaml(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const catalogs = resolvePnpmCatalogs(omitUndefined({
    workspaceText: options.workspaceText,
    workspacePath: options.workspacePath,
    catalogs: options.catalogs
  }));
  if (!catalogs.ok) {
    return catalogs;
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

  const importerEntries = readImporterEntries(importers, catalogs.value);
  const packages = readRecord(lockfile.packages) ?? {};
  const snapshots = readRecord(lockfile.snapshots) ?? {};
  const records = parsePackageRecords({
    packages,
    snapshots,
    catalogs: catalogs.value
  });
  const packageIndex = indexPackagesByName(records);
  const nodeMap = new Map<string, DependencyNode>();

  for (const importerEntry of importerEntries) {
    for (const rootDependency of collectRootDependencies(importerEntry.importer, catalogs.value)) {
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
        path: [importerEntry.pathSegment],
        packageIndex,
        nodeMap,
        seen: new Set(),
        requestedName: rootDependency.name
      });
    }
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

function readPnpmWorkspaceCatalogs(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<PnpmCatalogs, OhriskError> {
  const workspacePath = path.join(path.dirname(input.lockfilePath), "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    return ok(emptyPnpmCatalogs());
  }

  const workspaceText = readInputTextFile({
    filePath: workspacePath,
    maxBytes: input.maxBytes
  });
  if (!workspaceText.ok) {
    return err(
      createError({
        code: "PNPM_WORKSPACE_READ_FAILED",
        category: inputFileReadErrorCategory(workspaceText.error),
        message: workspaceText.error.kind === "too_large"
          ? "pnpm-workspace.yaml exceeded the maximum supported size."
          : "Failed to read pnpm-workspace.yaml.",
        details: {
          workspacePath,
          ...inputFileReadErrorDetails(workspaceText.error)
        }
      })
    );
  }

  return parsePnpmWorkspaceCatalogsText(workspaceText.value, workspacePath);
}

function resolvePnpmCatalogs(input: {
  workspaceText?: string;
  workspacePath?: string;
  catalogs?: PnpmCatalogs;
}): Result<PnpmCatalogs, OhriskError> {
  if (input.catalogs) {
    return ok(input.catalogs);
  }

  if (input.workspaceText !== undefined) {
    return parsePnpmWorkspaceCatalogsText(
      input.workspaceText,
      input.workspacePath ?? "pnpm-workspace.yaml"
    );
  }

  return ok(emptyPnpmCatalogs());
}

function parsePnpmWorkspaceCatalogsText(
  input: string,
  workspacePath: string
): Result<PnpmCatalogs, OhriskError> {
  try {
    const parsed = parseYaml(input) as unknown;
    if (parsed === null || parsed === undefined) {
      return ok(emptyPnpmCatalogs());
    }

    if (!isObjectRecord(parsed)) {
      throw new Error("Expected a YAML mapping at the document root.");
    }

    const workspace = parsed as PnpmWorkspaceShape;
    const namedCatalogs = new Map<string, Record<string, string>>();
    const catalogs = readRecord(workspace.catalogs);
    if (catalogs) {
      for (const [name, value] of Object.entries(catalogs)) {
        const catalog = readCatalogMap(value);
        if (catalog) {
          namedCatalogs.set(name, catalog);
        }
      }
    }

    return ok({
      defaultCatalog: readCatalogMap(workspace.catalog) ?? {},
      namedCatalogs
    });
  } catch (cause) {
    return err(
      createError({
        code: "PNPM_WORKSPACE_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pnpm-workspace.yaml catalog definitions.",
        details: {
          workspacePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function emptyPnpmCatalogs(): PnpmCatalogs {
  return {
    defaultCatalog: {},
    namedCatalogs: new Map()
  };
}

function readCatalogMap(value: unknown): Record<string, string> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const catalog: Record<string, string> = {};
  for (const [name, range] of Object.entries(record)) {
    if (typeof range === "string" && range !== "") {
      catalog[name] = range;
    }
  }

  return catalog;
}

function readImporterEntries(
  importers: Record<string, unknown>,
  catalogs: PnpmCatalogs
): PnpmImporterEntry[] {
  return Object.entries(importers).flatMap(([key, value]) => {
    const importer = readRecord(value);
    if (!importer) {
      return [];
    }

    return [{
      importer: resolveImporterCatalogReferences(importer, catalogs),
      pathSegment: importerPathSegment(key)
    }];
  });
}

function importerPathSegment(key: string): string {
  return key === "." ? "<root>" : key;
}

function parsePackageRecords(input: {
  packages: Record<string, unknown>;
  snapshots: Record<string, unknown>;
  catalogs: PnpmCatalogs;
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
      dependencies: collectDependencyEdges(input.catalogs, packageEntry, snapshotEntry)
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
  const alias = parseNpmAliasReference(withoutPeerSuffix);
  if (alias) {
    return { name: alias.name, version: alias.reference };
  }

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

function resolveImporterCatalogReferences(
  importer: Record<string, unknown>,
  catalogs: PnpmCatalogs
): Record<string, unknown> {
  return {
    ...importer,
    dependencies: resolveDependencyCatalogReferences(importer.dependencies, catalogs),
    devDependencies: resolveDependencyCatalogReferences(importer.devDependencies, catalogs),
    optionalDependencies: resolveDependencyCatalogReferences(importer.optionalDependencies, catalogs),
    peerDependencies: resolveDependencyCatalogReferences(importer.peerDependencies, catalogs)
  };
}

function resolveDependencyCatalogReferences(
  value: unknown,
  catalogs: PnpmCatalogs
): unknown {
  const dependencies = readRecord(value);
  if (!dependencies) {
    return value;
  }

  const resolved: Record<string, unknown> = {};
  for (const [name, rawDependency] of Object.entries(dependencies)) {
    if (typeof rawDependency === "string") {
      resolved[name] = resolveCatalogRange({
        name,
        range: rawDependency,
        catalogs
      });
      continue;
    }

    const dependency = readRecord(rawDependency);
    if (!dependency) {
      resolved[name] = rawDependency;
      continue;
    }

    const version = typeof dependency.version === "string"
      ? resolveCatalogRange({
          name,
          range: dependency.version,
          catalogs
        })
      : dependency.version;
    const specifier = typeof dependency.specifier === "string"
      ? resolveCatalogRange({
          name,
          range: dependency.specifier,
          catalogs
        })
      : dependency.specifier;
    resolved[name] = {
      ...dependency,
      ...(version !== undefined ? { version } : {}),
      ...(specifier !== undefined ? { specifier } : {})
    };
  }

  return resolved;
}

function resolveCatalogRange(input: {
  name: string;
  range: string;
  catalogs: PnpmCatalogs;
}): string {
  const catalogName = parseCatalogReference(input.range);
  if (catalogName === undefined) {
    return input.range;
  }

  const catalog = catalogName === ""
    ? input.catalogs.defaultCatalog
    : input.catalogs.namedCatalogs.get(catalogName);
  return catalog?.[input.name] ?? input.range;
}

function parseCatalogReference(value: string): string | undefined {
  if (value === "catalog:") {
    return "";
  }

  if (!value.startsWith("catalog:")) {
    return undefined;
  }

  return value.slice("catalog:".length);
}

function collectRootDependencies(
  importer: Record<string, unknown> | undefined,
  catalogs: PnpmCatalogs
): PnpmDependencyEdge[] {
  if (!importer) {
    return [];
  }

  return collectDependencyEdges(catalogs, importer);
}

function collectDependencyEdges(
  catalogs: PnpmCatalogs,
  ...sources: Record<string, unknown>[]
): PnpmDependencyEdge[] {
  return sources.flatMap((source) => [
    ...dependencyEntries(source.dependencies, "production", catalogs),
    ...dependencyEntries(source.devDependencies, "development", catalogs),
    ...dependencyEntries(source.optionalDependencies, "optional", catalogs),
    ...dependencyEntries(source.peerDependencies, "peer", catalogs)
  ]);
}

function dependencyEntries(
  value: unknown,
  type: DependencyType,
  catalogs: PnpmCatalogs
): PnpmDependencyEdge[] {
  return Object.entries(readImporterDependencyMap(value)).map(([name, range]) => ({
    name,
    range: resolveCatalogRange({
      name,
      range,
      catalogs
    }),
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
    ?? undefined;
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
    const installNames = addUniqueInstallName({
      current: existing.installNames,
      installName
    });
    if (installNames !== undefined) {
      existing.installNames = installNames;
    }
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
    const childRecord = resolvePackageRecord({
      packageIndex: input.packageIndex,
      name: child.name,
      range: child.range
    });

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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
