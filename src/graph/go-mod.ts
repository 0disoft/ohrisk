import { omitUndefined } from "../shared/object";
import { existsSync, readdirSync } from "node:fs";
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

const GO_SOURCE_FILE_MAX_BYTES = 1024 * 1024;
const GO_SOURCE_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
const GO_SOURCE_FILE_LIMIT = 50_000;
const GO_SOURCE_DIRECTORY_DEPTH_LIMIT = 64;
const GO_SOURCE_IGNORED_DIRECTORIES = new Set([".git", "node_modules", "vendor"]);

export type GoModuleRecord = {
  modulePath: string;
  version: string;
  checksum?: string;
  goModChecksum?: string;
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
  sourceFiles?: GoSourceFile[];
  replacementOverrideGroups?: GoReplaceDirective[][];
  localReplacementBaseDir?: string;
  localReplacementRootDir?: string;
};

export type GoSourceFile = {
  path: string;
  text: string;
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
    goSumText: goSum.value,
    sourceFiles: readBoundedGoSourceFiles(goModPath)
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

    const goSumRecords = options.goSumText ? parseGoSumRecords(options.goSumText) : [];
    const goSumById = new Map(goSumRecords.map((record) => [goRecordId(record), record]));
    const sourceDependencyTypes = goSourceDependencyTypes(
      options.sourceFiles ?? [],
      goMod.value.records.map((record) => record.modulePath),
      goMod.value.toolPaths
    );
    const records = new Map<string, GoModuleRecord>();
    for (const originalRecord of goMod.value.records) {
      const record = withGoModuleChecksum(
        applyGoReplacement({
          ...originalRecord,
          dependencyType: sourceDependencyTypes.get(originalRecord.modulePath)
            ?? originalRecord.dependencyType
        }, localReplacements, replacementOverrideGroups),
        goSumById
      );
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

    if (options.goSumText && shouldIncludeGoSumOnlyModules(goMod.value.goVersion)) {
      for (const goSumRecord of goSumRecords) {
        if (replacementTargetIds.has(goRecordId(goSumRecord))) {
          continue;
        }

        const record = withGoModuleChecksum(
          applyGoReplacement(goSumRecord, localReplacements, replacementOverrideGroups),
          goSumById
        );
        const id = goRecordId(record);
        const existing = records.get(id);
        records.set(id, existing
          ? {
              ...existing,
              direct: existing.direct || record.direct,
              dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
              ...(existing.checksum ? {} : record.checksum ? { checksum: record.checksum } : {}),
              ...(existing.goModChecksum
                ? {}
                : record.goModChecksum
                  ? { goModChecksum: record.goModChecksum }
                  : {})
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
            ...(record.checksum ? { integrity: record.checksum } : {}),
            ...(record.goModChecksum ? { goModIntegrity: record.goModChecksum } : {}),
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

export function readBoundedGoSourceFiles(goModPath: string): GoSourceFile[] {
  const rootDir = path.dirname(goModPath);
  const sourceFiles: GoSourceFile[] = [];
  const pending = [{ directory: rootDir, relativeDirectory: "", depth: 0 }];
  let totalBytes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > GO_SOURCE_DIRECTORY_DEPTH_LIMIT) {
      return [];
    }
    let entries;
    try {
      entries = readdirSync(current.directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const relativePath = current.relativeDirectory
        ? `${current.relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (GO_SOURCE_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        if (existsSync(path.join(absolutePath, "go.mod"))) {
          continue;
        }
        pending.push({
          directory: absolutePath,
          relativeDirectory: relativePath,
          depth: current.depth + 1
        });
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".go")) {
        continue;
      }
      if (sourceFiles.length >= GO_SOURCE_FILE_LIMIT) {
        return [];
      }
      const source = readInputTextFile({
        filePath: absolutePath,
        maxBytes: GO_SOURCE_FILE_MAX_BYTES
      });
      if (!source.ok) {
        return [];
      }
      totalBytes += Buffer.byteLength(source.value, "utf8");
      if (totalBytes > GO_SOURCE_TOTAL_MAX_BYTES) {
        return [];
      }
      sourceFiles.push({ path: relativePath, text: source.value });
    }
  }

  return sourceFiles;
}

export function parseGoModRecords(
  input: string,
  goModPath: string,
  options: { strictEdges?: boolean } = {}
): Result<{
  modulePath?: string;
  goVersion?: string;
  records: GoModuleRecord[];
  replacements: GoReplaceDirective[];
  toolPaths: string[];
}, OhriskError> {
  const records: GoModuleRecord[] = [];
  const replacements: GoReplaceDirective[] = [];
  const toolPaths: string[] = [];
  let modulePath: string | undefined;
  let goVersion: string | undefined;
  let block: "require" | "replace" | "tool" | undefined;

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

      if (block === "tool") {
        const toolFields = splitGoDirectiveFields(line);
        const toolPath = toolFields[0];
        if (options.strictEdges && toolFields.length !== 1) {
          return err({
            code: "GO_MOD_PARSE_FAILED",
            category: "invalid_input",
            message: "Failed to parse go.mod tool directive.",
            details: { goModPath, lineNumber: index + 1 }
          });
        }
        if (toolPath) {
          toolPaths.push(toolPath);
        }
        continue;
      }

      const record = options.strictEdges && splitGoDirectiveFields(line).length !== 2
        ? undefined
        : parseRequireLine(line, rawLine);
      if (record) {
        records.push(record);
      } else if (options.strictEdges) {
        return err({
          code: "GO_MOD_PARSE_FAILED",
          category: "invalid_input",
          message: "Failed to parse go.mod require directive.",
          details: { goModPath, lineNumber: index + 1 }
        });
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

    if (line === "tool (") {
      block = "tool";
      continue;
    }

    if (line.startsWith("module ")) {
      modulePath = line.slice("module ".length).trim();
      continue;
    }

    if (line.startsWith("go ")) {
      goVersion = line.slice("go ".length).trim();
      continue;
    }

    if (line.startsWith("require ")) {
      const requireLine = line.slice("require ".length).trim();
      const record = options.strictEdges && splitGoDirectiveFields(requireLine).length !== 2
        ? undefined
        : parseRequireLine(requireLine, rawLine);
      if (record) {
        records.push(record);
      } else if (options.strictEdges) {
        return err({
          code: "GO_MOD_PARSE_FAILED",
          category: "invalid_input",
          message: "Failed to parse go.mod require directive.",
          details: { goModPath, lineNumber: index + 1 }
        });
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
      continue;
    }

    if (line.startsWith("tool ")) {
      const toolFields = splitGoDirectiveFields(line.slice("tool ".length).trim());
      const toolPath = toolFields[0];
      if (options.strictEdges && toolFields.length !== 1) {
        return err({
          code: "GO_MOD_PARSE_FAILED",
          category: "invalid_input",
          message: "Failed to parse go.mod tool directive.",
          details: { goModPath, lineNumber: index + 1 }
        });
      }
      if (toolPath) {
        toolPaths.push(toolPath);
      }
    }
  }

  if (options.strictEdges && block !== undefined) {
    return err({
      code: "GO_MOD_PARSE_FAILED",
      category: "invalid_input",
      message: "Failed to parse unterminated go.mod directive block.",
      details: { goModPath, block }
    });
  }

  return ok({
    ...(modulePath !== undefined ? { modulePath } : {}),
    ...(goVersion !== undefined ? { goVersion } : {}),
    records,
    replacements,
    toolPaths
  });
}

function shouldIncludeGoSumOnlyModules(goVersion: string | undefined): boolean {
  if (!goVersion) {
    return true;
  }
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/u.exec(goVersion);
  if (!match) {
    return true;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 1 || (major === 1 && minor < 17);
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

function goSourceDependencyTypes(
  sourceFiles: GoSourceFile[],
  modulePaths: string[],
  toolPaths: string[]
): Map<string, DependencyType> {
  const dependencyTypes = new Map<string, DependencyType>();
  const sortedModulePaths = [...new Set(modulePaths)]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));

  for (const toolPath of toolPaths) {
    const modulePath = sortedModulePaths.find((candidate) =>
      toolPath === candidate || toolPath.startsWith(`${candidate}/`)
    );
    if (modulePath) {
      dependencyTypes.set(modulePath, "development");
    }
  }

  for (const sourceFile of sourceFiles) {
    const dependencyType = isDevelopmentGoSource(sourceFile) ? "development" : "production";
    for (const importPath of readGoImportPaths(sourceFile.text)) {
      const modulePath = sortedModulePaths.find((candidate) =>
        importPath === candidate || importPath.startsWith(`${candidate}/`)
      );
      if (!modulePath) {
        continue;
      }
      const existing = dependencyTypes.get(modulePath);
      dependencyTypes.set(
        modulePath,
        existing === "production" || dependencyType === "production"
          ? "production"
          : "development"
      );
    }
  }

  return dependencyTypes;
}

function isDevelopmentGoSource(sourceFile: GoSourceFile): boolean {
  if (sourceFile.path.replaceAll("\\", "/").endsWith("_test.go")) {
    return true;
  }
  const buildConstraint = sourceFile.text.match(/^\s*\/\/go:build\s+(.+)$/mu)?.[1]?.trim();
  if (buildConstraint !== undefined) {
    return !canGoBuildConstraintMatchDefaultContext(buildConstraint);
  }
  const legacyConstraints = [...sourceFile.text.matchAll(/^\s*\/\/\s*\+build\s+(.+)$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((constraint): constraint is string => Boolean(constraint));
  if (legacyConstraints.length === 0) {
    return false;
  }
  const legacyExpression = legacyConstraints.map((constraint) => {
    const options = constraint.split(/\s+/u).filter(Boolean).map((option) =>
      `(${option.split(",").filter(Boolean).join(" && ")})`
    );
    return `(${options.join(" || ")})`;
  }).join(" && ");
  return !canGoBuildConstraintMatchDefaultContext(legacyExpression);
}

function canGoBuildConstraintMatchDefaultContext(expression: string): boolean {
  const identifiers = expression.match(/[A-Za-z0-9_.]+/gu) ?? [];
  const standardIdentifiers = new Set([
    "aix", "android", "darwin", "dragonfly", "freebsd", "illumos", "ios", "js", "linux",
    "netbsd", "openbsd", "plan9", "solaris", "wasip1", "windows", "386", "amd64", "arm",
    "arm64", "loong64", "mips", "mips64", "mips64le", "mipsle", "ppc64", "ppc64le",
    "riscv64", "s390x", "wasm", "cgo", "gc", "gccgo", "unix"
  ]);
  for (const identifier of identifiers) {
    if (identifier.startsWith("go1.")) {
      standardIdentifiers.add(identifier);
    }
  }
  const customIdentifiers = new Set(identifiers.filter((identifier) =>
    !standardIdentifiers.has(identifier)
  ));
  if (customIdentifiers.size === 0) {
    return true;
  }
  const variables = [...new Set(identifiers.filter((identifier) =>
    standardIdentifiers.has(identifier)
  ))];
  if (variables.length > 12) {
    return true;
  }

  const assignments = 2 ** variables.length;
  for (let mask = 0; mask < assignments; mask += 1) {
    const values = new Map(variables.map((identifier, index) => [
      identifier,
      (mask & (2 ** index)) !== 0
    ]));
    const assignedExpression = expression.replace(/[A-Za-z0-9_.]+/gu, (identifier) =>
      customIdentifiers.has(identifier) ? "false" : String(values.get(identifier) ?? false)
    );
    if (evaluateConservativeGoBuildExpression(assignedExpression)) {
      return true;
    }
  }
  return false;
}

function evaluateConservativeGoBuildExpression(expression: string): boolean {
  const tokens = expression.match(/&&|\|\||!|\(|\)|true|false/gu);
  if (!tokens || tokens.join("") !== expression.replaceAll(/\s+/gu, "")) {
    return true;
  }
  let index = 0;
  const parsePrimary = (): boolean => {
    const token = tokens[index];
    index += 1;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "!") return !parsePrimary();
    if (token === "(") {
      const value = parseOr();
      if (tokens[index] !== ")") throw new Error("invalid build constraint");
      index += 1;
      return value;
    }
    throw new Error("invalid build constraint");
  };
  const parseAnd = (): boolean => {
    let value = parsePrimary();
    while (tokens[index] === "&&") {
      index += 1;
      const right = parsePrimary();
      value = value && right;
    }
    return value;
  };
  const parseOr = (): boolean => {
    let value = parseAnd();
    while (tokens[index] === "||") {
      index += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };

  try {
    const value = parseOr();
    return index === tokens.length ? value : true;
  } catch {
    return true;
  }
}

function readGoImportPaths(input: string): string[] {
  const paths: string[] = [];
  const importPattern = /(?:^|\n)\s*import\s+(?:\(([^)]*)\)|(?:[._A-Za-z][._A-Za-z0-9]*\s+)?(["`][^"`\r\n]+["`]))/gu;
  for (const match of input.matchAll(importPattern)) {
    const values = match[1]?.match(/["`][^"`\r\n]+["`]/gu)
      ?? (match[2] ? [match[2]] : []);
    for (const value of values) {
      const importPath = value.slice(1, -1);
      if (importPath !== "" && !importPath.includes("\\")) {
        paths.push(importPath);
      }
    }
  }
  return paths;
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

    const [modulePath, rawVersion, rawChecksum] = line.split(/\s+/, 3);
    if (!modulePath || !rawVersion) {
      continue;
    }

    const version = rawVersion.endsWith("/go.mod")
      ? rawVersion.slice(0, -"/go.mod".length)
      : rawVersion;
    const isGoModChecksum = rawVersion.endsWith("/go.mod");
    const normalizedChecksum = normalizeGoChecksum(rawChecksum);
    const record: GoModuleRecord = {
      modulePath,
      version,
      ...(normalizedChecksum
        ? isGoModChecksum
          ? { goModChecksum: normalizedChecksum }
          : { checksum: normalizedChecksum }
        : {}),
      dependencyType: "production" as const,
      direct: false
    };
    const id = goRecordId(record);
    const existing = records.get(id);
    records.set(id, {
      ...existing,
      ...record,
      ...(existing?.checksum && !record.checksum ? { checksum: existing.checksum } : {}),
      ...(existing?.goModChecksum && !record.goModChecksum
        ? { goModChecksum: existing.goModChecksum }
        : {})
    });
  }

  return [...records.values()];
}

function normalizeGoChecksum(value: string | undefined): string | undefined {
  return value && /^h1:[A-Za-z0-9+/]{43}=$/u.test(value) ? value : undefined;
}

function withGoModuleChecksum(
  record: GoModuleRecord,
  goSumById: ReadonlyMap<string, GoModuleRecord>
): GoModuleRecord {
  if (record.replacement?.kind === "local") {
    const { checksum: _, goModChecksum: __, ...withoutChecksum } = record;
    return withoutChecksum;
  }

  const evidenceId = record.replacement?.kind === "module"
    ? `${record.replacement.modulePath}@${record.replacement.version}`
    : goRecordId(record);
  const checksumRecord = goSumById.get(evidenceId);
  return {
    ...record,
    ...(checksumRecord?.checksum ? { checksum: checksumRecord.checksum } : {}),
    ...(checksumRecord?.goModChecksum ? { goModChecksum: checksumRecord.goModChecksum } : {})
  };
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
