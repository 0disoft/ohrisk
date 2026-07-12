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

type BazelModuleDependencyRecord = {
  name: string;
  version: string;
  repoName?: string;
  dependencyType: DependencyNode["dependencyType"];
  id: string;
  line: number;
};

type StarlarkCall = {
  name: string;
  argsText: string;
  line: number;
};

type StarlarkValue =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "none" };

const UNSUPPORTED_BAZEL_GRAPH_CONSTRUCTS = new Set([
  "archive_override",
  "git_override",
  "include",
  "inject_repo",
  "local_path_override",
  "multiple_version_override",
  "override_repo",
  "single_version_override",
  "use_extension",
  "use_repo",
  "use_repo_rule"
]);

export function parseBazelModuleFile(
  modulePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const moduleText = readInputTextFile({
    filePath: modulePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!moduleText.ok) {
    return err(
      createError({
        code: "BAZEL_MODULE_READ_FAILED",
        category: inputFileReadErrorCategory(moduleText.error),
        message: moduleText.error.kind === "too_large"
          ? "MODULE.bazel exceeded the maximum supported size."
          : "Failed to read MODULE.bazel.",
        details: {
          lockfilePath: modulePath,
          ...inputFileReadErrorDetails(moduleText.error)
        }
      })
    );
  }

  return parseBazelModuleText(moduleText.value, modulePath);
}

export function parseBazelModuleText(
  input: string,
  modulePath = "MODULE.bazel"
): Result<DependencyGraph, OhriskError> {
  const calls = readStarlarkCalls(input);
  const rootName = readRootModuleName(calls) ?? bazelModuleRootName(modulePath);
  const records: BazelModuleDependencyRecord[] = [];
  const unsupportedGraphConstruct = calls.find((call) => UNSUPPORTED_BAZEL_GRAPH_CONSTRUCTS.has(call.name));

  if (unsupportedGraphConstruct) {
    return bazelModuleParseError({
      lockfilePath: modulePath,
      line: unsupportedGraphConstruct.line,
      reason: "unsupported_bazel_module_graph_construct",
      construct: unsupportedGraphConstruct.name
    });
  }

  for (const call of calls) {
    if (call.name !== "bazel_dep") {
      continue;
    }

    const record = readBazelDependencyRecord(call, modulePath);
    if (!record.ok) {
      return record;
    }

    records.push(record.value);
  }

  if (records.length === 0) {
    return err(
      createError({
        code: "BAZEL_MODULE_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse MODULE.bazel. Ohrisk expected at least one bazel_dep call with an exact version.",
        details: {
          lockfilePath: modulePath
        }
      })
    );
  }

  const nodes = new Map<string, DependencyNode>();
  for (const record of records) {
    const pathItems = [rootName, record.id];
    const existing = nodes.get(record.id);

    if (existing) {
      existing.paths.push(pathItems);
      if (record.repoName) {
        existing.installNames = [...new Set([...(existing.installNames ?? []), record.repoName])].sort();
      }
      continue;
    }

    nodes.set(record.id, {
      id: record.id,
      name: record.name,
      ...(record.repoName ? { installNames: [record.repoName] } : {}),
      version: record.version,
      ecosystem: "bazel",
      dependencyType: record.dependencyType,
      direct: true,
      paths: [pathItems]
    });
  }

  return ok({
    rootName,
    lockfilePath: modulePath,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readRootModuleName(calls: StarlarkCall[]): string | undefined {
  const moduleCall = calls.find((call) => call.name === "module");
  if (!moduleCall) {
    return undefined;
  }

  const args = readKeywordArguments(moduleCall.argsText);
  const name = args.get("name");
  return name?.kind === "string" && name.value.trim() !== ""
    ? name.value.trim()
    : undefined;
}

function readBazelDependencyRecord(
  call: StarlarkCall,
  modulePath: string
): Result<BazelModuleDependencyRecord, OhriskError> {
  const args = readKeywordArguments(call.argsText);
  const positional = readPositionalArguments(call.argsText);
  const name = readStringArgument(args.get("name")) ?? readStringArgument(positional[0]);
  const version = readStringArgument(args.get("version")) ?? readStringArgument(positional[1]);
  const repoNameValue = args.get("repo_name");
  const repoName = readStringArgument(repoNameValue);
  const devDependency = readBooleanArgument(args.get("dev_dependency")) ?? false;

  if (repoNameValue?.kind === "none") {
    return bazelModuleParseError({
      lockfilePath: modulePath,
      line: call.line,
      reason: "nodep_repo_name_not_supported"
    });
  }

  if (!name || !version) {
    return bazelModuleParseError({
      lockfilePath: modulePath,
      line: call.line,
      reason: "bazel_dep_missing_name_or_exact_version"
    });
  }

  if (!isSupportedBazelModuleName(name)) {
    return bazelModuleParseError({
      lockfilePath: modulePath,
      line: call.line,
      reason: "invalid_module_name",
      moduleName: name
    });
  }

  return ok({
    name,
    version,
    ...(repoName && repoName !== name ? { repoName } : {}),
    dependencyType: devDependency ? "development" : "production",
    id: `${name}@${version}`,
    line: call.line
  });
}

function readStarlarkCalls(input: string): StarlarkCall[] {
  const calls: StarlarkCall[] = [];
  let quote: "\"" | "'" | undefined;
  let tripleQuote = false;
  let escaped = false;
  let line = 1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) {
      break;
    }

    if (char === "\n") {
      line += 1;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\" && quote === "\"" && !tripleQuote) {
        escaped = true;
        continue;
      }

      if (tripleQuote && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = undefined;
        tripleQuote = false;
        continue;
      }

      if (!tripleQuote && char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "#") {
      const newlineIndex = input.indexOf("\n", index + 1);
      if (newlineIndex === -1) {
        break;
      }
      index = newlineIndex - 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      tripleQuote = input.startsWith(char.repeat(3), index);
      if (tripleQuote) {
        index += 2;
      }
      continue;
    }

    if (!isIdentifierStart(char)) {
      continue;
    }

    const identifierStart = index;
    let identifierEnd = index + 1;
    while (identifierEnd < input.length && isIdentifierPart(input[identifierEnd] as string)) {
      identifierEnd += 1;
    }

    const name = input.slice(identifierStart, identifierEnd);
    const openParenIndex = skipWhitespace(input, identifierEnd);
    if (input[openParenIndex] !== "(") {
      index = identifierEnd - 1;
      continue;
    }

    const closed = readParenthesizedBody(input, openParenIndex);
    if (!closed) {
      index = identifierEnd - 1;
      continue;
    }

    calls.push({
      name,
      argsText: closed.body,
      line
    });
    line += countNewlines(input.slice(openParenIndex, closed.endIndex + 1));
    index = closed.endIndex;
  }

  return calls;
}

function readParenthesizedBody(input: string, openParenIndex: number): {
  body: string;
  endIndex: number;
} | undefined {
  let quote: "\"" | "'" | undefined;
  let tripleQuote = false;
  let escaped = false;
  let depth = 0;

  for (let index = openParenIndex; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\" && quote === "\"" && !tripleQuote) {
        escaped = true;
        continue;
      }

      if (tripleQuote && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = undefined;
        tripleQuote = false;
        continue;
      }

      if (!tripleQuote && char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "#") {
      const newlineIndex = input.indexOf("\n", index + 1);
      if (newlineIndex === -1) {
        break;
      }
      index = newlineIndex - 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      tripleQuote = input.startsWith(char.repeat(3), index);
      if (tripleQuote) {
        index += 2;
      }
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0 && char === ")") {
        return {
          body: input.slice(openParenIndex + 1, index),
          endIndex: index
        };
      }
    }
  }

  return undefined;
}

