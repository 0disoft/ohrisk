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

type DenoLockShape = {
  version?: unknown;
  specifiers?: unknown;
  npm?: unknown;
  workspace?: unknown;
  packages?: unknown;
};

type DenoNpmPackage = {
  integrity?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
};

type DenoNpmRecord = {
  key: string;
  name: string;
  version: string;
  id: string;
  integrity?: string;
  dependencies: DenoDependencyEdge[];
};

type DenoDependencyEdge = {
  name: string;
  range: string;
  type: DependencyType;
};

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

export function parseDenoLockfile(
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
        code: "DENO_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "deno.lock exceeded the maximum supported size."
          : "Failed to read deno.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseDenoLockText(lockfileText.value, lockfilePath);
}

export function parseDenoLockText(
  input: string,
  lockfilePath = "deno.lock"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseLockfileJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const lockfile = parsed.value;
  const npmPackages = readNpmPackageMap(lockfile);
  const specifiers = readSpecifierMap(lockfile);
  const records = parseNpmRecords(npmPackages);
  const nodeMap = new Map<string, DependencyNode>();
  const rootName = rootNameForLockfile(lockfilePath);

  for (const rootDependency of collectRootDependencies(lockfile, specifiers)) {
    const record = resolveDenoPackageRecord({
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
      path: [rootName ?? "<deno>"],
      records,
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
): Result<DenoLockShape, OhriskError> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!isObjectRecord(parsed)) {
      return denoParseFailed(lockfilePath, "deno.lock root must be a JSON object.");
    }

    return ok(parsed);
  } catch (cause) {
    return err(
      createError({
        code: "DENO_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse deno.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function denoParseFailed(
  lockfilePath: string,
  cause: string
): Result<DenoLockShape, OhriskError> {
  return err(
    createError({
      code: "DENO_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse deno.lock.",
      details: {
        lockfilePath,
        cause
      }
    })
  );
}

function readNpmPackageMap(lockfile: DenoLockShape): Record<string, unknown> {
  if (isObjectRecord(lockfile.npm)) {
    return lockfile.npm;
  }

  const packages = isObjectRecord(lockfile.packages) ? lockfile.packages : undefined;
  return isObjectRecord(packages?.npm) ? packages.npm : {};
}

function readSpecifierMap(lockfile: DenoLockShape): Record<string, string> {
  if (isObjectRecord(lockfile.specifiers)) {
    return readStringMap(lockfile.specifiers);
  }

  const packages = isObjectRecord(lockfile.packages) ? lockfile.packages : undefined;
  return isObjectRecord(packages?.specifiers) ? readStringMap(packages.specifiers) : {};
}

function collectRootDependencies(
  lockfile: DenoLockShape,
  specifiers: Record<string, string>
): DenoDependencyEdge[] {
  const workspaceDependencies = readWorkspaceDependencies(lockfile)
    .filter((specifier) => specifier.startsWith("npm:"));
  const rootSpecifiers = workspaceDependencies.length > 0
    ? workspaceDependencies
    : Object.keys(specifiers).filter((specifier) => specifier.startsWith("npm:"));
  const edges: DenoDependencyEdge[] = [];

  for (const specifier of rootSpecifiers) {
    const parsed = parseNpmPackageReference(specifier);
    if (!parsed) {
      continue;
    }

    edges.push({
      name: parsed.name,
      range: specifiers[specifier] ?? parsed.reference,
      type: "production"
    });
  }

  return edges;
}

function readWorkspaceDependencies(lockfile: DenoLockShape): string[] {
  const workspace = isObjectRecord(lockfile.workspace)
    ? lockfile.workspace
    : isObjectRecord(lockfile.packages) && isObjectRecord(lockfile.packages.workspace)
      ? lockfile.packages.workspace
      : undefined;

  if (!workspace || !Array.isArray(workspace.dependencies)) {
    return [];
  }

  return workspace.dependencies.filter((dependency): dependency is string =>
    typeof dependency === "string"
  );
}

function parseNpmRecords(packages: Record<string, unknown>): DenoNpmRecord[] {
  const records: DenoNpmRecord[] = [];

  for (const [key, rawPackage] of Object.entries(packages)) {
    const packageKey = parseDenoNpmPackageKey(key);
    if (!packageKey || !isObjectRecord(rawPackage)) {
      continue;
    }

    const pkg = rawPackage as DenoNpmPackage;
    const integrity = typeof pkg.integrity === "string" && pkg.integrity !== ""
      ? pkg.integrity
      : undefined;

    records.push({
      key,
      name: packageKey.name,
      version: packageKey.version,
      id: `${packageKey.name}@${packageKey.version}`,
      ...(integrity ? { integrity } : {}),
      dependencies: collectPackageDependencies(pkg)
    });
  }

  return records;
}

function parseDenoNpmPackageKey(value: string): { name: string; version: string } | undefined {
  const withoutProtocol = value.startsWith("npm:") ? value.slice("npm:".length) : value;
  const atIndex = withoutProtocol.lastIndexOf("@");

  if (atIndex <= 0) {
    return undefined;
  }

  const name = withoutProtocol.slice(0, atIndex);
  const rawVersion = withoutProtocol.slice(atIndex + 1);
  const version = rawVersion.split("(")[0];

  if (!name || !version) {
    return undefined;
  }

  return { name, version };
}

function collectPackageDependencies(pkg: DenoNpmPackage): DenoDependencyEdge[] {
  return [
    ...readDependencyEdges(pkg.dependencies, "production"),
    ...readDependencyEdges(pkg.optionalDependencies, "optional"),
    ...readDependencyEdges(pkg.peerDependencies, "peer")
  ];
}

function readDependencyEdges(
  value: unknown,
  type: DependencyType
): DenoDependencyEdge[] {
  if (Array.isArray(value)) {
    return value.flatMap((dependency) => {
      if (typeof dependency !== "string") {
        return [];
      }

      const parsed = parseDenoNpmPackageKey(dependency);
      return parsed ? [{ name: parsed.name, range: parsed.version, type }] : [];
    });
  }

  if (!isObjectRecord(value)) {
    return [];
  }

  const edges: DenoDependencyEdge[] = [];
  for (const [name, range] of Object.entries(value)) {
    if (typeof range === "string" && range !== "") {
      edges.push({ name, range, type });
    }
  }

  return edges;
}

function resolveDenoPackageRecord(input: {
  records: DenoNpmRecord[];
  name: string;
  range: string;
}): DenoNpmRecord | undefined {
  const reference = resolveNpmDependencyReference(input.name, input.range);
  const denoReference = normalizeDenoPackageReference({
    name: reference.lookupName,
    range: reference.lookupRange
  });

  const exactCandidates = input.records.filter((record) =>
    record.name === denoReference.name && record.version === denoReference.version
  );
  if (exactCandidates.length === 1) {
    return exactCandidates[0];
  }

  const rangeCandidates = input.records.filter((record) =>
    record.name === denoReference.name &&
    versionSatisfiesDenoRange(record.version, denoReference.version)
  );

  return rangeCandidates.length === 1 ? rangeCandidates[0] : undefined;
}

function normalizeDenoPackageReference(input: {
  name: string;
  range: string;
}): { name: string; version: string } {
  const protocolReference = input.range.startsWith("npm:")
    ? parseNpmPackageReference(input.range)
    : undefined;
  if (protocolReference) {
    return {
      name: protocolReference.name,
      version: cleanDenoVersion(protocolReference.reference)
    };
  }

  const packageKey = parseDenoNpmPackageKey(input.range);
  if (packageKey) {
    return packageKey;
  }

  return {
    name: input.name,
    version: cleanDenoVersion(input.range)
  };
}

function cleanDenoVersion(value: string): string {
  return value.split("(")[0] ?? value;
}

function versionSatisfiesDenoRange(version: string, range: string): boolean {
  const cleanedRange = cleanDenoVersion(range).trim();
  if (!cleanedRange || cleanedRange === "*" || cleanedRange.toLowerCase() === "latest") {
    return true;
  }

  if (cleanedRange.includes("||")) {
    return cleanedRange.split("||").some((rangePart) =>
      versionSatisfiesDenoRange(version, rangePart)
    );
  }

  if (cleanedRange.startsWith("^")) {
    return versionSatisfiesCaretRange(version, cleanedRange.slice(1));
  }

  if (cleanedRange.startsWith("~")) {
    return versionSatisfiesTildeRange(version, cleanedRange.slice(1));
  }

  const comparatorTokens = cleanedRange.split(/\s+/).filter(Boolean);
  if (comparatorTokens.length > 1 || isComparatorToken(comparatorTokens[0])) {
    return comparatorTokens.every((token) => versionSatisfiesComparator(version, token));
  }

  if (/^\d+$/.test(cleanedRange)) {
    const base = parseSemver(`${cleanedRange}.0.0`);
    return !!base && versionSatisfiesBounds(version, base, {
      major: base.major + 1,
      minor: 0,
      patch: 0
    });
  }

  if (/^\d+\.\d+$/.test(cleanedRange)) {
    const base = parseSemver(`${cleanedRange}.0`);
    return !!base && versionSatisfiesBounds(version, base, {
      major: base.major,
      minor: base.minor + 1,
      patch: 0
    });
  }

  return version === cleanedRange;
}

function versionSatisfiesCaretRange(version: string, range: string): boolean {
  const base = parseSemver(range);
  if (!base) {
    return false;
  }

  const upper = base.major > 0
    ? { major: base.major + 1, minor: 0, patch: 0 }
    : base.minor > 0
      ? { major: 0, minor: base.minor + 1, patch: 0 }
      : { major: 0, minor: 0, patch: base.patch + 1 };

  return versionSatisfiesBounds(version, base, upper);
}

function versionSatisfiesTildeRange(version: string, range: string): boolean {
  const base = parseSemver(range);
  if (!base) {
    return false;
  }

  return versionSatisfiesBounds(version, base, {
    major: base.major,
    minor: base.minor + 1,
    patch: 0
  });
}

function versionSatisfiesBounds(version: string, lowerInclusive: Semver, upperExclusive: Semver): boolean {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) {
    return false;
  }

  return compareSemver(parsedVersion, lowerInclusive) >= 0 &&
    compareSemver(parsedVersion, upperExclusive) < 0;
}

function versionSatisfiesComparator(version: string, token: string): boolean {
  const match = /^(>=|>|<=|<|=)?(.+)$/.exec(token.trim());
  if (!match) {
    return false;
  }

  const operator = match[1] ?? "=";
  const expected = parseSemver(match[2] ?? "");
  const actual = parseSemver(version);
  if (!actual || !expected) {
    return false;
  }

  const compared = compareSemver(actual, expected);
  switch (operator) {
    case ">=":
      return compared >= 0;
    case ">":
      return compared > 0;
    case "<=":
      return compared <= 0;
    case "<":
      return compared < 0;
    case "=":
      return compared === 0;
    default:
      return false;
  }
}

function isComparatorToken(token: string | undefined): boolean {
  return typeof token === "string" && /^(>=|>|<=|<|=)/.test(token);
}

function parseSemver(value: string): Semver | undefined {
  const normalized = cleanDenoVersion(value).trim().replace(/^v/, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(normalized);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? "0"),
    patch: Number(match[3] ?? "0")
  };
}

function compareSemver(left: Semver, right: Semver): number {
  return left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch;
}

function walkDependency(input: {
  record: DenoNpmRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: DenoNpmRecord[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
  requestedName?: string;
}): void {
  const seenKey = input.record.key;
  if (input.seen.has(seenKey)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(seenKey);

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
      ...(input.record.integrity ? { integrity: input.record.integrity } : {}),
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const child of input.record.dependencies) {
    const childRecord = resolveDenoPackageRecord({
      records: input.records,
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
      records: input.records,
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

function readStringMap(value: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      map[key] = entry;
    }
  }

  return map;
}

function rootNameForLockfile(lockfilePath: string): string | undefined {
  if (isGitRefSyntheticPath(lockfilePath)) {
    return undefined;
  }

  const parent = path.basename(path.dirname(path.resolve(lockfilePath)));
  return parent && parent !== "." ? parent : undefined;
}

function isGitRefSyntheticPath(lockfilePath: string): boolean {
  return lockfilePath.includes(":") && !/^[A-Za-z]:[\\/]/.test(lockfilePath);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
