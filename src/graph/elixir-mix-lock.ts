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

type HexRecord = {
  name: string;
  version: string;
  id: string;
};

export function parseMixLockfile(
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

  return parseMixLockText(lockfileText.value, lockfilePath);
}

export function parseMixLockText(
  input: string,
  lockfilePath = "mix.lock"
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
  return ok({
    rootName,
    lockfilePath,
    nodes: records
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "hex",
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
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
