import { omitUndefined } from "../shared/object";
import { existsSync, readdirSync, type Dirent } from "node:fs";
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
  checksum?: string;
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
  checksum?: string;
  dependencies: CargoDependencyEdge[];
};

type CargoRootDependency = {
  name: string;
  version?: string;
  type: DependencyType;
};

type CargoTraversalState = {
  record: CargoPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
};

const CARGO_MAX_PATHS_PER_PACKAGE = 64;

export type CargoWorkspaceMemberManifestPath = {
  memberPath: string;
  manifestPath: string;
  relativeManifestPath: string;
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

  const memberManifests = manifest.value
    ? readCargoWorkspaceMemberManifests({
        lockfilePath,
        rootManifestText: manifest.value,
        maxBytes: options.manifestMaxBytes ?? LOCKFILE_MAX_BYTES
      })
    : ok([]);
  if (!memberManifests.ok) {
    return memberManifests;
  }

  return parseCargoLockText(lockfileText.value, lockfilePath, omitUndefined({
    manifestText: manifest.value,
    memberManifestTexts: memberManifests.value
  }));
}

export function parseCargoLockText(
  input: string,
  lockfilePath = "Cargo.lock",
  options: { manifestText?: string; memberManifestTexts?: string[]; rootName?: string } = {}
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

    const rootName = options.rootName
      ?? readCargoPackageName(options.manifestText)
      ?? path.basename(path.dirname(lockfilePath))
      ?? "<cargo-project>";
    const rootDependencies = readCargoRootDependencies(omitUndefined({
      manifestText: options.manifestText,
      memberManifestTexts: options.memberManifestTexts,
      records
    }));
    const nodeMap = new Map<string, DependencyNode>();
    const recordIndex = indexCargoPackageRecords(records);
    const traversalStates: CargoTraversalState[] = [];
    const pathLimitAffected = new Set<string>();

    for (const rootDependency of rootDependencies) {
      const record = resolveCargoPackageRecord(records, omitUndefined({
        name: rootDependency.name,
        version: rootDependency.version
      }));
      if (!record) {
        continue;
      }

      traversalStates.push({
        record,
        dependencyType: rootDependency.type,
        direct: true,
        path: [rootName]
      });
    }

    walkCargoDependencies({
      states: traversalStates,
      recordIndex,
      nodeMap,
      pathLimitAffected
    });

    return ok({
      rootName,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ...(pathLimitAffected.size > 0
        ? {
            diagnostics: [{
              code: "dependency_paths_truncated",
              affectedNodeCount: pathLimitAffected.size,
              limit: CARGO_MAX_PATHS_PER_PACKAGE,
              message: "Cargo dependency paths were limited."
            }]
          }
        : {})
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

function readCargoWorkspaceMemberManifests(input: {
  lockfilePath: string;
  rootManifestText: string;
  maxBytes: number;
}): Result<string[], OhriskError> {
  const rootDir = path.dirname(input.lockfilePath);
  const manifestTexts: string[] = [];

  for (const memberManifest of findCargoWorkspaceMemberManifestPaths({
    rootManifestText: input.rootManifestText,
    lockfilePath: input.lockfilePath,
    projectRoot: rootDir
  })) {
    if (!existsSync(memberManifest.manifestPath)) {
      continue;
    }

    const manifestText = readInputTextFile({
      filePath: memberManifest.manifestPath,
      maxBytes: input.maxBytes
    });
    if (!manifestText.ok) {
      return err(
        createError({
          code: "CARGO_MANIFEST_READ_FAILED",
          category: inputFileReadErrorCategory(manifestText.error),
          message: manifestText.error.kind === "too_large"
            ? "Cargo workspace member Cargo.toml exceeded the maximum supported size."
            : "Failed to read Cargo workspace member Cargo.toml.",
          details: {
            manifestPath: memberManifest.manifestPath,
            ...inputFileReadErrorDetails(manifestText.error)
          }
        })
      );
    }

    manifestTexts.push(manifestText.value);
  }

  return ok(manifestTexts);
}

export function findCargoWorkspaceMemberManifestPathsFromRelativePaths(input: {
  rootManifestText: string;
  lockfilePath: string;
  projectRoot: string;
  relativePaths: Iterable<string>;
}): CargoWorkspaceMemberManifestPath[] {
  const projectRoot = path.resolve(input.projectRoot);
  const lockfileRoot = path.dirname(path.resolve(input.lockfilePath));
  const members = readCargoWorkspaceMembers(input.rootManifestText);
  const excludes = readCargoWorkspaceExcludes(input.rootManifestText);
  const paths = new Map<string, CargoWorkspaceMemberManifestPath>();

  for (const rawRelativeManifestPath of input.relativePaths) {
    const relativeManifestPath = normalizeProjectRelativeManifestPath(rawRelativeManifestPath);
    if (!relativeManifestPath || path.posix.basename(relativeManifestPath) !== "Cargo.toml") {
      continue;
    }

    const manifestPath = path.resolve(projectRoot, ...relativeManifestPath.split("/"));
    if (!isInsideDirectory(projectRoot, manifestPath) || manifestPath === path.join(lockfileRoot, "Cargo.toml")) {
      continue;
    }

    const memberPath = normalizeCargoWorkspaceMemberPath(
      path.relative(lockfileRoot, path.dirname(manifestPath))
    );
    if (!memberPath) {
      continue;
    }
    if (
      !members.some((pattern) => cargoWorkspaceMemberPatternMatches(memberPath, pattern))
      || excludes.some((pattern) => cargoWorkspaceMemberPatternMatches(memberPath, pattern))
    ) {
      continue;
    }

    paths.set(relativeManifestPath, {
      memberPath,
      manifestPath,
      relativeManifestPath
    });
  }

  return [...paths.values()].sort((left, right) =>
    left.relativeManifestPath.localeCompare(right.relativeManifestPath)
  );
}

export function findCargoWorkspaceMemberManifestPaths(input: {
  rootManifestText: string;
  lockfilePath: string;
  projectRoot: string;
}): CargoWorkspaceMemberManifestPath[] {
  const rootDir = path.dirname(input.lockfilePath);
  const paths = new Map<string, CargoWorkspaceMemberManifestPath>();
  const excludedMemberPaths = new Set<string>();

  for (const excludePath of readCargoWorkspaceExcludes(input.rootManifestText)) {
    if (path.isAbsolute(excludePath)) {
      continue;
    }

    for (const resolvedExcludePath of expandCargoWorkspaceMemberPath({
      memberPath: excludePath,
      rootDir,
      projectRoot: input.projectRoot
    })) {
      const normalizedExcludePath = normalizeCargoWorkspaceMemberPath(resolvedExcludePath);
      if (normalizedExcludePath) {
        excludedMemberPaths.add(normalizedExcludePath);
      }
    }
  }

  for (const memberPath of readCargoWorkspaceMembers(input.rootManifestText)) {
    if (path.isAbsolute(memberPath)) {
      continue;
    }

    for (const resolvedMemberPath of expandCargoWorkspaceMemberPath({
      memberPath,
      rootDir,
      projectRoot: input.projectRoot
    })) {
      const normalizedMemberPath = normalizeCargoWorkspaceMemberPath(resolvedMemberPath);
      if (!normalizedMemberPath || excludedMemberPaths.has(normalizedMemberPath)) {
        continue;
      }

      const manifestPath = path.resolve(rootDir, normalizedMemberPath, "Cargo.toml");
      if (!isInsideDirectory(input.projectRoot, manifestPath)) {
        continue;
      }

      const relativeManifestPath = normalizeRelativePath(
        path.relative(input.projectRoot, manifestPath)
      );
      if (!relativeManifestPath) {
        continue;
      }

      paths.set(relativeManifestPath, {
        memberPath: normalizedMemberPath,
        manifestPath,
        relativeManifestPath
      });
    }
  }

  return [...paths.values()].sort((left, right) =>
    left.relativeManifestPath.localeCompare(right.relativeManifestPath)
  );
}

function normalizeProjectRelativeManifestPath(value: string): string | undefined {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
  ) {
    return undefined;
  }
  return normalized;
}

function cargoWorkspaceMemberPatternMatches(memberPath: string, rawPattern: string): boolean {
  const normalizedPattern = rawPattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const memberSegments = memberPath.split("/").filter(Boolean);
  const patternSegments = normalizedPattern.split("/").filter(Boolean);
  if (memberSegments.length !== patternSegments.length) {
    return false;
  }
  return patternSegments.every((segment, index) =>
    cargoWorkspaceGlobSegmentPattern(segment).test(memberSegments[index] ?? "")
  );
}

function expandCargoWorkspaceMemberPath(input: {
  memberPath: string;
  rootDir: string;
  projectRoot: string;
}): string[] {
  if (!hasCargoWorkspaceGlob(input.memberPath)) {
    return [input.memberPath];
  }

  const normalizedMemberPath = input.memberPath.replace(/\\/g, "/");
  const segments = normalizedMemberPath.split("/").filter((segment) => segment.length > 0);

  const expandedPaths = expandCargoWorkspaceMemberSegments({
    segments,
    index: 0,
    currentPath: input.rootDir,
    relativeSegments: [],
    projectRoot: input.projectRoot
  });

  return expandedPaths
    .filter((memberPath) => existsSync(path.resolve(input.rootDir, memberPath, "Cargo.toml")))
    .sort((left, right) => left.localeCompare(right));
}

function expandCargoWorkspaceMemberSegments(input: {
  segments: string[];
  index: number;
  currentPath: string;
  relativeSegments: string[];
  projectRoot: string;
}): string[] {
  if (input.index >= input.segments.length) {
    return [input.relativeSegments.join("/")];
  }

  const segment = input.segments[input.index];
  if (!segment) {
    return [];
  }

  if (!hasCargoWorkspaceGlob(segment)) {
    const nextPath = path.resolve(input.currentPath, segment);
    if (!isInsideDirectory(input.projectRoot, nextPath)) {
      return [];
    }

    return expandCargoWorkspaceMemberSegments({
      segments: input.segments,
      index: input.index + 1,
      currentPath: nextPath,
      relativeSegments: [...input.relativeSegments, segment],
      projectRoot: input.projectRoot
    });
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(input.currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const globPattern = cargoWorkspaceGlobSegmentPattern(segment);

  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => globPattern.test(entry.name))
    .flatMap((entry) => {
      const nextPath = path.resolve(input.currentPath, entry.name);
      if (!isInsideDirectory(input.projectRoot, nextPath)) {
        return [];
      }

      return expandCargoWorkspaceMemberSegments({
        segments: input.segments,
        index: input.index + 1,
        currentPath: nextPath,
        relativeSegments: [...input.relativeSegments, entry.name],
        projectRoot: input.projectRoot
      });
    });
}

function hasCargoWorkspaceGlob(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function cargoWorkspaceGlobSegmentPattern(segment: string): RegExp {
  const escaped = segment.replace(/[\\^$+*?.()|[\]{}]/g, "\\$&");
  const pattern = escaped
    .replace(/\\\*/g, "[^/]*")
    .replace(/\\\?/g, "[^/]");
  return new RegExp(`^${pattern}$`);
}

function readCargoWorkspaceMembers(input: string): string[] {
  return readCargoWorkspaceStringArray(input, "members");
}

function readCargoWorkspaceExcludes(input: string): string[] {
  return readCargoWorkspaceStringArray(input, "exclude");
}

function readCargoWorkspaceStringArray(input: string, key: "exclude" | "members"): string[] {
  const members: string[] = [];
  let section = "";
  let activeMembersArray: string[] | undefined;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (activeMembersArray) {
      activeMembersArray.push(line);
      if (line.includes("]")) {
        members.push(...readTomlStringArray(activeMembersArray.join("\n")));
        activeMembersArray = undefined;
      }
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }

    if (section === "workspace" && line.startsWith(key) && line.includes("=")) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value.includes("[") && value.includes("]")) {
        members.push(...readTomlStringArray(value));
      } else if (value.startsWith("[")) {
        activeMembersArray = [value];
      }
    }
  }

  return [...new Set(members)];
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
      ...(current.checksum ? { checksum: current.checksum } : {}),
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

    const checksum = readStringAssignment(line, "checksum");
    if (checksum !== undefined) {
      current.checksum = checksum;
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
  memberManifestTexts?: string[];
  records: CargoPackageRecord[];
}): CargoRootDependency[] {
  const manifestTexts = [
    ...(input.manifestText ? [input.manifestText] : []),
    ...(input.memberManifestTexts ?? [])
  ];

  if (manifestTexts.length > 0) {
    const roots = mergeCargoManifestRootDependencies(manifestTexts, input.records);
    if (roots.length > 0) {
      return roots;
    }
  }

  return inferCargoRootDependencies(input.records);
}

function mergeCargoManifestRootDependencies(
  manifestTexts: string[],
  records: CargoPackageRecord[]
): CargoRootDependency[] {
  const roots = new Map<string, CargoRootDependency>();
  const workspacePackageAliases = mergeCargoWorkspaceDependencyPackageAliases(manifestTexts);

  for (const manifestText of manifestTexts) {
    for (const dependency of parseCargoManifestRootDependencies(
      manifestText,
      records,
      workspacePackageAliases
    )) {
      const existing = roots.get(dependency.name);
      roots.set(dependency.name, existing
        ? omitUndefined({
            name: dependency.name,
            version: existing.version ?? dependency.version,
            type: mergeDependencyType(existing.type, dependency.type)
          })
        : dependency);
    }
  }

  return [...roots.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function parseCargoManifestRootDependencies(
  input: string,
  records: CargoPackageRecord[],
  workspacePackageAliases = new Map<string, string>()
): CargoRootDependency[] {
  const roots = new Map<string, DependencyType>();
  let section = "";
  let activeDependencyTable: {
    name: string;
    packageName?: string;
    workspace?: boolean;
    type: DependencyType;
  } | undefined;

  const flushDependencyTable = (): void => {
    if (!activeDependencyTable) {
      return;
    }

    const dependencyName = activeDependencyTable.workspace === true
      ? workspacePackageAliases.get(activeDependencyTable.name)
        ?? activeDependencyTable.packageName
        ?? activeDependencyTable.name
      : activeDependencyTable.packageName ?? activeDependencyTable.name;

    mergeRootDependency(roots, dependencyName, activeDependencyTable.type);
    activeDependencyTable = undefined;
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      flushDependencyTable();
      section = line.slice(1, -1);
      activeDependencyTable = readCargoManifestDependencyTable(section);
      continue;
    }

    if (activeDependencyTable) {
      const packageName = readStringAssignment(line, "package");
      if (packageName) {
        activeDependencyTable.packageName = packageName;
      }
      const workspace = readBooleanAssignment(line, "workspace");
      if (workspace !== undefined) {
        activeDependencyTable.workspace = workspace;
      }
      const optional = readBooleanAssignment(line, "optional");
      if (optional === true && activeDependencyTable.type === "production") {
        activeDependencyTable.type = "optional";
      }
      continue;
    }

    const dependencyType = dependencyTypeForCargoManifestSection(section);
    if (!dependencyType) {
      continue;
    }

    const dependency = readCargoManifestDependency(line, workspacePackageAliases);
    if (dependency) {
      mergeRootDependency(roots, dependency, dependencyType);
    }
  }

  flushDependencyTable();

  const rootPackage = resolveCargoRootPackageRecord(input, records);

  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({
      name,
      ...cargoRootDependencyVersion(rootPackage, name),
      type
    }));
}

function readCargoManifestDependencyTable(
  section: string
): { name: string; type: DependencyType } | undefined {
  const parts = splitTomlDottedKey(section).map(unquoteTomlKey);
  if (parts.length < 2) {
    return undefined;
  }

  const dependencyName = parts.at(-1);
  if (!dependencyName) {
    return undefined;
  }

  if (parts[0] === "dependencies" && parts.length === 2) {
    return {
      name: dependencyName,
      type: "production"
    };
  }

  if (
    (parts[0] === "dev-dependencies" || parts[0] === "build-dependencies")
    && parts.length === 2
  ) {
    return {
      name: dependencyName,
      type: "development"
    };
  }

  if (parts[0] !== "target" || parts.length < 4) {
    return undefined;
  }

  const dependencySection = parts.at(-2);
  if (dependencySection === "dependencies") {
    return {
      name: dependencyName,
      type: "production"
    };
  }

  if (dependencySection === "dev-dependencies" || dependencySection === "build-dependencies") {
    return {
      name: dependencyName,
      type: "development"
    };
  }

  return undefined;
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

function readCargoManifestDependency(
  line: string,
  workspacePackageAliases = new Map<string, string>()
): string | undefined {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const rawKey = line.slice(0, separatorIndex).trim();
  const key = unquoteTomlKey(rawKey);
  const value = line.slice(separatorIndex + 1).trim();
  const workspaceDependencyName = readCargoWorkspaceDottedDependencyKey(rawKey, value);
  if (workspaceDependencyName) {
    return workspacePackageAliases.get(workspaceDependencyName) ?? workspaceDependencyName;
  }

  const packageName = readInlineTableString(value, "package");
  if (readInlineTableBoolean(value, "workspace") === true) {
    return workspacePackageAliases.get(key) ?? packageName ?? key;
  }

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

function walkCargoDependencies(input: {
  states: CargoTraversalState[];
  recordIndex: ReadonlyMap<string, CargoPackageRecord[]>;
  nodeMap: Map<string, DependencyNode>;
  pathLimitAffected: Set<string>;
}): void {
  const stack = [...input.states].reverse();
  const pathKeysByNodeId = new Map<string, Set<string>>();
  const expandedPathTypesByNodeId = new Map<string, Set<string>>();

  while (stack.length > 0) {
    const state = stack.pop();
    if (!state || state.path.includes(state.record.id)) {
      continue;
    }

    const nextPath = [...state.path, state.record.id];
    const pathKey = JSON.stringify(nextPath);
    const existing = input.nodeMap.get(state.record.id);
    const previousDependencyType = existing?.dependencyType;
    const mergedDependencyType = previousDependencyType
      ? mergeDependencyType(previousDependencyType, state.dependencyType)
      : state.dependencyType;
    const dependencyTypeStrengthened = previousDependencyType !== undefined
      && mergedDependencyType !== previousDependencyType;

    const node = existing ?? omitUndefined<DependencyNode>({
      id: state.record.id,
      name: state.record.name,
      version: state.record.version,
      ecosystem: "cargo",
      resolved: state.record.source,
      integrity: cargoChecksumIntegrity(state.record.checksum),
      dependencyType: mergedDependencyType,
      direct: state.direct,
      paths: []
    });
    node.direct = node.direct || state.direct;
    node.dependencyType = mergedDependencyType;
    if (!existing) {
      input.nodeMap.set(state.record.id, node);
    }

    const pathKeys = pathKeysByNodeId.get(state.record.id) ?? new Set<string>();
    let traversalPath: string[] | undefined;
    if (pathKeys.has(pathKey)) {
      traversalPath = dependencyTypeStrengthened ? nextPath : undefined;
    } else if (pathKeys.size < CARGO_MAX_PATHS_PER_PACKAGE) {
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
      const dependency = state.record.dependencies[index];
      if (!dependency) {
        continue;
      }
      const record = resolveCargoPackageRecordFromIndex(input.recordIndex, dependency);
      if (!record) {
        continue;
      }

      stack.push({
        record,
        dependencyType: state.dependencyType,
        direct: false,
        path: traversalPath
      });
    }
  }
}

function cargoChecksumIntegrity(checksum: string | undefined): string | undefined {
  if (!checksum || !/^[0-9a-f]{64}$/u.test(checksum)) {
    return undefined;
  }
  return `sha256-${Buffer.from(checksum, "hex").toString("base64")}`;
}

function indexCargoPackageRecords(
  records: CargoPackageRecord[]
): Map<string, CargoPackageRecord[]> {
  const byName = new Map<string, CargoPackageRecord[]>();
  for (const record of records) {
    const matches = byName.get(record.name) ?? [];
    matches.push(record);
    byName.set(record.name, matches);
  }
  return byName;
}

function resolveCargoPackageRecordFromIndex(
  recordIndex: ReadonlyMap<string, CargoPackageRecord[]>,
  dependency: { name: string; version?: string }
): CargoPackageRecord | undefined {
  const matches = (recordIndex.get(dependency.name) ?? []).filter((record) =>
    dependency.version === undefined || record.version === dependency.version
  );
  return matches.length === 1 ? matches[0] : undefined;
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

function readBooleanAssignment(line: string, key: string): boolean | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(true|false)\\b`).exec(line);
  if (!match) {
    return undefined;
  }

  return match[1] === "true";
}

function readInlineTableString(value: string, key: string): string | undefined {
  const match = new RegExp(`\\b${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(value);
  return match?.[1];
}

function readInlineTableBoolean(value: string, key: string): boolean | undefined {
  const match = new RegExp(`\\b${escapeRegExp(key)}\\s*=\\s*(true|false)\\b`).exec(value);
  if (!match) {
    return undefined;
  }

  return match[1] === "true";
}

function readTomlStringArray(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((item): item is string => item !== undefined && item !== "");
}

function mergeCargoWorkspaceDependencyPackageAliases(manifestTexts: string[]): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const manifestText of manifestTexts) {
    for (const [alias, packageName] of readCargoWorkspaceDependencyPackageAliases(manifestText)) {
      aliases.set(alias, packageName);
    }
  }

  return aliases;
}

function readCargoWorkspaceDependencyPackageAliases(input: string): Map<string, string> {
  const aliases = new Map<string, string>();
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

    if (section !== "workspace.dependencies") {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const alias = unquoteTomlKey(line.slice(0, separatorIndex).trim());
    const packageName = readInlineTableString(line.slice(separatorIndex + 1).trim(), "package");
    if (alias && packageName) {
      aliases.set(alias, packageName);
    }
  }

  return aliases;
}

function readCargoWorkspaceDottedDependencyKey(
  rawKey: string,
  value: string
): string | undefined {
  if (value !== "true") {
    return undefined;
  }

  const parts = splitTomlDottedKey(rawKey).map(unquoteTomlKey);
  if (parts.length !== 2 || parts[1] !== "workspace") {
    return undefined;
  }

  const dependencyName = parts[0];
  return dependencyName && dependencyName.length > 0 ? dependencyName : undefined;
}

function splitTomlDottedKey(key: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (const char of key) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "\"" && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === ".") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
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

function isInsideDirectory(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function normalizeRelativePath(relativePath: string): string | undefined {
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeCargoWorkspaceMemberPath(memberPath: string): string | undefined {
  const normalized = path.normalize(memberPath).replace(/\\/g, "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return undefined;
  }

  return normalized;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
