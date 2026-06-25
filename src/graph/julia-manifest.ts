import { existsSync } from "node:fs";
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

type JuliaManifestRecord = {
  name: string;
  version: string;
  dependencies: string[];
  id: string;
  resolved?: string;
};

type UnsupportedJuliaDependencyValueKind = "boolean" | "number" | "table" | "array" | "expression";

export function parseJuliaManifestFile(
  lockfilePath: string,
  options: { maxBytes?: number; projectMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "JULIA_MANIFEST_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Manifest.toml exceeded the maximum supported size."
          : "Failed to read Manifest.toml.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const projectText = readOptionalJuliaProject({
    lockfilePath,
    maxBytes: options.projectMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!projectText.ok) {
    return projectText;
  }

  return parseJuliaManifestText(lockfileText.value, lockfilePath, {
    projectText: projectText.value
  });
}

export function parseJuliaManifestText(
  input: string,
  lockfilePath = "Manifest.toml",
  options: { projectText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  const records = readJuliaManifestRecords(input, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<julia-project>";
  const referencedNames = new Set(records.value.flatMap((record) => record.dependencies));
  const projectRootTypes = options.projectText
    ? readJuliaProjectRootTypes(options.projectText, records.value)
    : new Map<string, DependencyType>();
  const projectRootNames = projectRootTypes.size > 0
    ? new Set(projectRootTypes.keys())
    : undefined;

  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "julia",
        ...(record.resolved ? { resolved: record.resolved } : {}),
        dependencyType: projectRootTypes.size > 0
          ? juliaDependencyType({ record, records: records.value, rootTypes: projectRootTypes })
          : "unknown",
        direct: projectRootTypes.size > 0
          ? projectRootTypes.has(record.name)
          : !referencedNames.has(record.name),
        paths: juliaPackagePaths({
          record,
          records: records.value,
          rootName,
          rootNames: projectRootNames
        })
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readOptionalJuliaProject(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const projectTomlPath = path.join(path.dirname(input.lockfilePath), "Project.toml");
  if (!existsSync(projectTomlPath)) {
    return ok(undefined);
  }

  const projectText = readInputTextFile({
    filePath: projectTomlPath,
    maxBytes: input.maxBytes
  });
  if (!projectText.ok) {
    return err(
      createError({
        code: "JULIA_MANIFEST_READ_FAILED",
        category: inputFileReadErrorCategory(projectText.error),
        message: projectText.error.kind === "too_large"
          ? "Project.toml exceeded the maximum supported size."
          : "Failed to read Project.toml.",
        details: {
          projectTomlPath,
          ...inputFileReadErrorDetails(projectText.error)
        }
      })
    );
  }

  return ok(projectText.value);
}

function readJuliaManifestRecords(
  input: string,
  lockfilePath: string
): Result<JuliaManifestRecord[], OhriskError> {
  const records = new Map<string, Partial<JuliaManifestRecord> & { name: string }>();
  let current: (Partial<JuliaManifestRecord> & { name: string }) | undefined;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const packageHeader = line.match(/^\[\[deps\.([A-Za-z0-9_.-]+)\]\]$/);
    if (packageHeader?.[1]) {
      current = {
        name: packageHeader[1],
        dependencies: []
      };
      records.set(current.name, current);
      continue;
    }

    if (/^\[/.test(line)) {
      current = undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!keyValue?.[1] || keyValue[2] === undefined) {
      continue;
    }

    const key = keyValue[1];
    const value = keyValue[2].trim();
    if (key === "version") {
      current.version = parseTomlString(value);
    } else if (key === "deps") {
      const dependencies = parseTomlStringArrayStrict(value);
      if (!dependencies.ok) {
        return unsupportedJuliaDependencyError(lockfilePath, current.name, dependencies.error);
      }

      current.dependencies = dependencies.value;
    } else if (key === "git-tree-sha1" || key === "repo-rev") {
      current.resolved = parseTomlString(value);
    }
  }

  const parsedRecords: JuliaManifestRecord[] = [];
  for (const record of records.values()) {
    if (!record.version) {
      continue;
    }

    const dependencies = (record.dependencies ?? [])
      .filter((dependencyName) => records.has(dependencyName))
      .sort();
    parsedRecords.push({
      name: record.name,
      version: record.version,
      dependencies,
      id: `${record.name}@${record.version}`,
      ...(record.resolved ? { resolved: record.resolved } : {})
    });
  }

  if (parsedRecords.length === 0) {
    return err(
      createError({
        code: "JULIA_MANIFEST_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Manifest.toml. Ohrisk expected at least one [[deps.Name]] record with a version.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok(parsedRecords);
}

function readJuliaProjectRootTypes(
  input: string,
  records: JuliaManifestRecord[]
): Map<string, DependencyType> {
  const manifestNames = new Set(records.map((record) => record.name));
  const dependencies = new Set<string>();
  const extras = new Set<string>();
  const testTargets = new Set<string>();
  let section = "";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sectionMatch?.[1]) {
      section = sectionMatch[1];
      continue;
    }

    const keyValue = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!keyValue?.[1] || keyValue[2] === undefined) {
      continue;
    }

    if (section === "deps") {
      dependencies.add(keyValue[1]);
    } else if (section === "extras") {
      extras.add(keyValue[1]);
    } else if (section === "targets" && keyValue[1] === "test") {
      for (const dependencyName of parseTomlStringArray(keyValue[2])) {
        testTargets.add(dependencyName);
      }
    }
  }

  const roots = new Map<string, DependencyType>();
  for (const dependencyName of [...dependencies].sort()) {
    if (manifestNames.has(dependencyName)) {
      roots.set(dependencyName, "production");
    }
  }

  for (const dependencyName of [...testTargets].sort()) {
    if (extras.has(dependencyName) && manifestNames.has(dependencyName) && !roots.has(dependencyName)) {
      roots.set(dependencyName, "development");
    }
  }

  return roots;
}

function juliaDependencyType(input: {
  record: JuliaManifestRecord;
  records: JuliaManifestRecord[];
  rootTypes: Map<string, DependencyType>;
  visiting?: Set<string>;
}): DependencyType {
  const rootType = input.rootTypes.get(input.record.name);
  let dependencyType: DependencyType = rootType ?? "unknown";
  const visiting = input.visiting ?? new Set<string>();
  if (visiting.has(input.record.id)) {
    return dependencyType;
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(input.record.id);
  for (const parent of input.records.filter((candidate) =>
    candidate.dependencies.includes(input.record.name)
  )) {
    dependencyType = mergeDependencyType(
      dependencyType,
      juliaDependencyType({
        record: parent,
        records: input.records,
        rootTypes: input.rootTypes,
        visiting: nextVisiting
      })
    );
  }

  return dependencyType;
}

function juliaPackagePaths(input: {
  record: JuliaManifestRecord;
  records: JuliaManifestRecord[];
  rootName: string;
  rootNames?: Set<string>;
  visiting?: Set<string>;
}): string[][] {
  const parentRecords = input.records.filter((candidate) =>
    candidate.dependencies.includes(input.record.name)
  );
  if (!input.rootNames && parentRecords.length === 0) {
    return [[input.rootName, input.record.id]];
  }

  const visiting = input.visiting ?? new Set<string>();
  if (visiting.has(input.record.id)) {
    return input.rootNames?.has(input.record.name)
      ? [[input.rootName, input.record.id]]
      : [];
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(input.record.id);
  const paths = input.rootNames?.has(input.record.name)
    ? [[input.rootName, input.record.id]]
    : [];

  paths.push(
    ...parentRecords.flatMap((parent) =>
      juliaPackagePaths({
        record: parent,
        records: input.records,
        rootName: input.rootName,
        rootNames: input.rootNames,
        visiting: nextVisiting
      }).map((parentPath) => [...parentPath, input.record.id])
    )
  );

  return deduplicatePaths(paths.length > 0 ? paths : [[input.rootName, input.record.id]]);
}

function deduplicatePaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];
  for (const item of paths) {
    const key = item.join("\0");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function parseTomlString(value: string): string | undefined {
  const match = value.match(/^"((?:\\"|[^"])*)"$/);
  return match?.[1] ? match[1].replace(/\\"/g, "\"") : undefined;
}

function parseTomlStringArray(value: string): string[] {
  const parsed = parseTomlStringArrayStrict(value);
  return parsed.ok ? parsed.value : [];
}

function parseTomlStringArrayStrict(
  value: string
): Result<string[], UnsupportedJuliaDependencyValueKind[]> {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return ok([]);
  }

  const stringPattern = /"((?:\\"|[^"])*)"/g;
  const unsupportedKinds = readUnsupportedTomlArrayKinds(
    trimmed.slice(1, -1).replace(stringPattern, "")
  );
  if (unsupportedKinds.length > 0) {
    return err(unsupportedKinds);
  }

  return ok(
    [...trimmed.matchAll(stringPattern)]
      .map((match) => match[1]?.replace(/\\"/g, "\""))
      .filter((item): item is string => item !== undefined && item.trim() !== "")
  );
}

function readUnsupportedTomlArrayKinds(input: string): UnsupportedJuliaDependencyValueKind[] {
  const kinds = new Set<UnsupportedJuliaDependencyValueKind>();
  for (const token of input.split(",").map((item) => item.trim()).filter((item) => item !== "")) {
    if (token.startsWith("{")) {
      kinds.add("table");
    } else if (token.startsWith("[")) {
      kinds.add("array");
    } else if (token === "true" || token === "false") {
      kinds.add("boolean");
    } else if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(token)) {
      kinds.add("number");
    } else {
      kinds.add("expression");
    }
  }

  return [...kinds].sort();
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
  if (left === "production" || right === "production") {
    return "production";
  }

  if (left === "development" || right === "development") {
    return "development";
  }

  return left;
}

function unsupportedJuliaDependencyError(
  lockfilePath: string,
  packageName: string,
  valueKinds: UnsupportedJuliaDependencyValueKind[]
): Result<never, OhriskError> {
  return err(
    createError({
      code: "JULIA_MANIFEST_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Manifest.toml. Ohrisk supports literal string dependency names.",
      details: {
        lockfilePath,
        packageName,
        reason: "unsupported_julia_dependency_entries",
        unsupportedDependencyValueKinds: valueKinds
      }
    })
  );
}
