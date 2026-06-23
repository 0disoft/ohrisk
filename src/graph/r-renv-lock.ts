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

type RPackageRecord = {
  name: string;
  version: string;
  id: string;
  resolved?: string;
};

export function parseRenvLockfile(
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
        code: "RENV_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "renv.lock exceeded the maximum supported size."
          : "Failed to read renv.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseRenvLockText(lockfileText.value, lockfilePath);
}

export function parseRenvLockText(
  input: string,
  lockfilePath = "renv.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    return err(
      createError({
        code: "RENV_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse renv.lock as JSON.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readRPackageRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<r-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "cran",
        ...(record.resolved ? { resolved: record.resolved } : {}),
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readRPackageRecords(
  parsed: unknown,
  lockfilePath: string
): Result<RPackageRecord[], OhriskError> {
  if (!isRecord(parsed) || !isRecord(parsed.Packages)) {
    return renvLockShapeError({
      lockfilePath,
      reason: "missing_packages_object"
    });
  }

  const records = new Map<string, RPackageRecord>();
  for (const [lockfileName, value] of Object.entries(parsed.Packages)) {
    if (!isRecord(value)) {
      return renvLockShapeError({
        lockfilePath,
        packageName: lockfileName,
        reason: "invalid_package_record"
      });
    }

    const name = typeof value.Package === "string" && value.Package.trim() !== ""
      ? value.Package.trim()
      : lockfileName.trim();
    const version = typeof value.Version === "string" ? value.Version.trim() : "";

    if (name === "" || version === "") {
      return renvLockShapeError({
        lockfilePath,
        packageName: lockfileName,
        reason: "missing_package_or_version"
      });
    }

    const record = {
      name,
      version,
      id: `${name}@${version}`,
      ...renvResolvedSource(value)
    };
    records.set(record.id, record);
  }

  if (records.size === 0) {
    return renvLockShapeError({
      lockfilePath,
      reason: "no_package_records"
    });
  }

  return ok([...records.values()]);
}

function renvResolvedSource(record: Record<string, unknown>): { resolved?: string } {
  for (const key of ["RemoteUrl", "Repository", "Source"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return { resolved: value.trim() };
    }
  }

  return {};
}

function renvLockShapeError(input: {
  lockfilePath: string;
  packageName?: string;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "RENV_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse renv.lock. Ohrisk supports renv lockfiles with a Packages object containing Package and Version records.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
