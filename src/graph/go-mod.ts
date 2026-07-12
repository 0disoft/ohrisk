import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError, type OhriskErrorCode } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

export type GoModuleRecord = {
  modulePath: string;
  version: string;
  dependencyType: DependencyType;
  direct: boolean;
  replacement?: GoReplacementTarget;
};

export type GoReplacementTarget =
  | {
      kind: "module";
      modulePath: string;
      version: string;
    }
  | {
      kind: "local";
      path: string;
    };

export type GoReplaceDirective = {
  oldModulePath: string;
  oldVersion?: string;
  target: GoReplacementTarget;
};

export type GoModParseOptions = {
  goSumText?: string;
  replacementOverrideGroups?: GoReplaceDirective[][];
  localReplacementBaseDir?: string;
  localReplacementRootDir?: string;
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

  return parseGoModText(goModText.value, goModPath, omitUndefined({
    goSumText: goSum.value
  }));
}

export function parseGoModText(
  input: string,
  goModPath = "go.mod",
  options: GoModParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const goMod = parseGoModRecords(input, goModPath);
    if (!goMod.ok) {
      return goMod;
    }

    const localReplacements = normalizeGoReplacementDirectives(
      goMod.value.replacements,
      options.localReplacementBaseDir,
      options.localReplacementRootDir
    );
    const replacementOverrideGroups = options.replacementOverrideGroups ?? [];

    const records = new Map<string, GoModuleRecord>();
    for (const record of goMod.value.records.map((record) =>
      applyGoReplacement(record, localReplacements, replacementOverrideGroups)
    )) {
      records.set(goRecordId(record), record);
    }

    const replacementTargetIds = new Set(
      [...records.values()]
        .flatMap((record) =>
          record.replacement?.kind === "module"
            ? [`${record.replacement.modulePath}@${record.replacement.version}`]
            : []
        )
    );

    if (options.goSumText) {
      for (const goSumRecord of parseGoSumRecords(options.goSumText)) {
        if (replacementTargetIds.has(goRecordId(goSumRecord))) {
          continue;
        }

        const record = applyGoReplacement(goSumRecord, localReplacements, replacementOverrideGroups);
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
            ...(record.replacement ? { resolved: goReplacementResolvedSpecifier(record.replacement) } : {}),
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

export function parseGoModRecords(
  input: string,
  goModPath: string
): Result<{
  modulePath?: string;
  records: GoModuleRecord[];
  replacements: GoReplaceDirective[];
}, OhriskError> {
  const records: GoModuleRecord[] = [];
  const replacements: GoReplaceDirective[] = [];
  let modulePath: string | undefined;
  let block: "require" | "replace" | undefined;

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = stripGoLineComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (block) {
      if (line === ")") {
        block = undefined;
        continue;
      }

      if (block === "replace") {
        const replacement = parseGoReplaceDirectiveLine({
          line,
          sourcePath: goModPath,
          lineNumber: index + 1,
          errorCode: "GO_MOD_PARSE_FAILED",
          errorMessage: "Failed to parse go.mod replace directive."
        });
        if (!replacement.ok) {
          return replacement;
        }
        if (replacement.value) {
          replacements.push(replacement.value);
        }
        continue;
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
      const replacement = parseGoReplaceDirectiveLine({
        line: line.slice("replace ".length).trim(),
        sourcePath: goModPath,
        lineNumber: index + 1,
        errorCode: "GO_MOD_PARSE_FAILED",
        errorMessage: "Failed to parse go.mod replace directive."
      });
      if (!replacement.ok) {
        return replacement;
      }
      if (replacement.value) {
        replacements.push(replacement.value);
      }
    }
  }

  return ok({
    ...(modulePath !== undefined ? { modulePath } : {}),
    records,
    replacements
  });
}

function parseRequireLine(line: string, rawLine: string): GoModuleRecord | undefined {
  const parts = splitGoDirectiveFields(line);
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

export function parseGoReplaceDirectiveLine(input: {
  line: string;
  sourcePath: string;
  lineNumber: number;
  errorCode: OhriskErrorCode;
  errorMessage: string;
}
): Result<GoReplaceDirective | undefined, OhriskError> {
  const parts = splitGoDirectiveFields(input.line);
  if (parts.length === 0) {
    return ok(undefined);
  }

  const arrowIndex = parts.indexOf("=>");
  if (arrowIndex === -1) {
    return replaceDirectiveError({
      sourcePath: input.sourcePath,
      line: input.lineNumber,
      entry: input.line,
      code: input.errorCode,
      message: input.errorMessage,
      reason: "missing_arrow"
    });
  }

  const left = parts.slice(0, arrowIndex);
  const right = parts.slice(arrowIndex + 1);
  if (left.length !== 1 && left.length !== 2) {
    return replaceDirectiveError({
      sourcePath: input.sourcePath,
      line: input.lineNumber,
      entry: input.line,
      code: input.errorCode,
      message: input.errorMessage,
      reason: "invalid_left_side"
    });
  }

  const oldModulePath = left[0];
  const oldVersion = left[1];
  if (!oldModulePath) {
    return replaceDirectiveError({
      sourcePath: input.sourcePath,
      line: input.lineNumber,
      entry: input.line,
      code: input.errorCode,
      message: input.errorMessage,
      reason: "missing_old_module_path"
    });
  }

  if (right.length === 1) {
    const localPath = right[0];
    if (!localPath || !isGoLocalReplacementPath(localPath)) {
      return replaceDirectiveError({
        sourcePath: input.sourcePath,
        line: input.lineNumber,
        entry: input.line,
        code: input.errorCode,
        message: input.errorMessage,
        reason: "replacement_without_version_must_be_local_path"
      });
    }

    return ok({
      oldModulePath,
      ...(oldVersion ? { oldVersion } : {}),
      target: {
        kind: "local",
        path: localPath
      }
    });
  }

  if (right.length === 2) {
    const [modulePath, version] = right;
    if (!modulePath || !version) {
      return replaceDirectiveError({
        sourcePath: input.sourcePath,
        line: input.lineNumber,
        entry: input.line,
        code: input.errorCode,
        message: input.errorMessage,
        reason: "invalid_module_replacement"
      });
    }

    return ok({
      oldModulePath,
      ...(oldVersion ? { oldVersion } : {}),
      target: {
        kind: "module",
        modulePath,
        version
      }
    });
  }

  return replaceDirectiveError({
    sourcePath: input.sourcePath,
    line: input.lineNumber,
    entry: input.line,
    code: input.errorCode,
    message: input.errorMessage,
    reason: "invalid_right_side"
  });
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

function replaceDirectiveError(input: {
  sourcePath: string;
  line: number;
  entry: string;
  code: OhriskErrorCode;
  message: string;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: input.code,
      category: "unsupported_input",
      message: input.message,
      details: {
        lockfilePath: input.sourcePath,
        line: input.line,
        entry: input.entry,
        reason: input.reason
      }
    })
  );
}

function applyGoReplacement(
  record: GoModuleRecord,
  localReplacements: GoReplaceDirective[],
  replacementOverrideGroups: GoReplaceDirective[][]
): GoModuleRecord {
  const replacement = findGoReplacement(record, localReplacements, replacementOverrideGroups);
  return replacement
    ? {
        ...record,
        replacement: replacement.target
      }
    : record;
}

function findGoReplacement(
  record: GoModuleRecord,
  localReplacements: GoReplaceDirective[],
  replacementOverrideGroups: GoReplaceDirective[][]
): GoReplaceDirective | undefined {
  for (const replacements of replacementOverrideGroups) {
    const override = findGoReplacementInGroup(record, replacements);
    if (override) {
      return override;
    }
  }

  return findGoReplacementInGroup(record, localReplacements);
}

function findGoReplacementInGroup(
  record: GoModuleRecord,
  replacements: GoReplaceDirective[]
): GoReplaceDirective | undefined {
  const exact = replacements.find((replacement) =>
    replacement.oldModulePath === record.modulePath && replacement.oldVersion === record.version
  );
  if (exact) {
    return exact;
  }

  return replacements.find((replacement) =>
    replacement.oldModulePath === record.modulePath && replacement.oldVersion === undefined
  );
}

export function normalizeGoReplacementDirectives(
  replacements: GoReplaceDirective[],
  baseDir?: string,
  rootDir?: string
): GoReplaceDirective[] {
  if (!baseDir || !rootDir) {
    return replacements;
  }

  return replacements.map((replacement) => ({
    ...replacement,
    target: normalizeGoReplacementTarget(replacement.target, baseDir, rootDir)
  }));
}

function normalizeGoReplacementTarget(
  target: GoReplacementTarget,
  baseDir: string,
  rootDir: string
): GoReplacementTarget {
  if (target.kind !== "local") {
    return target;
  }

  const absolutePath = path.resolve(baseDir, target.path);
  const relativePath = path.relative(rootDir, absolutePath);
  if (
    relativePath === ""
    || (
      relativePath !== ".."
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
    )
  ) {
    const normalized = relativePath === "" ? "." : relativePath.replace(/\\/g, "/");
    return {
      kind: "local",
      path: normalized === "." || normalized.startsWith(".") ? normalized : `./${normalized}`
    };
  }

  return {
    kind: "local",
    path: absolutePath
  };
}

export function goReplacementResolvedSpecifier(replacement: GoReplacementTarget): string {
  return replacement.kind === "module"
    ? `go-module:${replacement.modulePath}@${replacement.version}`
    : replacement.path;
}

export function stripGoLineComment(line: string): string {
  let quote: "\"" | "`" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (quote === "\"") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === "\"") {
        quote = undefined;
      }
      continue;
    }

    if (quote === "`") {
      if (char === "`") {
        quote = undefined;
      }
      continue;
    }

    if (char === "\"" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "/" && next === "/") {
      return line.slice(0, index);
    }
  }

  return line;
}

export function splitGoDirectiveFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quote: "\"" | "`" | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";

    if (quote === "\"") {
      if (char === "\\") {
        index += 1;
        current += line[index] ?? "";
        continue;
      }
      if (char === "\"") {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }

    if (quote === "`") {
      if (char === "`") {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "\"" || char === "`") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== "") {
        fields.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current !== "") {
    fields.push(current);
  }

  return fields;
}

function isGoLocalReplacementPath(value: string): boolean {
  return value.startsWith("./")
    || value.startsWith("../")
    || value === "."
    || value === ".."
    || path.isAbsolute(value);
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
