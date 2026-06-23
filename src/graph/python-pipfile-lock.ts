import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  createDiskPythonLocalSourceFileReader,
  normalizePythonLocalSourcePathSpec,
  readPythonLocalSourcePackage,
  type PythonLocalSourceFileReader
} from "./python-local-source";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type PipfileLockRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  evidence?: LicenseEvidence;
};

type PipfileLockParseOptions = {
  readLocalSourceFile?: PythonLocalSourceFileReader;
  rootName?: string;
};

const PIPFILE_LOCK_LOCAL_SOURCE_ERRORS = {
  parseCode: "PIPFILE_LOCK_PARSE_FAILED",
  readCode: "PIPFILE_LOCK_READ_FAILED",
  displayName: "Pipfile.lock"
};

export function parsePipfileLockfile(
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
        code: "PIPFILE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Pipfile.lock exceeded the maximum supported size."
          : "Failed to read Pipfile.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parsePipfileLockText(lockfileText.value, lockfilePath, {
    readLocalSourceFile: createDiskPythonLocalSourceFileReader({
      rootDir: path.dirname(lockfilePath),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES,
      errors: PIPFILE_LOCK_LOCAL_SOURCE_ERRORS
    })
  });
}

export function parsePipfileLockText(
  input: string,
  lockfilePath = "Pipfile.lock",
  options: PipfileLockParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  const parsed = parsePipfileLockJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const defaultRecords = readPipfileLockSection({
    lockfilePath,
    sectionName: "default",
    value: parsed.value.default,
    dependencyType: "production",
    readLocalSourceFile: options.readLocalSourceFile
  });
  if (!defaultRecords.ok) {
    return defaultRecords;
  }

  const developRecords = readPipfileLockSection({
    lockfilePath,
    sectionName: "develop",
    value: parsed.value.develop,
    dependencyType: "development",
    readLocalSourceFile: options.readLocalSourceFile
  });
  if (!developRecords.ok) {
    return developRecords;
  }

  const records = [...defaultRecords.value, ...developRecords.value];

  if (records.length === 0) {
    return err(
      createError({
        code: "PIPFILE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Pipfile.lock. Ohrisk expected default or develop package entries.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const rootName = options.rootName ?? (path.basename(path.dirname(lockfilePath)) || "<pipfile-project>");
  const deduplicatedRecords = deduplicatePipfileLockRecords(records)
    .sort((left, right) => left.id.localeCompare(right.id));
  const embeddedEvidence = deduplicatedRecords
    .map((record) => record.evidence)
    .filter((evidence): evidence is NonNullable<PipfileLockRecord["evidence"]> => evidence !== undefined);

  return ok({
    rootName,
    lockfilePath,
    nodes: deduplicatedRecords
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "pypi",
        dependencyType: record.dependencyType,
        direct: true,
        paths: [[rootName, record.id]]
      })),
    ...(embeddedEvidence.length > 0
      ? { embeddedEvidence: embeddedEvidence.sort((left, right) => left.packageId.localeCompare(right.packageId)) }
      : {})
  });
}

function parsePipfileLockJson(
  input: string,
  lockfilePath: string
): Result<Record<string, unknown>, OhriskError> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (isRecord(parsed)) {
      return ok(parsed);
    }
  } catch (cause) {
    return err(
      createError({
        code: "PIPFILE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Pipfile.lock.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  return err(
    createError({
      code: "PIPFILE_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Pipfile.lock. Ohrisk expected a JSON object.",
      details: {
        lockfilePath
      }
    })
  );
}

function readPipfileLockSection(input: {
  lockfilePath: string;
  sectionName: "default" | "develop";
  value: unknown;
  dependencyType: DependencyType;
  readLocalSourceFile?: PythonLocalSourceFileReader;
}): Result<PipfileLockRecord[], OhriskError> {
  if (input.value === undefined) {
    return ok([]);
  }

  if (!isRecord(input.value)) {
    return pipfileLockSectionError(input);
  }

  const records: PipfileLockRecord[] = [];
  for (const [rawName, rawEntry] of Object.entries(input.value)) {
    if (!isRecord(rawEntry)) {
      return pipfileLockEntryError({
        ...input,
        packageName: rawName
      });
    }

    const localSourcePath = readPipfileLockLocalSourcePath(rawEntry);
    if (localSourcePath) {
      const record = readPipfileLockLocalSourceRecord({
        lockfilePath: input.lockfilePath,
        sectionName: input.sectionName,
        packageName: rawName,
        sourcePath: localSourcePath,
        dependencyType: input.dependencyType,
        readLocalSourceFile: input.readLocalSourceFile
      });
      if (!record.ok) {
        return record;
      }

      records.push(record.value);
      continue;
    }

    const version = readExactPipfileLockVersion(rawEntry.version);
    if (!version) {
      return pipfileLockEntryError({
        ...input,
        packageName: rawName
      });
    }

    records.push({
      name: rawName,
      version,
      id: `${rawName}@${version}`,
      dependencyType: input.dependencyType
    });
  }

  return ok(records);
}

function readPipfileLockLocalSourcePath(entry: Record<string, unknown>): string | undefined {
  const rawPath = entry.path;
  if (typeof rawPath !== "string") {
    return undefined;
  }

  return normalizePythonLocalSourcePathSpec(rawPath);
}

function readPipfileLockLocalSourceRecord(input: {
  lockfilePath: string;
  sectionName: string;
  packageName: string;
  sourcePath: string;
  dependencyType: DependencyType;
  readLocalSourceFile?: PythonLocalSourceFileReader;
}): Result<PipfileLockRecord, OhriskError> {
  const localSource = readPythonLocalSourcePackage({
    source: {
      sourcePath: input.sourcePath,
      expectedName: input.packageName
    },
    fromFilePath: input.lockfilePath,
    readLocalSourceFile: input.readLocalSourceFile,
    errors: PIPFILE_LOCK_LOCAL_SOURCE_ERRORS
  });
  if (!localSource.ok) {
    return localSource;
  }

  return ok({
    name: localSource.value.name,
    version: localSource.value.version,
    id: localSource.value.id,
    dependencyType: input.dependencyType,
    evidence: localSource.value.evidence
  });
}

function readExactPipfileLockVersion(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = /^==\s*([^\s*]+)$/.exec(value.trim());
  return match?.[1];
}

function deduplicatePipfileLockRecords(records: PipfileLockRecord[]): PipfileLockRecord[] {
  const seen = new Map<string, PipfileLockRecord>();
  for (const record of records) {
    const existing = seen.get(record.id);
    seen.set(record.id, existing
      ? {
          ...existing,
          dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType)
        }
      : record);
  }

  return [...seen.values()];
}

function pipfileLockSectionError(input: {
  lockfilePath: string;
  sectionName: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "PIPFILE_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Pipfile.lock. Ohrisk expected default and develop sections to be objects.",
      details: {
        lockfilePath: input.lockfilePath,
        sectionName: input.sectionName
      }
    })
  );
}

function pipfileLockEntryError(input: {
  lockfilePath: string;
  sectionName: string;
  packageName: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "PIPFILE_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Pipfile.lock package entry. Ohrisk v0 requires package entries with exact ==version pins.",
      details: {
        lockfilePath: input.lockfilePath,
        sectionName: input.sectionName,
        packageName: input.packageName
      }
    })
  );
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  return dependencyTypeRank(left) >= dependencyTypeRank(right) ? left : right;
}

function dependencyTypeRank(type: DependencyType): number {
  switch (type) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
