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

type SwiftPackagePin = {
  name: string;
  version: string;
  id: string;
};

export function parseSwiftPackageResolvedFile(
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
        code: "SWIFT_PACKAGE_RESOLVED_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Package.resolved exceeded the maximum supported size."
          : "Failed to read Package.resolved.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseSwiftPackageResolvedText(lockfileText.value, lockfilePath);
}

export function parseSwiftPackageResolvedText(
  input: string,
  lockfilePath = "Package.resolved"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "SWIFT_PACKAGE_RESOLVED_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Package.resolved.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const pins = readSwiftPackagePins(parsed, lockfilePath);
  if (!pins.ok) {
    return pins;
  }

  const rootName = rootNameForPackageResolved(lockfilePath);
  return ok({
    rootName,
    lockfilePath,
    nodes: pins.value
      .map((pin): DependencyNode => ({
        id: pin.id,
        name: pin.name,
        version: pin.version,
        ecosystem: "swift",
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, pin.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readSwiftPackagePins(
  parsed: unknown,
  lockfilePath: string
): Result<SwiftPackagePin[], OhriskError> {
  const rawPins = swiftResolvedPins(parsed);
  if (!rawPins) {
    return err(
      createError({
        code: "SWIFT_PACKAGE_RESOLVED_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Package.resolved. Ohrisk expected a pins array.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const pins: SwiftPackagePin[] = [];
  for (const [index, value] of rawPins.entries()) {
    if (!isRecord(value)) {
      return swiftPinParseError(lockfilePath, index);
    }

    const name = swiftPinName(value);
    const version = isRecord(value.state) ? swiftPinVersion(value.state) : undefined;
    if (!name || !version) {
      return swiftPinParseError(lockfilePath, index, name);
    }

    pins.push({
      name,
      version,
      id: `${name}@${version}`
    });
  }

  if (pins.length === 0) {
    return err(
      createError({
        code: "SWIFT_PACKAGE_RESOLVED_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Package.resolved. Ohrisk expected at least one package pin.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok(deduplicateSwiftPins(pins));
}

function swiftResolvedPins(parsed: unknown): unknown[] | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }

  if (Array.isArray(parsed.pins)) {
    return parsed.pins;
  }

  return isRecord(parsed.object) && Array.isArray(parsed.object.pins)
    ? parsed.object.pins
    : undefined;
}

function swiftPinName(pin: Record<string, unknown>): string | undefined {
  for (const field of ["identity", "package"]) {
    const value = pin[field];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  const location = typeof pin.location === "string"
    ? pin.location
    : typeof pin.repositoryURL === "string"
      ? pin.repositoryURL
      : undefined;
  return location ? packageNameFromRepositoryLocation(location) : undefined;
}

function swiftPinVersion(state: Record<string, unknown>): string | undefined {
  for (const field of ["version", "revision", "branch"]) {
    const value = state[field];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return undefined;
}

function packageNameFromRepositoryLocation(location: string): string | undefined {
  const trimmed = location.trim().replace(/[\\/]+$/, "");
  if (trimmed === "") {
    return undefined;
  }

  const withoutGitSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  const normalized = withoutGitSuffix.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const candidate = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return candidate.trim() === "" ? undefined : candidate.trim();
}

function deduplicateSwiftPins(pins: SwiftPackagePin[]): SwiftPackagePin[] {
  const merged = new Map<string, SwiftPackagePin>();
  for (const pin of pins) {
    merged.set(pin.id, pin);
  }

  return [...merged.values()];
}

function rootNameForPackageResolved(lockfilePath: string): string {
  const segments = path.normalize(lockfilePath).split(path.sep);
  const xcodeContainerIndex = segments.findIndex((segment) =>
    segment.endsWith(".xcodeproj") || segment.endsWith(".xcworkspace")
  );

  if (xcodeContainerIndex > 0) {
    return segments[xcodeContainerIndex - 1] || "<swift-project>";
  }

  return path.basename(path.dirname(lockfilePath)) || "<swift-project>";
}

function swiftPinParseError(
  lockfilePath: string,
  index: number,
  packageName?: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "SWIFT_PACKAGE_RESOLVED_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Package.resolved pin. Ohrisk requires a package identity and a resolved version, revision, or branch.",
      details: {
        lockfilePath,
        pinIndex: index,
        ...(packageName ? { packageName } : {})
      }
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
