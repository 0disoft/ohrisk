import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  PACKAGE_JSON_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph } from "./types";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "workspaces"
] as const;

export function parsePackageJsonManifestFile(
  packageJsonPath: string
): Result<DependencyGraph, OhriskError> {
  const text = readInputTextFile({
    filePath: packageJsonPath,
    maxBytes: PACKAGE_JSON_MAX_BYTES
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_JSON_READ_FAILED",
        category: inputFileReadErrorCategory(text.error),
        message: text.error.reason === "size_limit"
          ? "package.json exceeded the maximum supported size."
          : "Failed to read package.json.",
        details: {
          packageJsonPath,
          ...inputFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return parsePackageJsonManifestText(text.value, packageJsonPath);
}

export function parsePackageJsonManifestText(
  text: string,
  packageJsonPath = "package.json"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json.",
        details: {
          packageJsonPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed)) {
    return err(
      createError({
        code: "PACKAGE_JSON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse package.json. Ohrisk expected a JSON object.",
        details: {
          packageJsonPath
        }
      })
    );
  }

  const populatedDependencyFields = DEPENDENCY_FIELDS.filter((field) =>
    hasManifestEntries(parsed[field])
  );

  if (populatedDependencyFields.length > 0) {
    return err(
      createError({
        code: "NO_SUPPORTED_LOCKFILE",
        category: "unsupported_input",
        message: "package.json declares dependencies but no supported lockfile exists. Generate and commit a supported lockfile before scanning dependency projects.",
        details: {
          packageJsonPath,
          dependencyFields: populatedDependencyFields
        }
      })
    );
  }

  return ok({
    rootName: packageNameOrDirectory(parsed.name, packageJsonPath),
    lockfilePath: packageJsonPath,
    nodes: []
  });
}

function hasManifestEntries(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
}

function packageNameOrDirectory(value: unknown, packageJsonPath: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  const parent = path.basename(path.dirname(packageJsonPath));
  return parent === "" ? "." : parent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