function readKeywordArguments(input: string): Map<string, StarlarkValue> {
  const args = new Map<string, StarlarkValue>();
  for (const part of splitTopLevel(input, ",")) {
    const separatorIndex = findTopLevelEquals(part);
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = readStarlarkValue(part.slice(separatorIndex + 1).trim());
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value) {
      args.set(key, value);
    }
  }

  return args;
}

function readPositionalArguments(input: string): Array<StarlarkValue | undefined> {
  const args: Array<StarlarkValue | undefined> = [];
  for (const part of splitTopLevel(input, ",")) {
    if (findTopLevelEquals(part) >= 0) {
      continue;
    }

    args.push(readStarlarkValue(part.trim()));
  }

  return args;
}

function readStarlarkValue(input: string): StarlarkValue | undefined {
  const stringValue = readStarlarkString(input);
  if (stringValue !== undefined) {
    return { kind: "string", value: stringValue };
  }

  if (input === "True") {
    return { kind: "bool", value: true };
  }

  if (input === "False") {
    return { kind: "bool", value: false };
  }

  if (input === "None") {
    return { kind: "none" };
  }

  return undefined;
}

function readStarlarkString(input: string): string | undefined {
  const trimmed = input.trim();
  const quote = trimmed[0];
  if (quote !== "\"" && quote !== "'") {
    return undefined;
  }

  if (trimmed.startsWith(quote.repeat(3)) && trimmed.endsWith(quote.repeat(3))) {
    const body = trimmed.slice(3, -3);
    return quote === "\"" ? unescapeStarlarkString(body) : body;
  }

  if (trimmed[trimmed.length - 1] !== quote) {
    return undefined;
  }

  const body = trimmed.slice(1, -1);
  return quote === "\"" ? unescapeStarlarkString(body) : body;
}

