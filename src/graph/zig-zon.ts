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

type ZigDependency = {
  name: string;
  url?: string;
  hash?: string;
  path?: string;
  lazy?: boolean;
};

type ZonValue =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ident"; value: string }
  | { kind: "struct"; fields: Map<string, ZonValue>; positional: ZonValue[] }
  | { kind: "number"; value: string }
  | { kind: "empty" };

export function parseZigZonFile(
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
        code: "ZIG_ZON_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "build.zig.zon exceeded the maximum supported size."
          : "Failed to read build.zig.zon.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseZigZonText(lockfileText.value, lockfilePath);
}

export function parseZigZonText(
  input: string,
  lockfilePath = "build.zig.zon"
): Result<DependencyGraph, OhriskError> {
  const tokens = tokenizeZon(input);
  if (!tokens.ok) {
    return err(tokens.error);
  }

  const parsed = parseZonValue(tokens.value);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const root = parsed.value;
  if (root.kind !== "struct") {
    return zigZonShapeError({ lockfilePath, reason: "root_not_struct" });
  }

  const rootNameField = root.fields.get("name");
  const rootName = rootNameField?.kind === "ident"
    ? rootNameField.value
    : rootNameField?.kind === "string"
      ? rootNameField.value
      : undefined;

  const dependenciesField = root.fields.get("dependencies");
  const dependencies = dependenciesField?.kind === "struct"
    ? dependenciesField.fields
    : new Map<string, ZonValue>();

  const records: ZigDependency[] = [];
  for (const [depName, depValue] of dependencies) {
    if (depValue.kind !== "struct") {
      continue;
    }

    const url = stringFieldValue(depValue, "url");
    const hash = stringFieldValue(depValue, "hash");
    const depPath = stringFieldValue(depValue, "path");
    const lazy = boolFieldValue(depValue, "lazy");

    if (!url && !depPath) {
      continue;
    }

    records.push({
      name: depName,
      ...(url ? { url } : {}),
      ...(hash ? { hash } : {}),
      ...(depPath ? { path: depPath } : {}),
      ...(lazy !== undefined ? { lazy } : {})
    });
  }

  const rootProjectName = rootName ?? rootProjectNameFromPath(lockfilePath);
  return ok({
    rootName: rootProjectName,
    lockfilePath,
    nodes: records
      .map((record): DependencyNode => {
        const version = zigDepVersion(record);
        return {
          id: `${record.name}@${version}`,
          name: record.name,
          version,
          ecosystem: "zig",
          ...(record.url ? { resolved: record.url } : {}),
          ...(record.hash ? { integrity: record.hash } : {}),
          dependencyType: "production",
          direct: true,
          paths: [[rootProjectName, record.name]]
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function zigDepVersion(record: ZigDependency): string {
  if (record.hash) {
    const parsed = parseZigHash(record.hash);
    if (parsed?.format === "new") {
      return parsed.version || "unknown";
    }
  }

  if (record.url) {
    const commitMatch = /\/(?:archive|tarball|src)\/([0-9a-f]{7,40})(?:\.(?:tar\.gz|tgz|zip))?(?:\?|$)/i
      .exec(record.url);
    if (commitMatch?.[1]) {
      return commitMatch[1];
    }

    const tagMatch = /\/(?:archive|tarball|src)\/(?:refs\/tags\/)?v?([^/?#]+?)(?:\.(?:tar\.gz|tgz|zip))?(?:\?|$)/i
      .exec(record.url);
    if (tagMatch?.[1]) {
      return tagMatch[1];
    }
  }

  return record.path ?? "unknown";
}

type ZigHashParse =
  | { format: "old"; digestHex: string }
  | { format: "new"; name: string; version: string; hashPlus: string }
  | null;

export function parseZigHash(hash: string): ZigHashParse {
  if (ZIG_OLD_HASH_PATTERN.test(hash)) {
    return { format: "old", digestHex: hash.slice(4) };
  }

  const newMatch = ZIG_NEW_HASH_PATTERN.exec(hash);
  if (newMatch) {
    return {
      format: "new",
      name: newMatch[1],
      version: newMatch[2],
      hashPlus: newMatch[3]
    };
  }

  return null;
}

const ZIG_OLD_HASH_PATTERN = /^1220[0-9a-f]{64}$/i;
const ZIG_NEW_HASH_PATTERN = /^(.+)-(.+?)-([A-Za-z0-9_-]{43,44})$/;

type Token =
  | { type: "struct_start" }
  | { type: "brace_close" }
  | { type: "dot_ident"; value: string }
  | { type: "equals" }
  | { type: "string"; value: string }
  | { type: "comma" }
  | { type: "true" }
  | { type: "false" }
  | { type: "number"; value: string }
  | { type: "empty_struct" };

function tokenizeZon(input: string): Result<Token[], OhriskError> {
  const tokens: Token[] = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    const char = input[pos];

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      pos += 1;
      continue;
    }

    if (char === "/" && input[pos + 1] === "/") {
      while (pos < len && input[pos] !== "\n") {
        pos += 1;
      }
      continue;
    }

    if (char === "." && input[pos + 1] === "{") {
      if (input[pos + 2] === "}") {
        tokens.push({ type: "empty_struct" });
        pos += 3;
        continue;
      }

      tokens.push({ type: "struct_start" });
      pos += 2;
      continue;
    }

    if (char === "}") {
      tokens.push({ type: "brace_close" });
      pos += 1;
      continue;
    }

    if (char === "=") {
      tokens.push({ type: "equals" });
      pos += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma" });
      pos += 1;
      continue;
    }

    if (char === '"') {
      const result = readStringLiteral(input, pos);
      if (!result.ok) {
        return err(result.error);
      }

      tokens.push({ type: "string", value: result.value.text });
      pos = result.value.end;
      continue;
    }

    if (char === ".") {
      const identResult = readDotIdent(input, pos);
      if (!identResult.ok) {
        return err(identResult.error);
      }

      tokens.push({ type: "dot_ident", value: identResult.value.value });
      pos = identResult.value.end;
      continue;
    }

    if (char === "t" && input.slice(pos, pos + 4) === "true") {
      tokens.push({ type: "true" });
      pos += 4;
      continue;
    }

    if (char === "f" && input.slice(pos, pos + 5) === "false") {
      tokens.push({ type: "false" });
      pos += 5;
      continue;
    }

    if (char === "0" && (input[pos + 1] === "x" || input[pos + 1] === "X")) {
      let end = pos + 2;
      while (end < len && /[0-9a-fA-F]/.test(input[end])) {
        end += 1;
      }
      tokens.push({ type: "number", value: input.slice(pos, end) });
      pos = end;
      continue;
    }

    if (/[0-9-]/.test(char)) {
      let end = pos;
      while (end < len && /[0-9.eE+-]/.test(input[end])) {
        end += 1;
      }
      tokens.push({ type: "number", value: input.slice(pos, end) });
      pos = end;
      continue;
    }

    return err(
      createError({
        code: "ZIG_ZON_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse build.zig.zon: unexpected character.",
        details: {
          lockfilePath: undefined,
          position: pos,
          character: char
        }
      })
    );
  }

  return ok(tokens);
}

function readStringLiteral(
  input: string,
  start: number
): Result<{ text: string; end: number }, OhriskError> {
  let pos = start + 1;
  const len = input.length;
  let result = "";

  while (pos < len) {
    const char = input[pos];

    if (char === "\\") {
      const next = input[pos + 1];
      if (next === undefined) {
        return err(zigZonParseError("unterminated_escape"));
      }

      switch (next) {
        case "n": result += "\n"; break;
        case "r": result += "\r"; break;
        case "t": result += "\t"; break;
        case '"': result += '"'; break;
        case "\\": result += "\\"; break;
        case "'": result += "'"; break;
        default: result += next; break;
      }

      pos += 2;
      continue;
    }

    if (char === '"') {
      return ok({ text: result, end: pos + 1 });
    }

    result += char;
    pos += 1;
  }

  return err(zigZonParseError("unterminated_string"));
}

function readDotIdent(
  input: string,
  start: number
): Result<{ value: string; end: number }, OhriskError> {
  let pos = start + 1;
  const len = input.length;
  let result = "";

  while (pos < len) {
    const char = input[pos];
    if (/[A-Za-z0-9_]/.test(char)) {
      result += char;
      pos += 1;
      continue;
    }

    break;
  }

  if (result === "") {
    return err(zigZonParseError("empty_identifier"));
  }

  return ok({ value: result, end: pos });
}

type ParseState = {
  tokens: Token[];
  index: number;
};

function parseZonValue(tokens: Token[]): Result<ZonValue, OhriskError> {
  const state: ParseState = { tokens, index: 0 };
  return parseValue(state);
}

function parseValue(state: ParseState): Result<ZonValue, OhriskError> {
  const token = peek(state);
  if (!token) {
    return err(zigZonParseError("unexpected_end"));
  }

  switch (token.type) {
    case "struct_start":
      return parseStruct(state);
    case "empty_struct":
      state.index += 1;
      return ok({ kind: "struct", fields: new Map(), positional: [] });
    case "string":
      state.index += 1;
      return ok({ kind: "string", value: token.value });
    case "true":
      state.index += 1;
      return ok({ kind: "bool", value: true });
    case "false":
      state.index += 1;
      return ok({ kind: "bool", value: false });
    case "dot_ident":
      state.index += 1;
      return ok({ kind: "ident", value: token.value });
    case "number":
      state.index += 1;
      return ok({ kind: "number", value: token.value });
    default:
      return err(zigZonParseError("unexpected_token"));
  }
}

function parseStruct(state: ParseState): Result<ZonValue, OhriskError> {
  const token = peek(state);
  if (!token || token.type !== "struct_start") {
    return err(zigZonParseError("expected_struct"));
  }

  state.index += 1;
  const fields = new Map<string, ZonValue>();
  const positional: ZonValue[] = [];

  while (true) {
    skipCommas(state);
    const next = peek(state);
    if (!next) {
      return err(zigZonParseError("unexpected_end_in_struct"));
    }

    if (next.type === "brace_close") {
      state.index += 1;
      return ok({ kind: "struct", fields, positional });
    }

    if (next.type !== "dot_ident") {
      const posValue = parseValue(state);
      if (!posValue.ok) {
        return posValue;
      }
      positional.push(posValue.value);
      continue;
    }

    state.index += 1;
    const key = next.value;

    const afterKey = peek(state);
    if (!afterKey || afterKey.type !== "equals") {
      positional.push({ kind: "ident", value: key });
      continue;
    }

    state.index += 1;
    const value = parseValue(state);
    if (!value.ok) {
      return value;
    }

    fields.set(key, value.value);
  }
}

function peek(state: ParseState): Token | undefined {
  return state.tokens[state.index];
}

function skipCommas(state: ParseState): void {
  while (state.tokens[state.index]?.type === "comma") {
    state.index += 1;
  }
}

function stringFieldValue(
  struct: Extract<ZonValue, { kind: "struct" }>,
  key: string
): string | undefined {
  const field = struct.fields.get(key);
  return field?.kind === "string" ? field.value : undefined;
}

function boolFieldValue(
  struct: Extract<ZonValue, { kind: "struct" }>,
  key: string
): boolean | undefined {
  const field = struct.fields.get(key);
  return field?.kind === "bool" ? field.value : undefined;
}

function rootProjectNameFromPath(lockfilePath: string): string {
  return path.basename(path.dirname(lockfilePath)) || "<zig>";
}

function zigZonShapeError(input: {
  lockfilePath: string;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "ZIG_ZON_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse build.zig.zon. Ohrisk supports Zig build.zig.zon manifests with a root struct and dependencies.",
      details: input
    })
  );
}

function zigZonParseError(reason: string): OhriskError {
  return createError({
    code: "ZIG_ZON_PARSE_FAILED",
    category: "unsupported_input",
    message: "Failed to parse build.zig.zon.",
    details: { reason }
  });
}

export type ZigManifestMetadata = {
  name: string;
  version: string;
  fingerprint: bigint | undefined;
  paths: string[] | undefined;
};

export function extractZigManifestMetadata(input: string): ZigManifestMetadata | undefined {
  const tokens = tokenizeZon(input);
  if (!tokens.ok) {
    return undefined;
  }

  const parsed = parseZonValue(tokens.value);
  if (!parsed.ok || parsed.value.kind !== "struct") {
    return undefined;
  }

  const root = parsed.value;
  const nameField = root.fields.get("name");
  const name = nameField?.kind === "ident"
    ? nameField.value
    : nameField?.kind === "string"
      ? nameField.value
      : undefined;

  const versionField = root.fields.get("version");
  const version = versionField?.kind === "string" ? versionField.value : undefined;

  const fingerprintField = root.fields.get("fingerprint");
  let fingerprint: bigint | undefined;
  if (fingerprintField?.kind === "number") {
    const raw = fingerprintField.value;
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
      const parsed = BigInt(raw);
      if (parsed >= 0n) {
        fingerprint = parsed;
      }
    }
  }

  if (!name || !version) {
    return undefined;
  }

  return { name, version, fingerprint, paths: extractPaths(root) };
}

function extractPaths(root: Extract<ZonValue, { kind: "struct" }>): string[] | undefined {
  const pathsField = root.fields.get("paths");
  if (!pathsField || pathsField.kind !== "struct") {
    return undefined;
  }

  const paths: string[] = [];
  for (const pos of pathsField.positional) {
    if (pos.kind === "string") {
      paths.push(pos.value);
    }
  }

  return paths;
}
