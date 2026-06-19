import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

const require = createRequire(import.meta.url);
const yarnLockfile = require("@yarnpkg/lockfile") as {
  parse: (input: string) => {
    type: "success" | "merge" | "conflict";
    object: Record<string, YarnLockEntry>;
  };
};

type YarnLockEntry = {
  version?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
};

type YarnPackageRecord = {
  key: string;
  descriptors: string[];
  name: string;
  version: string;
  id: string;
  resolved?: string;
  integrity?: string;
  dependencies: YarnDependencyEdge[];
};

type PackageJsonShape = {
  name?: unknown;
  workspaces?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
};

type YarnWorkspacePackageJsonInput = {
  packageJsonText: string;
  packageJsonPath?: string;
  workspacePath?: string;
};

type YarnRootEntry = {
  packageJson: PackageJsonShape;
  pathSegment: string;
};

type YarnDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
};

export function parseYarnLockfile(
  lockfilePath: string,
  packageJsonPath = path.join(path.dirname(lockfilePath), "package.json")
): Result<DependencyGraph, OhriskError> {
  let lockfileText: string;
  let packageJsonText: string;

  try {
    lockfileText = readFileSync(lockfilePath, "utf8");
  } catch (cause) {
    return err(
      createError({
        code: "YARN_LOCK_READ_FAILED",
        category: "filesystem",
        message: "Failed to read yarn.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  try {
    packageJsonText = readFileSync(packageJsonPath, "utf8");
  } catch (cause) {
    return err(
      createError({
        code: "YARN_PACKAGE_JSON_READ_FAILED",
        category: "filesystem",
        message: "Failed to read package.json for yarn.lock root dependencies.",
        details: {
          lockfilePath,
          packageJsonPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const parsedRootPackageJson = parsePackageJson(packageJsonText, packageJsonPath);
  if (!parsedRootPackageJson.ok) {
    return parsedRootPackageJson;
  }

  const workspacePackageJsonTexts = readWorkspacePackageJsonTexts({
    projectRoot: path.dirname(packageJsonPath),
    rootPackageJson: parsedRootPackageJson.value,
    lockfilePath
  });
  if (!workspacePackageJsonTexts.ok) {
    return workspacePackageJsonTexts;
  }

  return parseYarnLockText({
    lockfileText,
    packageJsonText,
    lockfilePath,
    packageJsonPath,
    workspacePackageJsonTexts: workspacePackageJsonTexts.value
  });
}

export function parseYarnLockText(input: {
  lockfileText: string;
  packageJsonText: string;
  lockfilePath?: string;
  packageJsonPath?: string;
  workspacePackageJsonTexts?: YarnWorkspacePackageJsonInput[];
}): Result<DependencyGraph, OhriskError> {
  const lockfilePath = input.lockfilePath ?? "yarn.lock";
  const packageJsonPath = input.packageJsonPath ?? "package.json";
  const parsedPackageJson = parsePackageJson(input.packageJsonText, packageJsonPath);
  if (!parsedPackageJson.ok) {
    return parsedPackageJson;
  }

  const parsedWorkspacePackageJsons = parseWorkspacePackageJsons(
    input.workspacePackageJsonTexts ?? []
  );
  if (!parsedWorkspacePackageJsons.ok) {
    return parsedWorkspacePackageJsons;
  }

  const parsedLockfile = parseLockfile(input.lockfileText, lockfilePath);
  if (!parsedLockfile.ok) {
    return parsedLockfile;
  }

  const rootName = typeof parsedPackageJson.value.name === "string"
    ? parsedPackageJson.value.name
    : undefined;
  const records = parsePackageRecords(parsedLockfile.value);
  const descriptorIndex = indexPackagesByDescriptor(records);
  const nameIndex = indexPackagesByName(records);
  const rootEntries: YarnRootEntry[] = [
    {
      packageJson: parsedPackageJson.value,
      pathSegment: rootName ?? "<root>"
    },
    ...parsedWorkspacePackageJsons.value
  ];
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootEntry of rootEntries) {
    for (const rootDependency of collectRootDependencies(rootEntry.packageJson)) {
      const record = resolvePackageRecord({
        descriptorIndex,
        nameIndex,
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
        path: [rootEntry.pathSegment],
        descriptorIndex,
        nameIndex,
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

function parsePackageJson(
  input: string,
  packageJsonPath: string
): Result<PackageJsonShape, OhriskError> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error("Expected package.json to contain an object.");
    }

    return ok(parsed as PackageJsonShape);
  } catch (cause) {
    return err(
      createError({
        code: "YARN_PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json for yarn.lock root dependencies.",
        details: {
          packageJsonPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseWorkspacePackageJsons(
  workspaces: YarnWorkspacePackageJsonInput[]
): Result<YarnRootEntry[], OhriskError> {
  const entries: YarnRootEntry[] = [];

  for (const workspace of workspaces) {
    const packageJsonPath = workspace.packageJsonPath ?? "workspace-package.json";
    const parsed = parsePackageJson(workspace.packageJsonText, packageJsonPath);
    if (!parsed.ok) {
      return parsed;
    }

    entries.push({
      packageJson: parsed.value,
      pathSegment: readPackageName(parsed.value)
        ?? workspace.workspacePath
        ?? packageJsonPath
    });
  }

  return ok(entries);
}

function readWorkspacePackageJsonTexts(input: {
  projectRoot: string;
  rootPackageJson: PackageJsonShape;
  lockfilePath: string;
}): Result<YarnWorkspacePackageJsonInput[], OhriskError> {
  const packageJsons: YarnWorkspacePackageJsonInput[] = [];
  const seen = new Set<string>();
  const patterns = readWorkspacePatterns(input.rootPackageJson.workspaces);
  const excludedWorkspacePaths = new Set(
    patterns
      .filter((pattern) => pattern.startsWith("!"))
      .flatMap((pattern) => expandWorkspacePattern(input.projectRoot, pattern.slice(1)))
      .map((workspacePath) => path.resolve(workspacePath))
  );

  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      continue;
    }

    for (const workspacePath of expandWorkspacePattern(input.projectRoot, pattern)) {
      const packageJsonPath = path.join(workspacePath, "package.json");
      if (
        seen.has(packageJsonPath)
        || excludedWorkspacePaths.has(path.resolve(workspacePath))
        || !existsSync(packageJsonPath)
      ) {
        continue;
      }

      try {
        packageJsons.push({
          packageJsonText: readFileSync(packageJsonPath, "utf8"),
          packageJsonPath,
          workspacePath: path.relative(input.projectRoot, workspacePath).replace(/\\/g, "/")
        });
        seen.add(packageJsonPath);
      } catch (cause) {
        return err(
          createError({
            code: "YARN_WORKSPACE_PACKAGE_JSON_READ_FAILED",
            category: "filesystem",
            message: "Failed to read package.json for a Yarn workspace dependency root.",
            details: {
              lockfilePath: input.lockfilePath,
              packageJsonPath,
              cause: cause instanceof Error ? cause.message : String(cause)
            }
          })
        );
      }
    }
  }

  return ok(packageJsons);
}

function readWorkspacePatterns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (isObjectRecord(value) && Array.isArray(value.packages)) {
    return value.packages.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function expandWorkspacePattern(projectRoot: string, pattern: string): string[] {
  if (pattern.startsWith("!")) {
    return [];
  }

  const normalized = pattern.replace(/\\/g, "/").replace(/^\.?\//, "");
  const segments = normalized.split("/").filter(Boolean);
  return expandWorkspaceSegments(projectRoot, segments);
}

function expandWorkspaceSegments(currentPath: string, segments: string[]): string[] {
  if (segments.length === 0) {
    return isDirectory(currentPath) ? [currentPath] : [];
  }

  const [segment, ...rest] = segments;
  if (!segment) {
    return [];
  }

  if (segment === "**") {
    return [
      ...expandWorkspaceSegments(currentPath, rest),
      ...listChildDirectories(currentPath).flatMap((childPath) =>
        expandWorkspaceSegments(childPath, segments)
      )
    ];
  }

  if (segment.includes("*")) {
    const matcher = wildcardSegmentMatcher(segment);
    return listChildDirectories(currentPath)
      .filter((childPath) => matcher.test(path.basename(childPath)))
      .flatMap((childPath) => expandWorkspaceSegments(childPath, rest));
  }

  return expandWorkspaceSegments(path.join(currentPath, segment), rest);
}

function listChildDirectories(parentPath: string): string[] {
  try {
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => path.join(parentPath, entry.name));
  } catch {
    return [];
  }
}

function wildcardSegmentMatcher(segment: string): RegExp {
  const escaped = segment
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`);
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function readPackageName(packageJson: PackageJsonShape): string | undefined {
  return typeof packageJson.name === "string" && packageJson.name !== ""
    ? packageJson.name
    : undefined;
}

function parseLockfile(
  input: string,
  lockfilePath: string
): Result<Record<string, YarnLockEntry>, OhriskError> {
  try {
    if (hasMergeConflictMarkers(input)) {
      return err(
        createError({
          code: "YARN_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse yarn.lock because it contains unresolved merge conflicts.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const parsed = yarnLockfile.parse(input);
    if (parsed.type === "conflict") {
      return err(
        createError({
          code: "YARN_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse yarn.lock because it contains unresolved merge conflicts.",
          details: {
            lockfilePath
          }
        })
      );
    }

    return ok(parsed.object);
  } catch (cause) {
    return err(
      createError({
        code: "YARN_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse yarn.lock. Ohrisk currently supports Yarn v1 lockfiles.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function hasMergeConflictMarkers(input: string): boolean {
  return /^<<<<<<< .+$/m.test(input)
    || /^=======$/m.test(input)
    || /^>>>>>>> .+$/m.test(input);
}

function parsePackageRecords(lockfile: Record<string, YarnLockEntry>): YarnPackageRecord[] {
  const records: YarnPackageRecord[] = [];

  for (const [key, entry] of Object.entries(lockfile)) {
    if (typeof entry.version !== "string" || entry.version === "") {
      continue;
    }

    const descriptors = splitDescriptorKey(key);
    const identity = descriptors.map(parseDescriptor).find(Boolean);
    if (!identity) {
      continue;
    }

    const resolved = typeof entry.resolved === "string" && entry.resolved !== ""
      ? entry.resolved
      : undefined;
    const integrity = typeof entry.integrity === "string" && entry.integrity !== ""
      ? entry.integrity
      : undefined;

    records.push({
      key,
      descriptors,
      name: identity.name,
      version: entry.version,
      id: `${identity.name}@${entry.version}`,
      ...(resolved ? { resolved } : {}),
      ...(integrity ? { integrity } : {}),
      dependencies: collectEntryDependencies(entry)
    });
  }

  return records;
}

function splitDescriptorKey(key: string): string[] {
  return key.split(/,\s*/).map((descriptor) => descriptor.trim()).filter(Boolean);
}

function parseDescriptor(descriptor: string): { name: string; range: string } | undefined {
  const unquoted = descriptor.replace(/^"|"$/g, "");
  const aliasMarker = "@npm:";
  const aliasIndex = unquoted.indexOf(aliasMarker);
  if (aliasIndex > 0) {
    const aliasName = unquoted.slice(0, aliasIndex);
    const alias = parseNpmPackageReference(unquoted.slice(aliasIndex + 1));
    if (alias && aliasName) {
      return { name: alias.name, range: alias.reference };
    }
  }

  const parsed = parseNpmPackageReference(unquoted);
  if (!parsed) {
    return undefined;
  }

  return { name: parsed.name, range: parsed.reference };
}

function collectRootDependencies(packageJson: PackageJsonShape): YarnDependencyEdge[] {
  return [
    ...dependencyEntries(packageJson.dependencies, "production"),
    ...dependencyEntries(packageJson.devDependencies, "development"),
    ...dependencyEntries(packageJson.optionalDependencies, "optional"),
    ...dependencyEntries(packageJson.peerDependencies, "peer")
  ];
}

function collectEntryDependencies(entry: YarnLockEntry): YarnDependencyEdge[] {
  return [
    ...dependencyEntries(entry.dependencies, "production"),
    ...dependencyEntries(entry.optionalDependencies, "optional")
  ];
}

function dependencyEntries(value: unknown, type: DependencyType): YarnDependencyEdge[] {
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

function indexPackagesByDescriptor(records: YarnPackageRecord[]): Map<string, YarnPackageRecord> {
  const index = new Map<string, YarnPackageRecord>();

  for (const record of records) {
    for (const descriptor of record.descriptors) {
      index.set(descriptor.replace(/^"|"$/g, ""), record);
    }
  }

  return index;
}

function indexPackagesByName(records: YarnPackageRecord[]): Map<string, YarnPackageRecord[]> {
  const index = new Map<string, YarnPackageRecord[]>();

  for (const record of records) {
    const entries = index.get(record.name) ?? [];
    entries.push(record);
    index.set(record.name, entries);
  }

  return index;
}

function resolvePackageRecord(input: {
  descriptorIndex: Map<string, YarnPackageRecord>;
  nameIndex: Map<string, YarnPackageRecord[]>;
  name: string;
  range: string;
}): YarnPackageRecord | undefined {
  const descriptor = `${input.name}@${input.range}`;
  const reference = resolveNpmDependencyReference(input.name, input.range);
  const candidates = input.nameIndex.get(reference.lookupName) ?? [];

  return input.descriptorIndex.get(descriptor)
    ?? candidates.find((candidate) => candidate.version === reference.lookupRange)
    ?? candidates.find((candidate) => reference.lookupRange.includes(candidate.version))
    ?? candidates[0];
}

function walkDependency(input: {
  record: YarnPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  descriptorIndex: Map<string, YarnPackageRecord>;
  nameIndex: Map<string, YarnPackageRecord[]>;
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

  for (const child of input.record.dependencies) {
    const childRecord = resolvePackageRecord({
      descriptorIndex: input.descriptorIndex,
      nameIndex: input.nameIndex,
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
      descriptorIndex: input.descriptorIndex,
      nameIndex: input.nameIndex,
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
