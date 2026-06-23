import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type JuliaManifestRecord = {
  name: string;
  version: string;
  dependencies: string[];
  id: string;
  resolved?: string;
};

export function parseJuliaManifestFile(
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

  return parseJuliaManifestText(lockfileText.value, lockfilePath);
}

export function parseJuliaManifestText(
  input: string,
  lockfilePath = "Manifest.toml"
): Result<DependencyGraph, OhriskError> {
  const records = readJuliaManifestRecords(input, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<julia-project>";
  const referencedNames = new Set(records.value.flatMap((record) => record.dependencies));

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
        dependencyType: "unknown",
        direct: !referencedNames.has(record.name),
        paths: juliaPackagePaths({
          record,
          records: records.value,
          rootName
        })
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
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
      current.dependencies = parseTomlStringArray(value);
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

function juliaPackagePaths(input: {
  record: JuliaManifestRecord;
  records: JuliaManifestRecord[];
  rootName: string;
  visiting?: Set<string>;
}): string[][] {
  const parentRecords = input.records.filter((candidate) =>
    candidate.dependencies.includes(input.record.name)
  );
  if (parentRecords.length === 0) {
    return [[input.rootName, input.record.id]];
  }

  const visiting = input.visiting ?? new Set<string>();
  if (visiting.has(input.record.id)) {
    return [[input.rootName, input.record.id]];
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(input.record.id);

  return deduplicatePaths(
    parentRecords.flatMap((parent) =>
      juliaPackagePaths({
        record: parent,
        records: input.records,
        rootName: input.rootName,
        visiting: nextVisiting
      }).map((parentPath) => [...parentPath, input.record.id])
    )
  );
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
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  return [...trimmed.matchAll(/"((?:\\"|[^"])*)"/g)]
    .map((match) => match[1]?.replace(/\\"/g, "\""))
    .filter((item): item is string => item !== undefined && item.trim() !== "");
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
