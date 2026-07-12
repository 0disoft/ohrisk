import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import { createError, type OhriskError, type OhriskErrorCode } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  createDiskPythonLocalSourceFileReader,
  normalizePythonLocalSourcePathSpec,
  readPythonLocalSourcePackage,
  type PythonLocalSourceFileReader
} from "./python-local-source";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PdmPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  dependencies: string[];
  evidence?: LicenseEvidence;
};

type PartialPdmPackageRecord = {
  name?: string;
  version?: string;
  sourcePath?: string;
  unsupportedSource?: UnsupportedPdmSource;
  groups: string[];
  dependencies: string[];
};

type UnsupportedPdmSource = {
  value: string;
  reason: string;
};

type PdmRootDependency = {
  name: string;
  type: DependencyType;
};

type PdmLockParseOptions = {
  pyprojectText?: string;
  readLocalSourceFile?: PythonLocalSourceFileReader;
};

const PDM_LOCK_LOCAL_SOURCE_ERRORS = {
  parseCode: "PDM_LOCK_PARSE_FAILED",
  readCode: "PDM_LOCK_READ_FAILED",
  displayName: "pdm.lock"
} satisfies { parseCode: OhriskErrorCode; readCode: OhriskErrorCode; displayName: string };

export function parsePdmLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; pyprojectMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "PDM_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "pdm.lock exceeded the maximum supported size."
          : "Failed to read pdm.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const pyproject = readOptionalPyproject({
    lockfilePath,
    maxBytes: options.pyprojectMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!pyproject.ok) {
    return pyproject;
  }

  return parsePdmLockText(lockfileText.value, lockfilePath, omitUndefined({
    pyprojectText: pyproject.value,
    readLocalSourceFile: createDiskPythonLocalSourceFileReader({
      rootDir: path.dirname(lockfilePath),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES,
      errors: PDM_LOCK_LOCAL_SOURCE_ERRORS
    })
  }));
}

