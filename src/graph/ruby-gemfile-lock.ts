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

type GemRecord = {
  name: string;
  version: string;
  id: string;
  dependencies: string[];
};

type GemRootDependency = {
  name: string;
  type: DependencyType;
};

type GemfileBlockFrame = {
  dependencyType?: DependencyType;
};

export function parseGemfileLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; gemfileMaxBytes?: number } = {}
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

  const gemfileText = readOptionalGemfile({
    lockfilePath,
    maxBytes: options.gemfileMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!gemfileText.ok) {
    return gemfileText;
  }

  return parseGemfileLockText(lockfileText.value, lockfilePath, {
    gemfileText: gemfileText.value
  });
}

export function parseGemfileLockText(
  input: string,
  lockfilePath = "Gemfile.lock",
  options: { gemfileText?: string } = {}
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
    const roots = readGemRootDependencies({
      gemfileText: options.gemfileText,
      lockfileDependencies: parsed.dependencies,
      records: parsed.records
    });
    const nodeMap = new Map<string, DependencyNode>();

    for (const root of roots) {
      const record = resolveGemRecord(parsed.records, root.name);
      if (!record) {
        continue;
      }

      walkGemDependency({
        record,
        dependencyType: root.type,
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

function readOptionalGemfile(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const gemfilePath = path.join(path.dirname(input.lockfilePath), "Gemfile");
  if (!existsSync(gemfilePath)) {
    return ok(undefined);
  }

  const gemfileText = readInputTextFile({
    filePath: gemfilePath,
    maxBytes: input.maxBytes
  });
  if (!gemfileText.ok) {
    return err(
      createError({
        code: "GEMFILE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(gemfileText.error),
        message: gemfileText.error.kind === "too_large"
          ? "Gemfile exceeded the maximum supported size."
          : "Failed to read Gemfile.",
        details: {
          gemfilePath,
          ...inputFileReadErrorDetails(gemfileText.error)
        }
      })
    );
  }

  return ok(gemfileText.value);
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

function readGemRootDependencies(input: {
  gemfileText?: string;
  lockfileDependencies: string[];
  records: GemRecord[];
}): GemRootDependency[] {
  const fallbackNames = input.lockfileDependencies.length > 0
    ? input.lockfileDependencies
    : inferGemRootNames(input.records);
  const fallbackRoots = fallbackNames.map((name) => ({
    name,
    type: "production" as const
  }));
  if (!input.gemfileText) {
    return fallbackRoots;
  }

  const lockfileDependencyNames = new Set(fallbackNames);
  const byName = new Map<string, GemRootDependency>();
  for (const dependency of readGemfileDependencies(input.gemfileText)) {
    if (!lockfileDependencyNames.has(dependency.name)) {
      continue;
    }

    const existing = byName.get(dependency.name);
    byName.set(dependency.name, {
      name: dependency.name,
      type: existing
        ? mergeDependencyType(existing.type, dependency.type)
        : dependency.type
    });
  }

  return byName.size > 0
    ? [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
    : fallbackRoots;
}

function readGemfileDependencies(gemfileText: string): GemRootDependency[] {
  const dependencies: GemRootDependency[] = [];
  const blockStack: GemfileBlockFrame[] = [];

  for (const rawLine of gemfileText.split(/\r?\n/)) {
    const line = stripRubyComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const groupType = readGemfileGroupType(line);
    if (groupType) {
      blockStack.push({ dependencyType: groupType });
      continue;
    }

    if (line === "end" && blockStack.length > 0) {
      blockStack.pop();
      continue;
    }

    const name = readGemfileGemName(line);
    if (name) {
      dependencies.push({
        name,
        type: blockStack.some((block) => block.dependencyType === "development")
          ? "development"
          : "production"
      });
    }

    if (blockStack.length > 0 && isRubyBlockStart(line)) {
      blockStack.push({});
    }
  }

  return dependencies;
}

function readGemfileGroupType(line: string): DependencyType | undefined {
  const match = /^group\s+(.+)\s+do$/.exec(line);
  if (!match?.[1]) {
    return undefined;
  }

  return /:(?:development|test)\b/.test(match[1]) ? "development" : "production";
}

function readGemfileGemName(line: string): string | undefined {
  const match = /^gem\s+["']([^"']+)["']/.exec(line);
  return match?.[1];
}

function isRubyBlockStart(line: string): boolean {
  return /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line);
}

function stripRubyComment(line: string): string {
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote) {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }

  return line;
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
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
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

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  if (left === "production" || right === "production") {
    return "production";
  }

  if (left === "development" || right === "development") {
    return "development";
  }

  return left;
}
