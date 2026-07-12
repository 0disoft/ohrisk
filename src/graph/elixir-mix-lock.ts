import { omitUndefined } from "../shared/object";
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

type HexRecord = {
  name: string;
  version: string;
  id: string;
};

export function parseMixLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; mixExsMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "MIX_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "mix.lock exceeded the maximum supported size."
          : "Failed to read mix.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  const mixExsText = readOptionalMixExs({
    lockfilePath,
    maxBytes: options.mixExsMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!mixExsText.ok) {
    return mixExsText;
  }

  return parseMixLockText(lockfileText.value, lockfilePath, omitUndefined({
    mixExsText: mixExsText.value
  }));
}

export function parseMixLockText(
  input: string,
  lockfilePath = "mix.lock",
  options: { mixExsText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  const records = readHexRecords(input);
  if (records.length === 0) {
    return err(
      createError({
        code: "MIX_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse mix.lock. Ohrisk expected at least one Hex package entry.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<elixir-project>";
  const rootTypes = options.mixExsText
    ? readMixRootTypes(options.mixExsText, records)
    : new Map<string, DependencyType>();
  return ok({
    rootName,
    lockfilePath,
    nodes: records
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "hex",
        dependencyType: rootTypes.get(record.name) ?? "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readOptionalMixExs(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const mixExsPath = path.join(path.dirname(input.lockfilePath), "mix.exs");
  if (!existsSync(mixExsPath)) {
    return ok(undefined);
  }

  const mixExsText = readInputTextFile({
    filePath: mixExsPath,
    maxBytes: input.maxBytes
  });
  if (!mixExsText.ok) {
    return err(
      createError({
        code: "MIX_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(mixExsText.error),
        message: mixExsText.error.kind === "too_large"
          ? "mix.exs exceeded the maximum supported size."
          : "Failed to read mix.exs.",
        details: {
          mixExsPath,
          ...inputFileReadErrorDetails(mixExsText.error)
        }
      })
    );
  }

  return ok(mixExsText.value);
}

function readHexRecords(input: string): HexRecord[] {
  const records = new Map<string, HexRecord>();
  const entryPattern = /"([^"]+)"\s*(?::|=>)\s*\{:hex,\s*(?::([A-Za-z0-9_.-]+)|:"([^"]+)")\s*,\s*"([^"]+)"/g;

  for (const match of input.matchAll(entryPattern)) {
    const keyName = match[1]?.trim();
    const atomName = (match[2] ?? match[3])?.trim();
    const version = match[4]?.trim();
    const name = atomName || keyName;
    if (!name || !version) {
      continue;
    }

    const record = {
      name,
      version,
      id: `${name}@${version}`
    };
    records.set(record.id, record);
  }

  return [...records.values()];
}

function readMixRootTypes(input: string, records: HexRecord[]): Map<string, DependencyType> {
  const recordNames = new Set(records.map((record) => record.name));
  const roots = new Map<string, DependencyType>();

  for (const dependency of readMixRootDependencies(input)) {
    if (!recordNames.has(dependency.name)) {
      continue;
    }

    const existing = roots.get(dependency.name);
    roots.set(
      dependency.name,
      existing ? mergeDependencyType(existing, dependency.type) : dependency.type
    );
  }

  return roots;
}

function readMixRootDependencies(input: string): Array<{ name: string; type: DependencyType }> {
  const dependencies: Array<{ name: string; type: DependencyType }> = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripElixirComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const match = /\{(?:\s*:([A-Za-z0-9_.-]+)|\s*:"([^"]+)")\s*,/.exec(line);
    const name = (match?.[1] ?? match?.[2])?.trim();
    if (!name) {
      continue;
    }

    dependencies.push({
      name,
      type: readMixOnlyType(line)
    });
  }

  return dependencies;
}

function readMixOnlyType(line: string): DependencyType {
  const match = /(?:^|[\s,])only:\s*(\[[^\]]+\]|:[A-Za-z_][A-Za-z0-9_]*|["'][^"']+["'])/.exec(line);
  if (!match?.[1]) {
    return "production";
  }

  const onlyValue = match[1];
  const environments = [...onlyValue.matchAll(/(?::|["'])([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((environment) => environment[1])
    .filter((environment): environment is string => environment !== undefined);
  return environments.length > 0 && !environments.includes("prod")
    ? "development"
    : "production";
}

function stripElixirComment(line: string): string {
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

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  if (left === "production" || right === "production") {
    return "production";
  }

  if (left === "development" || right === "development") {
    return "development";
  }

  return left;
}
