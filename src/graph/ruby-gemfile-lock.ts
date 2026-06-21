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

type GemRecord = {
  name: string;
  version: string;
  id: string;
  dependencies: string[];
};

export function parseGemfileLockfile(
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
        code: "GEMFILE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Gemfile.lock exceeded the maximum supported size."
          : "Failed to read Gemfile.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseGemfileLockText(lockfileText.value, lockfilePath);
}

export function parseGemfileLockText(
  input: string,
  lockfilePath = "Gemfile.lock"
): Result<DependencyGraph, OhriskError> {
  try {
    const parsed = parseGemfileLockRecords(input);
    if (parsed.records.length === 0) {
      return err(
        createError({
          code: "GEMFILE_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse Gemfile.lock. Ohrisk expected at least one gem spec.",
          details: {
            lockfilePath
          }
        })
      );
    }

    const rootName = path.basename(path.dirname(lockfilePath)) || "<ruby-project>";
    const roots = parsed.dependencies.length > 0
      ? parsed.dependencies
      : inferGemRootNames(parsed.records);
    const nodeMap = new Map<string, DependencyNode>();

    for (const root of roots) {
      const record = resolveGemRecord(parsed.records, root);
      if (!record) {
        continue;
      }

      walkGemDependency({
        record,
        dependencyType: "production",
        direct: true,
        path: [rootName],
        records: parsed.records,
        nodeMap,
        seen: new Set()
      });
    }

    return ok({
      rootName,
      lockfilePath,
      nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
    });
  } catch (cause) {
    return err(
      createError({
        code: "GEMFILE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Gemfile.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function parseGemfileLockRecords(input: string): {
  records: GemRecord[];
  dependencies: string[];
} {
  const records: GemRecord[] = [];
  const dependencies: string[] = [];
  let section = "";
  let current: GemRecord | undefined;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      continue;
    }

    if (/^[A-Z][A-Z _-]+$/.test(line.trim()) && !line.startsWith(" ")) {
      section = line.trim();
      current = undefined;
      continue;
    }

    if (section === "GEM") {
      const spec = /^    ([^\s(]+) \(([^)]+)\)$/.exec(line);
      if (spec?.[1] && spec[2]) {
        current = {
          name: spec[1],
          version: spec[2],
          id: `${spec[1]}@${spec[2]}`,
          dependencies: []
        };
        records.push(current);
        continue;
      }

      const dependency = /^      ([^\s(]+)(?: \([^)]+\))?$/.exec(line);
      if (dependency?.[1] && current) {
        current.dependencies.push(dependency[1]);
      }
      continue;
    }

    if (section === "DEPENDENCIES") {
      const dependency = /^  ([^\s(!]+)!?(?: \([^)]+\))?$/.exec(line);
      if (dependency?.[1]) {
        dependencies.push(dependency[1]);
      }
    }
  }

  return {
    records: deduplicateGemRecords(records),
    dependencies: [...new Set(dependencies)].sort()
  };
}

function deduplicateGemRecords(records: GemRecord[]): GemRecord[] {
  const seen = new Map<string, GemRecord>();
  for (const record of records) {
    const existing = seen.get(record.id);
    seen.set(record.id, existing
      ? {
          ...existing,
          dependencies: [...new Set([...existing.dependencies, ...record.dependencies])].sort()
        }
      : record);
  }

  return [...seen.values()];
}

function inferGemRootNames(records: GemRecord[]): string[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      referenced.add(dependency);
    }
  }

  return records
    .filter((record) => !referenced.has(record.name))
    .map((record) => record.name)
    .sort();
}

function walkGemDependency(input: {
  record: GemRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: GemRecord[];
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
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "gem",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const record = resolveGemRecord(input.records, dependency);
    if (!record) {
      continue;
    }

    walkGemDependency({
      record,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveGemRecord(records: GemRecord[], name: string): GemRecord | undefined {
  const matches = records.filter((record) => record.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}
