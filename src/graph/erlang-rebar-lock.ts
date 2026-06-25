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

type RebarHexRecord = {
  name: string;
  version: string;
  id: string;
  depth: number | undefined;
};

export function parseRebarLockfile(
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
        code: "REBAR_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "rebar.lock exceeded the maximum supported size."
          : "Failed to read rebar.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseRebarLockText(lockfileText.value, lockfilePath);
}

export function parseRebarLockText(
  input: string,
  lockfilePath = "rebar.lock"
): Result<DependencyGraph, OhriskError> {
  const records = readRebarHexRecords(input);
  if (records.length === 0) {
    return err(
      createError({
        code: "REBAR_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse rebar.lock. Ohrisk expected at least one Hex pkg entry.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<erlang-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "hex",
        dependencyType: record.depth === undefined || record.depth === 0
          ? "production"
          : "unknown",
        direct: record.depth === undefined || record.depth === 0,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readRebarHexRecords(input: string): RebarHexRecord[] {
  const records = new Map<string, RebarHexRecord>();
  const entryPattern = new RegExp([
    "\\{\\s*",
    erlangNamePattern(),
    "\\s*,\\s*\\{\\s*pkg\\s*,\\s*",
    erlangNamePattern(),
    "\\s*,\\s*",
    erlangStringPattern(),
    "(?:\\s*,[^}]*)?\\}\\s*,\\s*",
    "([0-9]+)"
  ].join(""), "g");

  for (const match of input.matchAll(entryPattern)) {
    const keyName = firstDefined(match[1], match[2], match[3]);
    const packageName = firstDefined(match[4], match[5], match[6]) ?? keyName;
    const version = firstDefined(match[7], match[8], match[9]);
    const depth = parseDepth(match[10]);
    if (!packageName || !version) {
      continue;
    }

    const record = {
      name: packageName,
      version,
      id: `${packageName}@${version}`,
      depth
    };
    records.set(record.id, record);
  }

  return [...records.values()];
}

function erlangNamePattern(): string {
  return `(?:${[
    "<<\"([^\"]+)\">>",
    "\"([^\"]+)\"",
    "([A-Za-z_][A-Za-z0-9_@]*)"
  ].join("|")})`;
}

function erlangStringPattern(): string {
  return `(?:${[
    "<<\"([^\"]+)\">>",
    "\"([^\"]+)\"",
    "'([^']+)'"
  ].join("|")})`;
}

function parseDepth(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "")?.trim();
}
