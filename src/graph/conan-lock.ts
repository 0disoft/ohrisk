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

type ConanLockRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
};

const CONAN_LOCK_FIELDS: Array<{
  field: "requires" | "build_requires" | "python_requires";
  dependencyType: DependencyType;
}> = [
  {
    field: "requires",
    dependencyType: "production"
  },
  {
    field: "build_requires",
    dependencyType: "development"
  },
  {
    field: "python_requires",
    dependencyType: "development"
  }
];

export function parseConanLockfile(
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
        code: "CONAN_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "conan.lock exceeded the maximum supported size."
          : "Failed to read conan.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseConanLockText(lockfileText.value, lockfilePath);
}

export function parseConanLockText(
  input: string,
  lockfilePath = "conan.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    return err(
      createError({
        code: "CONAN_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse conan.lock as JSON.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed)) {
    return conanLockShapeError({
      lockfilePath,
      reason: "root_not_object"
    });
  }

  const records = readConanLockRecords({
    lockfile: parsed,
    lockfilePath
  });
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<conan-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "conan",
        dependencyType: record.dependencyType,
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readConanLockRecords(input: {
  lockfile: Record<string, unknown>;
  lockfilePath: string;
}): Result<ConanLockRecord[], OhriskError> {
  const records = new Map<string, ConanLockRecord>();

  for (const field of CONAN_LOCK_FIELDS) {
    const value = input.lockfile[field.field];
    if (value === undefined) {
      continue;
    }

    if (!Array.isArray(value)) {
      return conanLockShapeError({
        lockfilePath: input.lockfilePath,
        field: field.field,
        reason: "field_not_array"
      });
    }

    for (const [index, entry] of value.entries()) {
      if (typeof entry !== "string") {
        return conanLockShapeError({
          lockfilePath: input.lockfilePath,
          field: field.field,
          index,
          reason: "entry_not_string"
        });
      }

      const recipe = parseConanRecipeReference(entry);
      if (!recipe) {
        return conanLockShapeError({
          lockfilePath: input.lockfilePath,
          field: field.field,
          index,
          reason: "entry_not_recipe_reference",
          entry
        });
      }

      const existing = records.get(recipe.id);
      records.set(recipe.id, {
        ...recipe,
        dependencyType: existing
          ? strongestDependencyType(existing.dependencyType, field.dependencyType)
          : field.dependencyType
      });
    }
  }

  if (records.size === 0) {
    return conanLockShapeError({
      lockfilePath: input.lockfilePath,
      reason: "no_supported_requires"
    });
  }

  return ok([...records.values()]);
}

function parseConanRecipeReference(input: string): Omit<ConanLockRecord, "dependencyType"> | undefined {
  const withoutTimestamp = input.trim().split("%", 1)[0]?.trim() ?? "";
  const withoutPackageId = withoutTimestamp.split(":", 1)[0]?.trim() ?? "";
  const withoutRevision = withoutPackageId.split("#", 1)[0]?.trim() ?? "";
  if (withoutRevision === "") {
    return undefined;
  }

  const [nameAndVersion = "", userAndChannel] = withoutRevision.split("@", 2);
  if (userAndChannel !== undefined && !isValidConanUserChannel(userAndChannel)) {
    return undefined;
  }

  const slashIndex = nameAndVersion.indexOf("/");
  if (slashIndex <= 0 || slashIndex === nameAndVersion.length - 1) {
    return undefined;
  }

  const name = nameAndVersion.slice(0, slashIndex).trim();
  const version = nameAndVersion.slice(slashIndex + 1).trim();
  if (!isValidConanNamePart(name) || !isValidConanNamePart(version)) {
    return undefined;
  }

  return {
    name,
    version,
    id: `${name}@${version}`
  };
}

function isValidConanUserChannel(value: string): boolean {
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return false;
  }

  return isValidConanNamePart(value.slice(0, slashIndex))
    && isValidConanNamePart(value.slice(slashIndex + 1));
}

function isValidConanNamePart(value: string): boolean {
  return /^[A-Za-z0-9_.+~-]+$/.test(value);
}

function strongestDependencyType(
  left: DependencyType,
  right: DependencyType
): DependencyType {
  return dependencyTypeRank(right) > dependencyTypeRank(left) ? right : left;
}

function dependencyTypeRank(value: DependencyType): number {
  switch (value) {
    case "production":
      return 4;
    case "optional":
      return 3;
    case "peer":
      return 2;
    case "development":
      return 1;
    case "unknown":
      return 0;
  }
}

function conanLockShapeError(input: {
  lockfilePath: string;
  field?: string;
  index?: number;
  reason: string;
  entry?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "CONAN_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse conan.lock. Ohrisk supports Conan 2 lockfiles with requires, build_requires, or python_requires arrays.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
