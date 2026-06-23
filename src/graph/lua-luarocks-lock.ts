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

type LuarocksRecord = {
  id: string;
  name: string;
  version: string;
};

export function parseLuarocksLockfile(
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
        code: "LUAROCKS_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "luarocks.lock exceeded the maximum supported size."
          : "Failed to read luarocks.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseLuarocksLockText(lockfileText.value, lockfilePath);
}

export function parseLuarocksLockText(
  input: string,
  lockfilePath = "luarocks.lock"
): Result<DependencyGraph, OhriskError> {
  const dependencyTable = extractDependencyTable(input);
  if (dependencyTable === undefined) {
    return luarocksLockShapeError(lockfilePath, "missing_dependencies_table");
  }

  const records = readLuarocksRecords(dependencyTable);
  if (records.length === 0) {
    return luarocksLockShapeError(lockfilePath, "no_dependencies");
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<lua-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "luarocks",
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function extractDependencyTable(input: string): string | undefined {
  const match = /\bdependencies\s*=\s*\{/.exec(input);
  if (!match) {
    return undefined;
  }

  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start + 1, index);
      }
    }
  }

  return undefined;
}

function readLuarocksRecords(input: string): LuarocksRecord[] {
  const records = new Map<string, LuarocksRecord>();
  const entryPattern = /(?:\[\s*(["'])((?:\\.|(?!\1).)+)\1\s*\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*(["'])((?:\\.|(?!\4).)+)\4/g;

  for (const match of input.matchAll(entryPattern)) {
    const name = unescapeLuaString(match[2] ?? match[3] ?? "");
    const version = unescapeLuaString(match[5] ?? "");
    if (!isLuarocksPackageName(name) || version === "") {
      continue;
    }

    const record = {
      id: `${name}@${version}`,
      name,
      version
    };
    records.set(record.id, record);
  }

  return [...records.values()];
}

function unescapeLuaString(input: string): string {
  return input.replace(/\\(["'\\])/g, "$1");
}

function isLuarocksPackageName(input: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(input);
}

function luarocksLockShapeError(
  lockfilePath: string,
  reason: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "LUAROCKS_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse luarocks.lock. Ohrisk supports literal LuaRocks dependencies table pins.",
      details: {
        lockfilePath,
        reason
      }
    })
  );
}