function readStringArgument(value: StarlarkValue | undefined): string | undefined {
  return value?.kind === "string" && value.value.trim() !== "" ? value.value.trim() : undefined;
}

function readBooleanArgument(value: StarlarkValue | undefined): boolean | undefined {
  return value?.kind === "bool" ? value.value : undefined;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: "\"" | "'" | undefined;
  let tripleQuote = false;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\" && quote === "\"" && !tripleQuote) {
        escaped = true;
        continue;
      }

      if (tripleQuote && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = undefined;
        tripleQuote = false;
        continue;
      }

      if (!tripleQuote && char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "#") {
      const newlineIndex = input.indexOf("\n", index + 1);
      if (newlineIndex === -1) {
        break;
      }
      index = newlineIndex - 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      tripleQuote = input.startsWith(char.repeat(3), index);
      if (tripleQuote) {
        index += 2;
      }
      continue;
    }

    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;

    if (
      braceDepth === 0
      && bracketDepth === 0
      && parenDepth === 0
      && char === separator
    ) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(input.slice(start));
  return parts.filter((part) => part.trim() !== "");
}

function findTopLevelEquals(input: string): number {
  let quote: "\"" | "'" | undefined;
  let tripleQuote = false;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\" && quote === "\"" && !tripleQuote) {
        escaped = true;
        continue;
      }

      if (tripleQuote && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = undefined;
        tripleQuote = false;
        continue;
      }

      if (!tripleQuote && char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "#") {
      const newlineIndex = input.indexOf("\n", index + 1);
      if (newlineIndex === -1) {
        return -1;
      }
      index = newlineIndex - 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      tripleQuote = input.startsWith(char.repeat(3), index);
      if (tripleQuote) {
        index += 2;
      }
      continue;
    }

    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;

    if (
      braceDepth === 0
      && bracketDepth === 0
      && parenDepth === 0
      && char === "="
    ) {
      return index;
    }
  }

  return -1;
}

function unescapeStarlarkString(value: string): string {
  return value
    .replace(/\\b/g, "\b")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\f/g, "\f")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function skipWhitespace(input: string, index: number): number {
  let current = index;
  while (current < input.length && /\s/.test(input[current] as string)) {
    current += 1;
  }
  return current;
}

function countNewlines(input: string): number {
  return [...input.matchAll(/\n/g)].length;
}

function isIdentifierStart(char: string): boolean {
  return /^[A-Za-z_]$/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
}

function isSupportedBazelModuleName(name: string): boolean {
  return /^[a-z][a-z0-9._-]*[a-z0-9]$/.test(name) || /^[a-z]$/.test(name);
}

function bazelModuleRootName(modulePath: string): string {
  return path.basename(path.dirname(modulePath)) || "<bazel-module>";
}

function bazelModuleParseError(input: {
  lockfilePath: string;
  line: number;
  reason: string;
  moduleName?: string;
  construct?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "BAZEL_MODULE_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse MODULE.bazel dependency entry. Ohrisk supports bazel_dep calls with literal name and exact version strings.",
      details: input
    })
  );
}
