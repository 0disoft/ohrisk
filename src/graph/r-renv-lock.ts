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

type RPackageRecord = {
  name: string;
  version: string;
  id: string;
  resolved?: string;
};

export function parseRenvLockfile(
  lockfilePath: string,
  options: { maxBytes?: number; descriptionMaxBytes?: number } = {}
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

  const descriptionText = readOptionalDescription({
    lockfilePath,
    maxBytes: options.descriptionMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!descriptionText.ok) {
    return descriptionText;
  }

  return parseRenvLockText(lockfileText.value, lockfilePath, {
    descriptionText: descriptionText.value
  });
}

export function parseRenvLockText(
  input: string,
  lockfilePath = "renv.lock",
  options: { descriptionText?: string } = {}
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
  const rootTypes = options.descriptionText
    ? readDescriptionRootTypes(options.descriptionText, records.value)
    : new Map<string, DependencyType>();
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
        dependencyType: rootTypes.get(record.name) ?? "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readOptionalDescription(input: {
  lockfilePath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const descriptionPath = path.join(path.dirname(input.lockfilePath), "DESCRIPTION");
  if (!existsSync(descriptionPath)) {
    return ok(undefined);
  }

  const descriptionText = readInputTextFile({
    filePath: descriptionPath,
    maxBytes: input.maxBytes
  });
  if (!descriptionText.ok) {
    return err(
      createError({
        code: "RENV_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(descriptionText.error),
        message: descriptionText.error.kind === "too_large"
          ? "DESCRIPTION exceeded the maximum supported size."
          : "Failed to read DESCRIPTION.",
        details: {
          descriptionPath,
          ...inputFileReadErrorDetails(descriptionText.error)
        }
      })
    );
  }

  return ok(descriptionText.value);
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

function readDescriptionRootTypes(
  input: string,
  records: RPackageRecord[]
): Map<string, DependencyType> {
  const recordNames = new Set(records.map((record) => record.name));
  const fields = readDescriptionFields(input);
  const roots = new Map<string, DependencyType>();

  for (const field of ["Suggests", "Enhances"]) {
    for (const dependencyName of readRDependencyNames(fields.get(field) ?? "")) {
      if (recordNames.has(dependencyName)) {
        roots.set(dependencyName, "development");
      }
    }
  }

  for (const field of ["Depends", "Imports", "LinkingTo"]) {
    for (const dependencyName of readRDependencyNames(fields.get(field) ?? "")) {
      if (recordNames.has(dependencyName)) {
        roots.set(dependencyName, "production");
      }
    }
  }

  return roots;
}

function readDescriptionFields(input: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;

  for (const rawLine of input.split(/\r?\n/)) {
    if (/^\s/.test(rawLine) && currentKey) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ""} ${rawLine.trim()}`.trim());
      continue;
    }

    const match = /^([A-Za-z][A-Za-z0-9.-]*):\s*(.*)$/.exec(rawLine);
    if (!match?.[1] || match[2] === undefined) {
      currentKey = undefined;
      continue;
    }

    currentKey = match[1];
    fields.set(currentKey, match[2].trim());
  }

  return fields;
}

function readRDependencyNames(input: string): string[] {
  return input
    .split(",")
    .map((item) => /^([A-Za-z][A-Za-z0-9.]*)/.exec(item.trim())?.[1])
    .filter((item): item is string => item !== undefined && item !== "R")
    .sort();
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
