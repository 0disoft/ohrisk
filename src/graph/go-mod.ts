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

type GoModuleRecord = {
  modulePath: string;
  version: string;
  dependencyType: DependencyType;
  direct: boolean;
};

export function parseGoModFile(
  goModPath: string,
  options: { maxBytes?: number; goSumMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const goModText = readInputTextFile({
    filePath: goModPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!goModText.ok) {
    return err(
      createError({
        code: "GO_MOD_READ_FAILED",
        category: inputFileReadErrorCategory(goModText.error),
        message: goModText.error.kind === "too_large"
          ? "go.mod exceeded the maximum supported size."
          : "Failed to read go.mod.",
        details: {
          lockfilePath: goModPath,
          ...inputFileReadErrorDetails(goModText.error)
        }
      })
    );
  }

  const goSum = readOptionalGoSum({
    goModPath,
    maxBytes: options.goSumMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!goSum.ok) {
    return goSum;
  }

  return parseGoModText(goModText.value, goModPath, {
    goSumText: goSum.value
  });
}

export function parseGoModText(
  input: string,
  goModPath = "go.mod",
  options: { goSumText?: string } = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const goMod = parseGoModRecords(input, goModPath);
    if (!goMod.ok) {
      return goMod;
    }

    const records = new Map<string, GoModuleRecord>();
    for (const record of goMod.value.records) {
      records.set(goRecordId(record), record);
    }

    if (options.goSumText) {
      for (const record of parseGoSumRecords(options.goSumText)) {
        const id = goRecordId(record);
        const existing = records.get(id);
        records.set(id, existing
          ? {
              ...existing,
              direct: existing.direct || record.direct,
              dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType)
            }
          : record);
      }
    }

    const rootName = goMod.value.modulePath ?? path.basename(path.dirname(goModPath)) ?? "<go-module>";

    return ok({
      rootName,
      lockfilePath: goModPath,
      nodes: [...records.values()]
        .sort((left, right) => goRecordId(left).localeCompare(goRecordId(right)))
        .map((record): DependencyNode => {
          const id = goRecordId(record);
          return {
            id,
            name: record.modulePath,
            version: record.version,
            ecosystem: "go",
            dependencyType: record.dependencyType,
            direct: record.direct,
            paths: [[rootName, id]]
          };
        })
    });
  } catch (cause) {
    return err(
      createError({
        code: "GO_MOD_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse go.mod.",
        details: {
          lockfilePath: goModPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readOptionalGoSum(input: {
  goModPath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const goSumPath = path.join(path.dirname(input.goModPath), "go.sum");
  if (!existsSync(goSumPath)) {
    return ok(undefined);
  }

  const goSumText = readInputTextFile({
    filePath: goSumPath,
    maxBytes: input.maxBytes
  });
  if (!goSumText.ok) {
    return err(
      createError({
        code: "GO_SUM_READ_FAILED",
        category: inputFileReadErrorCategory(goSumText.error),
        message: goSumText.error.kind === "too_large"
          ? "go.sum exceeded the maximum supported size."
          : "Failed to read go.sum.",
        details: {
          goSumPath,
          ...inputFileReadErrorDetails(goSumText.error)
        }
      })
    );
  }

  return ok(goSumText.value);
}

function parseGoModRecords(
  input: string,
  goModPath: string
): Result<{
  modulePath?: string;
  records: GoModuleRecord[];
}, OhriskError> {
  const records: GoModuleRecord[] = [];
  let modulePath: string | undefined;
  let block: "require" | "replace" | undefined;

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = stripGoComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (block) {
      if (line === ")") {
        block = undefined;
        continue;
      }

      if (block === "replace") {
        return unsupportedReplaceError(goModPath, index + 1, line);
      }

      const record = parseRequireLine(line, rawLine);
      if (record) {
        records.push(record);
      }
      continue;
    }

    if (line === "require (") {
      block = "require";
      continue;
    }

    if (line === "replace (") {
      block = "replace";
      continue;
    }

    if (line.startsWith("module ")) {
      modulePath = line.slice("module ".length).trim();
      continue;
    }

    if (line.startsWith("require ")) {
      const record = parseRequireLine(line.slice("require ".length).trim(), rawLine);
      if (record) {
        records.push(record);
      }
      continue;
    }

    if (line.startsWith("replace ")) {
      return unsupportedReplaceError(goModPath, index + 1, line);
    }
  }

  return ok({
    modulePath,
    records
  });
}

function parseRequireLine(line: string, rawLine: string): GoModuleRecord | undefined {
  const parts = line.split(/\s+/);
  const modulePath = parts[0];
  const version = parts[1];
  if (!modulePath || !version) {
    return undefined;
  }

  const indirect = rawLine.includes("// indirect");

  return {
    modulePath,
    version,
    dependencyType: "production",
    direct: !indirect
  };
}

function parseGoSumRecords(input: string): GoModuleRecord[] {
  const records = new Map<string, GoModuleRecord>();

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }

    const [modulePath, rawVersion] = line.split(/\s+/, 2);
    if (!modulePath || !rawVersion) {
      continue;
    }

    const version = rawVersion.endsWith("/go.mod")
      ? rawVersion.slice(0, -"/go.mod".length)
      : rawVersion;
    const record = {
      modulePath,
      version,
      dependencyType: "production" as const,
      direct: false
    };
    records.set(goRecordId(record), record);
  }

  return [...records.values()];
}

function unsupportedReplaceError(
  goModPath: string,
  line: number,
  entry: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "GO_MOD_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse go.mod. Ohrisk v0 does not resolve Go replace directives.",
      details: {
        lockfilePath: goModPath,
        line,
        entry
      }
    })
  );
}

function stripGoComment(line: string): string {
  const commentIndex = line.indexOf("//");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function goRecordId(record: { modulePath: string; version: string }): string {
  return `${record.modulePath}@${record.version}`;
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