export function parsePdmLockText(
  input: string,
  lockfilePath = "pdm.lock",
  options: PdmLockParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  const parsedRecords = parsePdmPackageRecords(input, omitUndefined({
    lockfilePath,
    readLocalSourceFile: options.readLocalSourceFile
  }));
  if (!parsedRecords.ok) {
    return parsedRecords;
  }

  try {
    const records = parsedRecords.value;
    if (records.length === 0) {
      return err(
        createError({
          code: "PDM_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse pdm.lock. Ohrisk expected at least one [[package]] record.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const rootName = readPyprojectName(options.pyprojectText)
      ?? path.basename(path.dirname(lockfilePath))
      ?? "<root>";
    const rootDependencies = readPdmRootDependencies(omitUndefined({
      pyprojectText: options.pyprojectText,
      records
    }));
    const nodeMap = new Map<string, DependencyNode>();

    for (const rootDependency of rootDependencies) {
      const record = resolvePdmPackageRecord(records, rootDependency.name);
      if (!record) {
        continue;
      }

      walkPdmDependency({
        record,
        dependencyType: rootDependency.type,
        direct: true,
        path: [rootName],
        records,
        nodeMap,
        seen: new Set()
      });
    }

    return ok({
      rootName,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ...embeddedEvidenceFromPdmRecords(records)
    });
  } catch (cause) {
    return err(
      createError({
        code: "PDM_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pdm.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readOptionalPyproject(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const pyprojectPath = path.join(path.dirname(input.lockfilePath), "pyproject.toml");
  if (!existsSync(pyprojectPath)) {
    return ok(undefined);
  }

  const pyprojectText = readInputTextFile({
    filePath: pyprojectPath,
    maxBytes: input.maxBytes
  });
  if (!pyprojectText.ok) {
    return err(
      createError({
        code: "PYPROJECT_READ_FAILED",
        category: inputFileReadErrorCategory(pyprojectText.error),
        message: pyprojectText.error.kind === "too_large"
          ? "pyproject.toml exceeded the maximum supported size."
          : "Failed to read pyproject.toml.",
        details: {
          pyprojectPath,
          ...inputFileReadErrorDetails(pyprojectText.error)
        }
      })
    );
  }

  return ok(pyprojectText.value);
}

function parsePdmPackageRecords(input: string, options: {
  lockfilePath: string;
  readLocalSourceFile?: PythonLocalSourceFileReader;
}): Result<PdmPackageRecord[], OhriskError> {
  const records: PdmPackageRecord[] = [];
  let current: PartialPdmPackageRecord | undefined;
  let currentTable: "package" | "other" = "other";
  let activeArray: { key: "dependencies" | "groups"; lines: string[] } | undefined;

  const flushActiveArray = (): void => {
    if (!activeArray || !current) {
      activeArray = undefined;
      return;
    }

    const values = readStringArrayValues(activeArray.lines.join("\n"));
    if (activeArray.key === "dependencies") {
      for (const value of values) {
        const name = dependencyNameFromRequirement(value);
        if (name && normalizePythonPackageName(name) !== "python") {
          current.dependencies.push(name);
        }
      }
    } else {
      current.groups.push(...values);
    }

    activeArray = undefined;
  };

  const flushCurrent = (): Result<void, OhriskError> => {
    flushActiveArray();
    if (!current) {
      return ok(undefined);
    }

    if (!current.name) {
      throw new Error("Encountered a [[package]] record without a string name and version.");
    }

    if (current.unsupportedSource) {
      return err(
        createError({
          code: "PDM_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse pdm.lock package source. Remote VCS package sources are not supported yet; use locked PyPI package records or project-root-contained local source paths.",
          details: {
            lockfilePath: options.lockfilePath,
            packageName: current.name,
            reason: current.unsupportedSource.reason,
            source: current.unsupportedSource.value,
            supportedSourceForms: [
              "locked PyPI package record",
              "project-root-contained local source path"
            ]
          }
        })
      );
    }

    if (current.sourcePath) {
      const localSource = readPythonLocalSourcePackage({
        source: {
          sourcePath: current.sourcePath,
          expectedName: current.name
        },
        fromFilePath: options.lockfilePath,
        readLocalSourceFile: options.readLocalSourceFile,
        errors: PDM_LOCK_LOCAL_SOURCE_ERRORS
      });
      if (!localSource.ok) {
        return localSource;
      }

      records.push({
        name: localSource.value.name,
        version: localSource.value.version,
        id: localSource.value.id,
        dependencyType: dependencyTypeForPdmRecord(current),
        dependencies: current.dependencies,
        evidence: localSource.value.evidence
      });
      return ok(undefined);
    }

    if (!current.version) {
      throw new Error("Encountered a [[package]] record without a string name and version.");
    }

    records.push({
      name: current.name,
      version: current.version,
      id: `${current.name}@${current.version}`,
      dependencyType: dependencyTypeForPdmRecord(current),
      dependencies: current.dependencies
    });

    return ok(undefined);
  };

  try {
    for (const rawLine of input.split(/\r?\n/)) {
      const line = stripTomlComment(rawLine).trim();
      if (line === "") {
        continue;
      }

      if (activeArray) {
        activeArray.lines.push(line);
        if (line.includes("]")) {
          flushActiveArray();
        }
        continue;
      }

      if (line === "[[package]]") {
        const flushed = flushCurrent();
        if (!flushed.ok) {
          return flushed;
        }

        current = {
          groups: [],
          dependencies: []
        };
        currentTable = "package";
        continue;
      }

      if (!current) {
        continue;
      }

      if (line.startsWith("[") && line.endsWith("]")) {
        currentTable = "other";
        continue;
      }

      if (currentTable !== "package") {
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

      const source = readPdmSourceAssignment(line);
      if (source !== undefined) {
        if (source.unsupportedSource) {
          current.unsupportedSource = source.unsupportedSource;
        } else if (source.sourcePath) {
          current.sourcePath = source.sourcePath;
        }
        continue;
      }

      const inlineGroups = readInlineStringArrayAssignment(line, "groups");
      if (inlineGroups !== undefined) {
        current.groups.push(...inlineGroups);
        continue;
      }

      const inlineDependencies = readInlineStringArrayAssignment(line, "dependencies");
      if (inlineDependencies !== undefined) {
        for (const dependency of inlineDependencies) {
          const dependencyName = dependencyNameFromRequirement(dependency);
          if (dependencyName && normalizePythonPackageName(dependencyName) !== "python") {
            current.dependencies.push(dependencyName);
          }
        }
        continue;
      }

      const multilineArrayKey = readMultilineArrayAssignmentKey(line);
      if (multilineArrayKey === "groups" || multilineArrayKey === "dependencies") {
        activeArray = {
          key: multilineArrayKey,
          lines: [line.slice(line.indexOf("=") + 1).trim()]
        };
        if (line.includes("]")) {
          flushActiveArray();
        }
      }
    }

    const flushed = flushCurrent();
    if (!flushed.ok) {
      return flushed;
    }

    return ok(records);
  } catch (cause) {
    return err(
      createError({
        code: "PDM_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pdm.lock.",
        details: {
          lockfilePath: options.lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function embeddedEvidenceFromPdmRecords(records: PdmPackageRecord[]): Pick<DependencyGraph, "embeddedEvidence"> {
  const embeddedEvidence = records
    .map((record) => record.evidence)
    .filter((evidence): evidence is LicenseEvidence => evidence !== undefined)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));

  return embeddedEvidence.length > 0 ? { embeddedEvidence } : {};
}

function readPdmRootDependencies(input: {
  pyprojectText?: string;
  records: PdmPackageRecord[];
}): PdmRootDependency[] {
  if (input.pyprojectText) {
    const roots = parsePyprojectRootDependencies(input.pyprojectText);
    if (roots.length > 0) {
      return roots;
    }
  }

  return inferPdmRootDependencies(input.records);
}

function parsePyprojectRootDependencies(input: string): PdmRootDependency[] {
  const roots = new Map<string, DependencyType>();
  let section = "";
  let activeArray: { type: DependencyType; lines: string[] } | undefined;

  const flushArray = (): void => {
    if (!activeArray) {
      return;
    }

    for (const name of dependencyNamesFromArray(activeArray.lines.join("\n"))) {
      mergeRootDependency(roots, name, activeArray.type);
    }

    activeArray = undefined;
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

    if (line.startsWith("[") && line.endsWith("]")) {
      flushArray();
      section = line.slice(1, -1);
      continue;
    }

    if (section === "project" && line.startsWith("dependencies")) {
      const value = line.slice(line.indexOf("=") + 1).trim();
      if (value.includes("[") && value.includes("]")) {
        for (const name of dependencyNamesFromArray(value)) {
          mergeRootDependency(roots, name, "production");
        }
      } else if (value.startsWith("[")) {
        activeArray = { type: "production", lines: [value] };
      }
      continue;
    }

    if (
      section === "project.optional-dependencies"
      || section === "dependency-groups"
      || section === "tool.pdm.dev-dependencies"
    ) {
      const value = line.includes("=")
        ? line.slice(line.indexOf("=") + 1).trim()
        : "";
      const type = section === "project.optional-dependencies" ? "optional" : "development";

      if (value.includes("[") && value.includes("]")) {
        for (const name of dependencyNamesFromArray(value)) {
          mergeRootDependency(roots, name, type);
        }
      } else if (value.startsWith("[")) {
        activeArray = { type, lines: [value] };
      }
    }
  }

  flushArray();

  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({ name, type }));
}

function inferPdmRootDependencies(records: PdmPackageRecord[]): PdmRootDependency[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      referenced.add(normalizePythonPackageName(dependency));
    }
  }

  return records
    .filter((record) => !referenced.has(normalizePythonPackageName(record.name)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => ({
      name: record.name,
      type: record.dependencyType
    }));
}

function walkPdmDependency(input: {
  record: PdmPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: PdmPackageRecord[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (input.seen.has(input.record.id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.id);
  const nextPath = [...input.path, input.record.id];
  const existing = input.nodeMap.get(input.record.id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "pypi",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolvePdmPackageRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkPdmDependency({
      record,
      dependencyType: dependencyTypeForChildEdge(input.dependencyType, record.dependencyType),
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolvePdmPackageRecord(
  records: PdmPackageRecord[],
  name: string
): PdmPackageRecord | undefined {
  const normalized = normalizePythonPackageName(name);
  const matches = records.filter((record) =>
    normalizePythonPackageName(record.name) === normalized
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function readPyprojectName(text: string | undefined): string | undefined {
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

    if (section === "project") {
      const name = readStringAssignment(line, "name");
      if (name) {
        return name;
      }
    }
  }

  return undefined;
}

function dependencyTypeForPdmRecord(record: PartialPdmPackageRecord): DependencyType {
  const groups = record.groups.map((group) => group.toLowerCase());
  if (groups.some((group) => group === "default" || group === "main")) {
    return "production";
  }

  if (groups.length > 0) {
    return "development";
  }

  return "unknown";
}

function readStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`).exec(line);
  return match?.[1];
}

function readPdmSourceAssignment(line: string): {
  sourcePath?: string;
  unsupportedSource?: UnsupportedPdmSource;
} | undefined {
  const pathSource = readStringAssignment(line, "path");
  if (pathSource !== undefined) {
    const sourcePath = normalizePythonLocalSourcePathSpec(pathSource);
    return sourcePath
      ? { sourcePath }
      : {
          unsupportedSource: {
            value: pathSource,
            reason: classifyUnsupportedPythonSource(pathSource, "path")
          }
        };
  }

  const remoteSource = readStringAssignment(line, "git") ?? readStringAssignment(line, "url");
  if (remoteSource === undefined) {
    return undefined;
  }

  return {
    unsupportedSource: {
      value: remoteSource,
      reason: classifyUnsupportedPythonSource(remoteSource, line.startsWith("git") ? "git" : "url")
    }
  };
}

function readInlineStringArrayAssignment(line: string, key: string): string[] | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\\[(.*)\\]\\s*$`).exec(line);
  if (!match?.[1]) {
    return undefined;
  }

  return readStringArrayValues(match[1]);
}

function readMultilineArrayAssignmentKey(line: string): "dependencies" | "groups" | undefined {
  const match = /^(dependencies|groups)\s*=\s*\[/.exec(line);
  return match?.[1] as "dependencies" | "groups" | undefined;
}

function dependencyNamesFromArray(value: string): string[] {
  const names: string[] = [];
  for (const requirement of readStringArrayValues(value)) {
    const name = dependencyNameFromRequirement(requirement);
    if (name && normalizePythonPackageName(name) !== "python") {
      names.push(name);
    }
  }

  return names;
}

function readStringArrayValues(value: string): string[] {
  const values: string[] = [];
  for (const match of value.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) {
      values.push(value.replace(/\\"/g, "\"").trim());
    }
  }

  return values.filter((value) => value.length > 0);
}

function dependencyNameFromRequirement(requirement: string): string | undefined {
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?/.exec(requirement.trim());
  return match?.[1];
}

function mergeRootDependency(
  roots: Map<string, DependencyType>,
  rawName: string,
  type: DependencyType
): void {
  const name = dependencyNameFromRequirement(rawName) ?? rawName;
  const existing = roots.get(name);
  roots.set(name, existing ? mergeDependencyType(existing, type) : type);
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

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function dependencyTypeForChildEdge(
  parentType: DependencyType,
  childType: DependencyType
): DependencyType {
  return parentType === "production" ? childType : parentType;
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyUnsupportedPythonSource(value: string, sourceKey: "path" | "git" | "url"): string {
  const source = value.trim();
  if (sourceKey === "git" || /^(?:git|hg|svn|bzr)\+(?:https?|ssh|git):\/\//i.test(source)) {
    return "unsupported_remote_vcs_source";
  }

  if (path.isAbsolute(source) || source.startsWith("file://")) {
    return "unsupported_absolute_source_path";
  }

  if (/^(?:https?|ssh|git):\/\//i.test(source)) {
    return "unsupported_remote_source";
  }

  return "unsupported_source_entry";
}
