import { existsSync, readdirSync, statSync } from "node:fs";
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

type VcpkgManifestDependency = {
  name: string;
  dependencyType: DependencyType;
};

type VcpkgStatusRecord = {
  name: string;
  version: string;
  dependencies: string[];
  id: string;
};

const VCPKG_STATUS_RELATIVE_PATH = path.join("vcpkg_installed", "vcpkg", "status");

export function parseVcpkgJsonFile(
  manifestPath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const manifestText = readInputTextFile({
    filePath: manifestPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!manifestText.ok) {
    return err(
      createError({
        code: "VCPKG_JSON_READ_FAILED",
        category: inputFileReadErrorCategory(manifestText.error),
        message: manifestText.error.kind === "too_large"
          ? "vcpkg.json exceeded the maximum supported size."
          : "Failed to read vcpkg.json.",
        details: {
          lockfilePath: manifestPath,
          ...inputFileReadErrorDetails(manifestText.error)
        }
      })
    );
  }

  const statusPath = findVcpkgStatusPath(path.dirname(manifestPath));
  if (!statusPath) {
    return parseVcpkgJsonText(manifestText.value, manifestPath);
  }

  const statusText = readInputTextFile({
    filePath: statusPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!statusText.ok) {
    return err(
      createError({
        code: "VCPKG_STATUS_READ_FAILED",
        category: inputFileReadErrorCategory(statusText.error),
        message: statusText.error.kind === "too_large"
          ? "vcpkg installed status exceeded the maximum supported size."
          : "Failed to read vcpkg installed status.",
        details: {
          manifestPath,
          statusPath,
          ...inputFileReadErrorDetails(statusText.error)
        }
      })
    );
  }

  return parseVcpkgJsonText(manifestText.value, manifestPath, {
    statusText: statusText.value,
    statusPath
  });
}

export function parseVcpkgJsonText(
  input: string,
  manifestPath = "vcpkg.json",
  options: {
    statusText?: string;
    statusPath?: string;
  } = {}
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    return err(
      createError({
        code: "VCPKG_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse vcpkg.json as JSON.",
        details: {
          lockfilePath: manifestPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed)) {
    return vcpkgManifestShapeError({
      manifestPath,
      reason: "root_not_object"
    });
  }

  const dependencies = readVcpkgManifestDependencies(parsed, manifestPath);
  if (!dependencies.ok) {
    return dependencies;
  }

  const rootName = readVcpkgRootName(parsed, manifestPath);
  if (options.statusText !== undefined) {
    const statusRecords = readVcpkgStatusRecords({
      statusText: options.statusText,
      statusPath: options.statusPath ?? VCPKG_STATUS_RELATIVE_PATH
    });

    if (!statusRecords.ok) {
      return statusRecords;
    }

    return ok({
      rootName,
      lockfilePath: manifestPath,
      nodes: buildVcpkgStatusNodes({
        rootName,
        dependencies: dependencies.value,
        records: statusRecords.value
      })
    });
  }

  const overrides = readVcpkgOverrides(parsed, manifestPath);
  if (!overrides.ok) {
    return overrides;
  }

  const fallbackNodes = buildVcpkgOverrideNodes({
    rootName,
    dependencies: dependencies.value,
    overrides: overrides.value,
    manifestPath
  });
  if (!fallbackNodes.ok) {
    return fallbackNodes;
  }

  return ok({
    rootName,
    lockfilePath: manifestPath,
    nodes: fallbackNodes.value
  });
}

function findVcpkgStatusPath(projectRoot: string): string | undefined {
  const direct = path.join(projectRoot, VCPKG_STATUS_RELATIVE_PATH);
  if (isFile(direct)) {
    return direct;
  }

  try {
    for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(projectRoot, entry.name, VCPKG_STATUS_RELATIVE_PATH);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readVcpkgRootName(
  manifest: Record<string, unknown>,
  manifestPath: string
): string {
  return typeof manifest.name === "string" && manifest.name.trim() !== ""
    ? manifest.name.trim()
    : path.basename(path.dirname(manifestPath)) || "<vcpkg-project>";
}

function readVcpkgManifestDependencies(
  manifest: Record<string, unknown>,
  manifestPath: string
): Result<VcpkgManifestDependency[], OhriskError> {
  if (manifest.dependencies === undefined) {
    return ok([]);
  }

  if (!Array.isArray(manifest.dependencies)) {
    return vcpkgManifestShapeError({
      manifestPath,
      field: "dependencies",
      reason: "field_not_array"
    });
  }

  const dependencies = new Map<string, VcpkgManifestDependency>();
  for (const [index, dependency] of manifest.dependencies.entries()) {
    const parsed = readVcpkgManifestDependency({
      dependency,
      manifestPath,
      index
    });
    if (!parsed.ok) {
      return parsed;
    }

    const existing = dependencies.get(parsed.value.name);
    dependencies.set(parsed.value.name, {
      name: parsed.value.name,
      dependencyType: existing
        ? mergeDependencyType(existing.dependencyType, parsed.value.dependencyType)
        : parsed.value.dependencyType
    });
  }

  return ok([...dependencies.values()].sort((left, right) => left.name.localeCompare(right.name)));
}

function readVcpkgManifestDependency(input: {
  dependency: unknown;
  manifestPath: string;
  index: number;
}): Result<VcpkgManifestDependency, OhriskError> {
  if (typeof input.dependency === "string") {
    const name = input.dependency.trim();
    if (!isVcpkgPackageName(name)) {
      return vcpkgManifestShapeError({
        manifestPath: input.manifestPath,
        field: "dependencies",
        index: input.index,
        reason: "invalid_dependency_name",
        value: name
      });
    }

    return ok({
      name,
      dependencyType: "production"
    });
  }

  if (!isRecord(input.dependency)) {
    return vcpkgManifestShapeError({
      manifestPath: input.manifestPath,
      field: "dependencies",
      index: input.index,
      reason: "dependency_not_string_or_object"
    });
  }

  const name = typeof input.dependency.name === "string" ? input.dependency.name.trim() : "";
  if (!isVcpkgPackageName(name)) {
    return vcpkgManifestShapeError({
      manifestPath: input.manifestPath,
      field: "dependencies",
      index: input.index,
      reason: "invalid_dependency_name",
      value: name
    });
  }

  return ok({
    name,
    dependencyType: input.dependency.host === true ? "development" : "production"
  });
}

function readVcpkgOverrides(
  manifest: Record<string, unknown>,
  manifestPath: string
): Result<Map<string, string>, OhriskError> {
  if (manifest.overrides === undefined) {
    return ok(new Map());
  }

  if (!Array.isArray(manifest.overrides)) {
    return vcpkgManifestShapeError({
      manifestPath,
      field: "overrides",
      reason: "field_not_array"
    });
  }

  const overrides = new Map<string, string>();
  for (const [index, override] of manifest.overrides.entries()) {
    if (!isRecord(override)) {
      return vcpkgManifestShapeError({
        manifestPath,
        field: "overrides",
        index,
        reason: "override_not_object"
      });
    }

    const name = typeof override.name === "string" ? override.name.trim() : "";
    const version = readVcpkgOverrideVersion(override);
    if (!isVcpkgPackageName(name) || !version) {
      return vcpkgManifestShapeError({
        manifestPath,
        field: "overrides",
        index,
        reason: "override_missing_name_or_version",
        value: name
      });
    }

    overrides.set(name, version);
  }

  return ok(overrides);
}

function readVcpkgOverrideVersion(override: Record<string, unknown>): string | undefined {
  for (const field of ["version", "version-semver", "version-date", "version-string"]) {
    const value = override[field];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return undefined;
}

function buildVcpkgOverrideNodes(input: {
  rootName: string;
  dependencies: VcpkgManifestDependency[];
  overrides: Map<string, string>;
  manifestPath: string;
}): Result<DependencyNode[], OhriskError> {
  const missingExactVersions = input.dependencies
    .filter((dependency) => !input.overrides.has(dependency.name))
    .map((dependency) => dependency.name);

  if (missingExactVersions.length > 0) {
    return err(
      createError({
        code: "VCPKG_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "vcpkg.json does not contain resolved package versions. Run vcpkg install first so Ohrisk can read vcpkg_installed/vcpkg/status, or pin every direct dependency with an exact override.",
        details: {
          manifestPath: input.manifestPath,
          missingInstalledStatus: VCPKG_STATUS_RELATIVE_PATH,
          dependenciesWithoutExactOverride: missingExactVersions
        }
      })
    );
  }

  return ok(
    input.dependencies
      .map((dependency): DependencyNode => {
        const version = input.overrides.get(dependency.name) ?? "";
        const id = `${dependency.name}@${version}`;
        return {
          id,
          name: dependency.name,
          version,
          ecosystem: "vcpkg",
          dependencyType: dependency.dependencyType,
          direct: true,
          paths: [[input.rootName, id]]
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

function readVcpkgStatusRecords(input: {
  statusText: string;
  statusPath: string;
}): Result<VcpkgStatusRecord[], OhriskError> {
  const records = new Map<string, VcpkgStatusRecord>();
  const paragraphs = input.statusText
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  for (const [index, paragraph] of paragraphs.entries()) {
    const fields = readDebianStatusFields(paragraph);
    const status = fields.get("Status");
    if (status !== undefined && status !== "install ok installed") {
      continue;
    }

    const name = fields.get("Package")?.trim() ?? "";
    const version = fields.get("Version")?.trim() ?? "";
    if (!isVcpkgPackageName(name) || version === "") {
      return vcpkgStatusShapeError({
        statusPath: input.statusPath,
        index,
        reason: "record_missing_package_or_version",
        packageName: name
      });
    }

    const dependencies = readVcpkgStatusDependencies(fields.get("Depends") ?? "");
    const id = `${name}@${version}`;
    const existing = records.get(id);
    records.set(id, {
      name,
      version,
      dependencies: existing
        ? uniqueSorted([...existing.dependencies, ...dependencies])
        : dependencies,
      id
    });
  }

  if (records.size === 0) {
    return vcpkgStatusShapeError({
      statusPath: input.statusPath,
      reason: "no_installed_package_records"
    });
  }

  return ok([...records.values()].sort((left, right) => left.id.localeCompare(right.id)));
}

function readDebianStatusFields(paragraph: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentField: string | undefined;

  for (const line of paragraph.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentField) {
      fields.set(currentField, `${fields.get(currentField) ?? ""}\n${line.trim()}`);
      continue;
    }

    const separator = line.indexOf(":");
    if (separator <= 0) {
      currentField = undefined;
      continue;
    }

    currentField = line.slice(0, separator);
    fields.set(currentField, line.slice(separator + 1).trim());
  }

  return fields;
}

function readVcpkgStatusDependencies(value: string): string[] {
  return uniqueSorted(
    value
      .split(",")
      .map((dependency) => {
        const withoutConstraint = dependency.split("(", 1)[0]?.trim() ?? "";
        const token = withoutConstraint.split(/\s+/, 1)[0]?.trim() ?? "";
        const withoutTriplet = token.split(":", 1)[0]?.trim() ?? "";
        return isVcpkgPackageName(withoutTriplet) ? withoutTriplet : undefined;
      })
      .filter((dependency): dependency is string => dependency !== undefined)
  );
}

function buildVcpkgStatusNodes(input: {
  rootName: string;
  dependencies: VcpkgManifestDependency[];
  records: VcpkgStatusRecord[];
}): DependencyNode[] {
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const recordsByName = new Map<string, VcpkgStatusRecord[]>();
  const referencedNames = new Set<string>();
  const directDependencyTypes = new Map<string, DependencyType>();

  for (const dependency of input.dependencies) {
    directDependencyTypes.set(dependency.name, dependency.dependencyType);
  }

  for (const record of input.records) {
    const siblings = recordsByName.get(record.name) ?? [];
    siblings.push(record);
    recordsByName.set(record.name, siblings);
    for (const dependencyName of record.dependencies) {
      referencedNames.add(dependencyName);
    }
  }

  const roots = uniqueRecords([
    ...input.records.filter((record) => directDependencyTypes.has(record.name)),
    ...input.records.filter((record) => !referencedNames.has(record.name))
  ]);
  const effectiveRoots = roots.length > 0 ? roots : input.records;
  const nodes = new Map<string, DependencyNode>();

  for (const record of effectiveRoots) {
    const dependencyType = directDependencyTypes.get(record.name) ?? "unknown";
    appendVcpkgNodePath({
      record,
      recordsById,
      recordsByName,
      nodes,
      rootName: input.rootName,
      pathIds: [input.rootName, record.id],
      dependencyType,
      direct: true,
      stack: new Set()
    });
  }

  return [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function appendVcpkgNodePath(input: {
  record: VcpkgStatusRecord;
  recordsById: Map<string, VcpkgStatusRecord>;
  recordsByName: Map<string, VcpkgStatusRecord[]>;
  nodes: Map<string, DependencyNode>;
  rootName: string;
  pathIds: string[];
  dependencyType: DependencyType;
  direct: boolean;
  stack: Set<string>;
}): void {
  const existing = input.nodes.get(input.record.id);
  const pathIds = input.pathIds;
  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    if (!existing.paths.some((pathItems) => samePath(pathItems, pathIds))) {
      existing.paths.push(pathIds);
    }
  } else {
    input.nodes.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "vcpkg",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [pathIds]
    });
  }

  if (input.stack.has(input.record.id)) {
    return;
  }

  const childStack = new Set(input.stack);
  childStack.add(input.record.id);

  for (const dependencyName of input.record.dependencies) {
    const childRecords = input.recordsByName.get(dependencyName) ?? [];
    for (const childRecord of childRecords) {
      if (!input.recordsById.has(childRecord.id)) {
        continue;
      }

      appendVcpkgNodePath({
        ...input,
        record: childRecord,
        pathIds: [...pathIds, childRecord.id],
        dependencyType: input.dependencyType,
        direct: false,
        stack: childStack
      });
    }
  }
}

function vcpkgManifestShapeError(input: {
  manifestPath: string;
  field?: string;
  index?: number;
  reason: string;
  value?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "VCPKG_JSON_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse vcpkg.json. Ohrisk supports vcpkg manifest dependencies and installed vcpkg status records.",
      details: input
    })
  );
}

function vcpkgStatusShapeError(input: {
  statusPath: string;
  index?: number;
  reason: string;
  packageName?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "VCPKG_STATUS_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse vcpkg installed status. Ohrisk supports Debian-style records with Package and Version fields.",
      details: input
    })
  );
}

function isVcpkgPackageName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueRecords(records: VcpkgStatusRecord[]): VcpkgStatusRecord[] {
  const byId = new Map<string, VcpkgStatusRecord>();
  for (const record of records) {
    byId.set(record.id, record);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
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

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isFile(pathname: string): boolean {
  if (!existsSync(pathname)) {
    return false;
  }

  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
