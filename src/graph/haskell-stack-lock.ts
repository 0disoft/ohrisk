import path from "node:path";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type StackLockRecord = {
  id: string;
  name: string;
  version: string;
};

export function parseStackLockfile(
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
        code: "STACK_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "stack.yaml.lock exceeded the maximum supported size."
          : "Failed to read stack.yaml.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseStackLockText(lockfileText.value, lockfilePath);
}

export function parseStackLockText(
  input: string,
  lockfilePath = "stack.yaml.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (cause) {
    return err(
      createError({
        code: "STACK_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse stack.yaml.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readStackLockRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<haskell-stack-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "hackage",
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readStackLockRecords(
  parsed: unknown,
  lockfilePath: string
): Result<StackLockRecord[], OhriskError> {
  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) {
    return stackLockShapeError(lockfilePath, "packages_not_array");
  }

  const records = new Map<string, StackLockRecord>();
  for (const [index, entry] of parsed.packages.entries()) {
    if (!isRecord(entry) || !isRecord(entry.completed)) {
      return stackLockShapeError(lockfilePath, "package_completed_not_object", index);
    }

    const hackage = typeof entry.completed.hackage === "string"
      ? entry.completed.hackage
      : undefined;
    if (!hackage) {
      continue;
    }

    const record = parseHackagePackage(hackage);
    if (!record) {
      return stackLockShapeError(lockfilePath, "invalid_hackage_package", index, hackage);
    }

    records.set(record.id, record);
  }

  if (records.size === 0) {
    return stackLockShapeError(lockfilePath, "no_hackage_packages");
  }

  return ok([...records.values()]);
}

function parseHackagePackage(input: string): StackLockRecord | undefined {
  const packageRef = input.split("@", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z][A-Za-z0-9-]*)-([0-9]+(?:\.[0-9]+)*)$/.exec(packageRef);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    id: `${match[1]}@${match[2]}`,
    name: match[1],
    version: match[2]
  };
}

function stackLockShapeError(
  lockfilePath: string,
  reason: string,
  index?: number,
  entry?: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "STACK_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse stack.yaml.lock. Ohrisk supports Stack lockfiles with completed Hackage package pins.",
      details: {
        lockfilePath,
        reason,
        ...(index === undefined ? {} : { index }),
        ...(entry === undefined ? {} : { entry })
      }
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
