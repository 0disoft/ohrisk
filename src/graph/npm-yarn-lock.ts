import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as yarnLockfileModule from "@yarnpkg/lockfile";
import { parse as parseYaml } from "yaml";

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
  PACKAGE_JSON_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

const yarnLockfile = yarnLockfileModule as {
  parse: (input: string) => {
    type: "success" | "merge" | "conflict";
    object: Record<string, YarnLockEntry>;
  };
};

type YarnLockEntry = {
  version?: unknown;
  resolution?: unknown;
  resolved?: unknown;
  integrity?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
};

type YarnLockFormat = "classic" | "berry";

type ParsedYarnLockfile = {
  format: YarnLockFormat;
  entries: Record<string, YarnLockEntry>;
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

export type YarnWorkspacePackageJsonInput = {
  packageJsonText: string;
  packageJsonPath?: string;
  workspacePath?: string;
};

export type YarnWorkspacePackageJsonPath = {
  packageJsonPath: string;
  relativePackageJsonPath: string;
  workspacePath: string;
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
  packageJsonPath = path.join(path.dirname(lockfilePath), "package.json"),
  options: {
    lockfileMaxBytes?: number;
    packageJsonMaxBytes?: number;
  } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.lockfileMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!lockfileText.ok) {
    return err(
      createError({
        code: "YARN_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "yarn.lock exceeded the maximum supported size."
          : "Failed to read yarn.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const packageJsonText = readInputTextFile({
    filePath: packageJsonPath,
    maxBytes: options.packageJsonMaxBytes ?? PACKAGE_JSON_MAX_BYTES
  });
  if (!packageJsonText.ok) {
    return err(
      createError({
        code: "YARN_PACKAGE_JSON_READ_FAILED",
        category: inputFileReadErrorCategory(packageJsonText.error),
        message: packageJsonText.error.kind === "too_large"
          ? "package.json for yarn.lock root dependencies exceeded the maximum supported size."
          : "Failed to read package.json for yarn.lock root dependencies.",
        details: {
          lockfilePath,
          packageJsonPath,
          ...inputFileReadErrorDetails(packageJsonText.error)
        }
      })
    );
  }

  const parsedRootPackageJson = parsePackageJson(packageJsonText.value, packageJsonPath);
  if (!parsedRootPackageJson.ok) {
    return parsedRootPackageJson;
  }

  const workspacePackageJsonTexts = readWorkspacePackageJsonTexts({
    projectRoot: path.dirname(packageJsonPath),
    rootPackageJson: parsedRootPackageJson.value,
    lockfilePath,
    packageJsonMaxBytes: options.packageJsonMaxBytes ?? PACKAGE_JSON_MAX_BYTES
  });
  if (!workspacePackageJsonTexts.ok) {
    return workspacePackageJsonTexts;
  }

  return parseYarnLockText({
    lockfileText: lockfileText.value,
    packageJsonText: packageJsonText.value,
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
    ...(rootName !== undefined ? { rootName } : {}),
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
  packageJsonMaxBytes: number;
}): Result<YarnWorkspacePackageJsonInput[], OhriskError> {
  const packageJsons: YarnWorkspacePackageJsonInput[] = [];
  const workspacePackageJsonPaths = findYarnWorkspacePackageJsonPaths({
    projectRoot: input.projectRoot,
    workspaces: input.rootPackageJson.workspaces
  });

  for (const workspacePackageJsonPath of workspacePackageJsonPaths) {
    const packageJsonText = readInputTextFile({
      filePath: workspacePackageJsonPath.packageJsonPath,
      maxBytes: input.packageJsonMaxBytes
    });

    if (packageJsonText.ok) {
      packageJsons.push({
        packageJsonText: packageJsonText.value,
        packageJsonPath: workspacePackageJsonPath.packageJsonPath,
        workspacePath: workspacePackageJsonPath.workspacePath
      });
      continue;
    }

    return err(
      createError({
        code: "YARN_WORKSPACE_PACKAGE_JSON_READ_FAILED",
        category: inputFileReadErrorCategory(packageJsonText.error),
        message: packageJsonText.error.kind === "too_large"
          ? "package.json for a Yarn workspace dependency root exceeded the maximum supported size."
          : "Failed to read package.json for a Yarn workspace dependency root.",
        details: {
          lockfilePath: input.lockfilePath,
          packageJsonPath: workspacePackageJsonPath.packageJsonPath,
          ...inputFileReadErrorDetails(packageJsonText.error)
        }
      })
    );
  }

  return ok(packageJsons);
}

export function findYarnWorkspacePackageJsonPathsFromRelativePaths(input: {
  projectRoot: string;
  workspaces: unknown;
  relativePaths: Iterable<string>;
}): YarnWorkspacePackageJsonPath[] {
  const projectRoot = path.resolve(input.projectRoot);
  const patterns = readWorkspacePatterns(input.workspaces);
  const includedPatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludedPatterns = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  const locations = new Map<string, YarnWorkspacePackageJsonPath>();

  for (const rawRelativePath of input.relativePaths) {
    const relativePackageJsonPath = normalizeWorkspaceRelativePath(rawRelativePath);
    if (!relativePackageJsonPath || relativePackageJsonPath === "package.json") {
      continue;
    }
    if (!relativePackageJsonPath.endsWith("/package.json")) {
      continue;
    }

    const workspacePath = relativePackageJsonPath.slice(0, -"/package.json".length);
    if (
      !includedPatterns.some((pattern) => matchesWorkspacePattern(workspacePath, pattern))
      || excludedPatterns.some((pattern) => matchesWorkspacePattern(workspacePath, pattern))
    ) {
      continue;
    }

    locations.set(relativePackageJsonPath, {
      packageJsonPath: path.join(projectRoot, ...relativePackageJsonPath.split("/")),
      relativePackageJsonPath,
      workspacePath
    });
  }

  return [...locations.values()].sort((left, right) =>
    left.relativePackageJsonPath.localeCompare(right.relativePackageJsonPath)
  );
}

export function findYarnWorkspacePackageJsonPaths(input: {
  projectRoot: string;
  workspaces: unknown;
}): YarnWorkspacePackageJsonPath[] {
  const locations: YarnWorkspacePackageJsonPath[] = [];
  const seen = new Set<string>();
  const projectRoot = path.resolve(input.projectRoot);
  const patterns = readWorkspacePatterns(input.workspaces);
  const excludedWorkspacePaths = new Set(
    patterns
      .filter((pattern) => pattern.startsWith("!"))
      .flatMap((pattern) => expandWorkspacePattern(projectRoot, pattern.slice(1)))
      .filter((workspacePath) => isInsideDirectory(projectRoot, workspacePath))
      .map((workspacePath) => path.resolve(workspacePath))
  );

  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      continue;
    }

    for (const workspacePath of expandWorkspacePattern(projectRoot, pattern)) {
      if (!isInsideDirectory(projectRoot, workspacePath)) {
        continue;
      }

      const packageJsonPath = path.join(workspacePath, "package.json");
      const relativePackageJsonPath = path
        .relative(projectRoot, packageJsonPath)
        .replace(/\\/g, "/");
      if (
        seen.has(relativePackageJsonPath)
        || excludedWorkspacePaths.has(path.resolve(workspacePath))
        || !existsSync(packageJsonPath)
      ) {
        continue;
      }

      locations.push({
        packageJsonPath,
        relativePackageJsonPath,
        workspacePath: path.relative(projectRoot, workspacePath).replace(/\\/g, "/")
      });
      seen.add(relativePackageJsonPath);
    }
  }

  return locations;
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

function normalizeWorkspaceRelativePath(value: string): string | undefined {
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

function matchesWorkspacePattern(workspacePath: string, rawPattern: string): boolean {
  const pattern = rawPattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const pathSegments = workspacePath.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  return matchesWorkspaceSegments(pathSegments, patternSegments, 0, 0);
}

function matchesWorkspaceSegments(
  pathSegments: string[],
  patternSegments: string[],
  pathIndex: number,
  patternIndex: number
): boolean {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegments.length;
  }

  const pattern = patternSegments[patternIndex];
  if (pattern === "**") {
    return matchesWorkspaceSegments(pathSegments, patternSegments, pathIndex, patternIndex + 1)
      || (
        pathIndex < pathSegments.length
        && matchesWorkspaceSegments(pathSegments, patternSegments, pathIndex + 1, patternIndex)
      );
  }

  if (pathIndex >= pathSegments.length || !pattern) {
    return false;
  }

  const matcher = wildcardSegmentMatcher(pattern);
  return matcher.test(pathSegments[pathIndex] ?? "")
    && matchesWorkspaceSegments(pathSegments, patternSegments, pathIndex + 1, patternIndex + 1);
}

function isInsideDirectory(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, path.resolve(candidatePath));
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
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
): Result<ParsedYarnLockfile, OhriskError> {
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

  if (isYarnBerryLockfile(input)) {
    return parseBerryLockfile(input, lockfilePath);
  }

  try {
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

    return ok({
      format: "classic",
      entries: parsed.object
    });
  } catch (cause) {
    return err(
      createError({
        code: "YARN_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse yarn.lock. Ohrisk expects a Yarn classic or Berry lockfile.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function isYarnBerryLockfile(input: string): boolean {
  return /^__metadata:\s*$/m.test(input);
}

function parseBerryLockfile(
  input: string,
  lockfilePath: string
): Result<ParsedYarnLockfile, OhriskError> {
  try {
    const parsed = parseYaml(input) as unknown;
    if (!isObjectRecord(parsed)) {
      throw new Error("Expected a YAML mapping at the document root.");
    }

    const entries: Record<string, YarnLockEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "__metadata" || !isObjectRecord(value)) {
        continue;
      }

      entries[key] = value as YarnLockEntry;
    }

    return ok({
      format: "berry",
      entries
    });
  } catch (cause) {
    return err(
      createError({
        code: "YARN_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Yarn Berry lockfile.",
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

function parsePackageRecords(lockfile: ParsedYarnLockfile): YarnPackageRecord[] {
  const records: YarnPackageRecord[] = [];

  for (const [key, entry] of Object.entries(lockfile.entries)) {
    if (typeof entry.version !== "string" || entry.version === "") {
      continue;
    }

    const descriptors = splitDescriptorKey(key);
    const identity = lockfile.format === "berry"
      ? readBerryPackageIdentity({ key, entry })
      : descriptors.map(parseDescriptor).find(Boolean);
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
      descriptors: descriptorIndexKeys({
        descriptors,
        format: lockfile.format
      }),
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

function descriptorIndexKeys(input: {
  descriptors: string[];
  format: YarnLockFormat;
}): string[] {
  const keys = new Set<string>();

  for (const descriptor of input.descriptors) {
    const unquoted = unquoteDescriptor(descriptor);
    keys.add(unquoted);

    const parsed = input.format === "berry"
      ? parseBerryDescriptor(unquoted)
      : parseDescriptor(unquoted);
    if (!parsed) {
      continue;
    }

    keys.add(`${parsed.name}@${parsed.range}`);
    keys.add(`${parsed.name}@npm:${parsed.range}`);
  }

  return [...keys];
}

function parseDescriptor(descriptor: string): { name: string; range: string } | undefined {
  const unquoted = unquoteDescriptor(descriptor);
  const berryDescriptor = parseBerryDescriptor(unquoted);
  if (berryDescriptor) {
    return berryDescriptor;
  }

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

function parseBerryDescriptor(descriptor: string): { name: string; range: string } | undefined {
  const npmLocator = parseBerryNpmLocator(descriptor);
  if (npmLocator) {
    const alias = parseNpmPackageReference(`npm:${npmLocator.reference}`);
    return alias
      ? { name: alias.name, range: alias.reference }
      : { name: npmLocator.name, range: npmLocator.reference };
  }

  const patchLocator = parseBerryPatchLocator(descriptor);
  if (patchLocator) {
    return patchLocator;
  }

  return undefined;
}

function readBerryPackageIdentity(input: {
  key: string;
  entry: YarnLockEntry;
}): { name: string; version: string } | undefined {
  const resolution = typeof input.entry.resolution === "string"
    ? input.entry.resolution
    : undefined;
  const parsedResolution = resolution ? parseBerryResolution(resolution) : undefined;
  if (parsedResolution) {
    return parsedResolution;
  }

  const descriptorIdentity = splitDescriptorKey(input.key)
    .map((descriptor) => parseBerryDescriptor(unquoteDescriptor(descriptor)))
    .find(Boolean);
  return descriptorIdentity
    ? { name: descriptorIdentity.name, version: descriptorIdentity.range }
    : undefined;
}

function parseBerryResolution(value: string): { name: string; version: string } | undefined {
  const unquoted = unquoteDescriptor(value);
  const npmLocator = parseBerryNpmLocator(unquoted);
  if (npmLocator) {
    return {
      name: npmLocator.name,
      version: npmLocator.reference
    };
  }

  const patchLocator = parseBerryPatchLocator(unquoted);
  if (patchLocator) {
    return {
      name: patchLocator.name,
      version: patchLocator.range
    };
  }

  return undefined;
}

function parseBerryNpmLocator(value: string): { name: string; reference: string } | undefined {
  const marker = "@npm:";
  const index = value.indexOf(marker);
  if (index <= 0) {
    return undefined;
  }

  const name = value.slice(0, index);
  const reference = value.slice(index + marker.length);
  if (!isValidNpmPackageName(name) || reference === "") {
    return undefined;
  }

  return { name, reference };
}

function parseBerryPatchLocator(value: string): { name: string; range: string } | undefined {
  const marker = "@patch:";
  const index = value.indexOf(marker);
  if (index <= 0) {
    return undefined;
  }

  const patchedLocator = value
    .slice(index + marker.length)
    .split("#")[0]
    ?.split("::")[0];
  if (!patchedLocator) {
    return undefined;
  }

  const decodedLocator = safeDecodeURIComponent(patchedLocator);
  const npmLocator = parseBerryNpmLocator(decodedLocator);
  if (!npmLocator) {
    return undefined;
  }

  const alias = parseNpmPackageReference(`npm:${npmLocator.reference}`);
  return alias
    ? { name: alias.name, range: alias.reference }
    : { name: npmLocator.name, range: npmLocator.reference };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unquoteDescriptor(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function isValidNpmPackageName(value: string): boolean {
  return /^(?:@[^/]+\/)?[^/@][^@]*$/.test(value);
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
  const reference = resolveNpmDependencyReference(input.name, input.range);
  const candidates = input.nameIndex.get(reference.lookupName) ?? [];

  return dependencyDescriptorCandidates({
    name: input.name,
    range: input.range,
    reference
  })
    .map((descriptor) => input.descriptorIndex.get(descriptor))
    .find((record): record is YarnPackageRecord => record !== undefined)
    ?? (candidates.length === 1 ? candidates[0] : undefined)
    ?? candidates.find((candidate) => candidate.version === reference.lookupRange)
    ?? undefined;
}

function dependencyDescriptorCandidates(input: {
  name: string;
  range: string;
  reference: ReturnType<typeof resolveNpmDependencyReference>;
}): string[] {
  const candidates = new Set<string>();
  candidates.add(`${input.name}@${input.range}`);
  candidates.add(`${input.reference.lookupName}@${input.reference.lookupRange}`);
  candidates.add(`${input.name}@npm:${input.range}`);
  candidates.add(`${input.reference.lookupName}@npm:${input.reference.lookupRange}`);

  if (input.range.startsWith("npm:")) {
    const bareRange = input.range.slice("npm:".length);
    candidates.add(`${input.name}@${bareRange}`);
    candidates.add(`${input.name}@npm:${bareRange}`);
    candidates.add(`${input.reference.lookupName}@${bareRange}`);
    candidates.add(`${input.reference.lookupName}@npm:${bareRange}`);
  }

  return [...candidates].filter((candidate) => !candidate.endsWith("@"));
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
