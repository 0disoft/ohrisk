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

type PodRecord = {
  name: string;
  version: string;
  id: string;
  dependencies: Set<string>;
};

export function parsePodfileLockfile(
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
        code: "PODFILE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Podfile.lock exceeded the maximum supported size."
          : "Failed to read Podfile.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parsePodfileLockText(lockfileText.value, lockfilePath);
}

export function parsePodfileLockText(
  input: string,
  lockfilePath = "Podfile.lock"
): Result<DependencyGraph, OhriskError> {
  const parsed = readPodfileLockRecords(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<cocoapods-project>";
  const records = [...parsed.value.records.values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const recordIdsByName = new Map(records.map((record) => [record.name, record.id]));
  const directNames = parsed.value.directNames.size > 0
    ? parsed.value.directNames
    : new Set(records.map((record) => record.name));

  return ok({
    rootName,
    lockfilePath,
    nodes: records.map((record): DependencyNode => ({
      id: record.id,
      name: record.name,
      version: record.version,
      ecosystem: "cocoapods",
      dependencyType: "unknown",
      direct: directNames.has(record.name),
      paths: pathsForPodRecord({
        rootName,
        record,
        recordsByName: parsed.value.records,
        recordIdsByName,
        directNames
      })
    }))
  });
}

function readPodfileLockRecords(
  input: string,
  lockfilePath: string
): Result<{
  records: Map<string, PodRecord>;
  directNames: Set<string>;
}, OhriskError> {
  const records = new Map<string, PodRecord>();
  const directNames = new Set<string>();
  let section = "";
  let currentPodName: string | undefined;

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") {
      continue;
    }

    if (!line.startsWith(" ") && line.endsWith(":")) {
      section = line.slice(0, -1);
      currentPodName = undefined;
      continue;
    }

    if (section === "PODS") {
      const parsed = parsePodEntryLine(line);
      if (!parsed) {
        continue;
      }

      if (parsed.indent === 2) {
        currentPodName = parsed.name;
        mergePodRecord(records, {
          name: parsed.name,
          version: parsed.version,
          dependencies: []
        });
        continue;
      }

      if (parsed.indent > 2 && currentPodName) {
        const current = records.get(currentPodName);
        if (current && parsed.name !== current.name) {
          current.dependencies.add(parsed.name);
        }
      }
    }

    if (section === "DEPENDENCIES") {
      const parsed = parseDependencyLine(line);
      if (parsed) {
        directNames.add(parsed.name);
      }
    }

    if (
      section === "PODS"
      && line.startsWith("  - ")
      && !line.startsWith("    ")
      && !parsePodEntryLine(line)
    ) {
      return err(
        createError({
          code: "PODFILE_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse Podfile.lock PODS entry.",
          details: {
            lockfilePath,
            line: index + 1,
            entry: line.trim()
          }
        })
      );
    }
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "PODFILE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Podfile.lock. Ohrisk expected at least one resolved pod entry.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok({
    records,
    directNames
  });
}

function parsePodEntryLine(line: string): {
  indent: number;
  name: string;
  version: string;
} | undefined {
  const match = /^(\s*)-\s+(.+?)\s+\(([^)]+)\)(?::)?$/.exec(line);
  if (!match) {
    return undefined;
  }

  const indent = match[1]?.length ?? 0;
  const rawName = match[2]?.trim();
  const rawVersion = match[3]?.trim();
  if (!rawName || !rawVersion) {
    return undefined;
  }

  const name = rootPodName(rawName);
  const version = resolvedPodVersion(rawVersion);
  if (!name || !version) {
    return undefined;
  }

  return {
    indent,
    name,
    version
  };
}

function parseDependencyLine(line: string): { name: string } | undefined {
  const match = /^\s*-\s+(.+)$/.exec(line);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  const name = rootPodName(value.replace(/\s+\(.+\)$/, ""));
  return name ? { name } : undefined;
}

function mergePodRecord(
  records: Map<string, PodRecord>,
  input: {
    name: string;
    version: string;
    dependencies: string[];
  }
): void {
  const existing = records.get(input.name);
  if (!existing) {
    records.set(input.name, {
      name: input.name,
      version: input.version,
      id: `${input.name}@${input.version}`,
      dependencies: new Set(input.dependencies)
    });
    return;
  }

  for (const dependency of input.dependencies) {
    existing.dependencies.add(dependency);
  }
}

function pathsForPodRecord(input: {
  rootName: string;
  record: PodRecord;
  recordsByName: Map<string, PodRecord>;
  recordIdsByName: Map<string, string>;
  directNames: Set<string>;
}): string[][] {
  if (input.directNames.has(input.record.name)) {
    return [[input.rootName, input.record.id]];
  }

  const paths: string[][] = [];
  for (const directName of [...input.directNames].sort()) {
    const directRecord = input.recordsByName.get(directName);
    if (!directRecord) {
      continue;
    }

    collectPodPaths({
      targetName: input.record.name,
      currentName: directRecord.name,
      recordsByName: input.recordsByName,
      recordIdsByName: input.recordIdsByName,
      path: [input.rootName, directRecord.id],
      seen: new Set([directRecord.name]),
      paths
    });
  }

  return paths.length > 0 ? paths : [[input.rootName, input.record.id]];
}

function collectPodPaths(input: {
  targetName: string;
  currentName: string;
  recordsByName: Map<string, PodRecord>;
  recordIdsByName: Map<string, string>;
  path: string[];
  seen: Set<string>;
  paths: string[][];
}): void {
  const current = input.recordsByName.get(input.currentName);
  if (!current) {
    return;
  }

  for (const dependencyName of [...current.dependencies].sort()) {
    if (input.seen.has(dependencyName)) {
      continue;
    }

    const dependencyId = input.recordIdsByName.get(dependencyName);
    if (!dependencyId) {
      continue;
    }

    const nextPath = [...input.path, dependencyId];
    if (dependencyName === input.targetName) {
      input.paths.push(nextPath);
      continue;
    }

    input.seen.add(dependencyName);
    collectPodPaths({
      ...input,
      currentName: dependencyName,
      path: nextPath,
      seen: input.seen
    });
    input.seen.delete(dependencyName);
  }
}

function rootPodName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") {
    return undefined;
  }

  const withoutConstraint = trimmed.replace(/\s*(?:=|~>|>=|>|<=|<).+$/, "").trim();
  const slashIndex = withoutConstraint.indexOf("/");
  const root = slashIndex >= 0 ? withoutConstraint.slice(0, slashIndex) : withoutConstraint;
  return root.trim() === "" ? undefined : root.trim();
}

function resolvedPodVersion(version: string): string | undefined {
  const trimmed = version.trim();
  if (trimmed === "") {
    return undefined;
  }

  return trimmed.replace(/^=\s*/, "").trim();
}
