import path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

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
  | { kind: "string"; bytes: Buffer; text?: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ident"; value: string; quoted: boolean }
  | {
      kind: "struct";
      fields: Map<string, ZonValue>;
      fieldValues: Map<string, ZonValue[]>;
      fieldCounts: Map<string, number>;
      positional: ZonValue[];
  }
  | { kind: "number"; value: string }
  | { kind: "empty" };

const CRC32_TABLE = buildCrc32Table();
const ZON_TEXT_ENCODER = new TextEncoder();
const ZON_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const ZIG_RESERVED_KEYWORDS = new Set([
  "addrspace",
  "align",
  "allowzero",
  "and",
  "anyframe",
  "anytype",
  "asm",
  "break",
  "callconv",
  "catch",
  "comptime",
  "const",
  "continue",
  "defer",
  "else",
  "enum",
  "errdefer",
  "error",
  "export",
  "extern",
  "fn",
  "for",
  "if",
  "inline",
  "linksection",
  "noalias",
  "noinline",
  "nosuspend",
  "opaque",
  "or",
  "orelse",
  "packed",
  "pub",
  "resume",
  "return",
  "struct",
  "suspend",
  "switch",
  "test",
  "threadlocal",
  "try",
  "union",
  "unreachable",
  "var",
  "volatile",
  "while"
]);

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
  if (!isValidKnownZigManifest(root)) {
    return zigZonShapeError({ lockfilePath, reason: "invalid_known_manifest_field" });
  }

  const rootNameField = root.fields.get("name");
  const rootName = rootNameField?.kind === "ident"
    ? rootNameField.value
    : rootNameField?.kind === "string"
      ? rootNameField.text
      : undefined;

  const dependenciesField = root.fields.get("dependencies");
  if (dependenciesField && dependenciesField.kind !== "struct") {
    return zigZonShapeError({ lockfilePath, reason: "dependencies_not_struct" });
  }
  if (dependenciesField?.kind === "struct" && dependenciesField.positional.length > 0) {
    return zigZonShapeError({ lockfilePath, reason: "dependencies_contains_positional_values" });
  }
  const dependencies = dependenciesField?.kind === "struct"
    ? dependenciesField.fields
    : new Map<string, ZonValue>();

  const records: ZigDependency[] = [];
  for (const [depName, depValue] of dependencies) {
    if (depValue.kind !== "struct") {
      return zigZonShapeError({
        lockfilePath,
        reason: `dependency_not_struct:${depName}`
      });
    }
    if ([...depValue.fields.keys()].some((key) => !ZIG_DEPENDENCY_FIELDS.has(key))) {
      return zigZonShapeError({
        lockfilePath,
        reason: `unsupported_dependency_field:${depName}`
      });
    }
    if (depValue.positional.length > 0) {
      return zigZonShapeError({
        lockfilePath,
        reason: `dependency_contains_positional_values:${depName}`
      });
    }
    if (
      hasFieldWithUnexpectedKind(depValue, "url", "string")
      || hasFieldWithUnexpectedKind(depValue, "hash", "string")
      || hasFieldWithUnexpectedKind(depValue, "path", "string")
      || hasFieldWithUnexpectedKind(depValue, "lazy", "bool")
    ) {
      return zigZonShapeError({
        lockfilePath,
        reason: `dependency_field_type:${depName}`
      });
    }

    const url = stringFieldValue(depValue, "url");
    const hash = stringFieldValue(depValue, "hash");
    const depPath = stringFieldValue(depValue, "path");
    const lazy = boolFieldValue(depValue, "lazy");

    const locationFieldCount = (depValue.fieldCounts.get("url") ?? 0)
      + (depValue.fieldCounts.get("path") ?? 0);
    if (locationFieldCount !== 1 || Boolean(url) === Boolean(depPath)) {
      return zigZonShapeError({
        lockfilePath,
        reason: `dependency_location_cardinality:${depName}`
      });
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
    if (
      parsed?.format === "new"
      && !isZigNakedTarballHashIdentity(parsed.name, parsed.version)
    ) {
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
  const [, name, version, hashPlus] = newMatch ?? [];
  if (
    name !== undefined
    && version !== undefined
    && hashPlus !== undefined
    && isValidZigName(name)
    && (
      isValidZigVersion(version)
      || isZigNakedTarballHashIdentity(name, version)
    )
  ) {
    return {
      format: "new",
      name,
      version,
      hashPlus
    };
  }

  return null;
}

const ZIG_OLD_HASH_PATTERN = /^1220[0-9a-f]{64}$/;
const ZIG_NEW_HASH_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)-(.+)-([A-Za-z0-9_-]{44})$/;
const ZIG_NAME_MAX_BYTES = 32;
const ZIG_VERSION_MAX_BYTES = 32;
const ZIG_ROOT_FIELDS = new Set([
  "name",
  "version",
  "fingerprint",
  "minimum_zig_version",
  "dependencies",
  "paths"
]);
const ZIG_DEPENDENCY_FIELDS = new Set(["url", "hash", "path", "lazy"]);

function isZigNakedTarballHashIdentity(name: string, version: string): boolean {
  return name === "N" && version === "V";
}

type Token =
  | { type: "struct_start" }
  | { type: "brace_close" }
  | { type: "dot_ident"; value: string; quoted: boolean }
  | { type: "equals" }
  | { type: "string"; bytes: Buffer; text?: string }
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
    if (char === undefined) {
      break;
    }

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

      tokens.push({
        type: "string",
        bytes: result.value.bytes,
        ...(result.value.text === undefined ? {} : { text: result.value.text })
      });
      pos = result.value.end;
      continue;
    }

    if (char === ".") {
      const identResult = readDotIdent(input, pos);
      if (!identResult.ok) {
        return err(identResult.error);
      }

      tokens.push({
        type: "dot_ident",
        value: identResult.value.value,
        quoted: identResult.value.quoted
      });
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

    if (/[0-9-]/.test(char)) {
      let end = pos;
      while (end < len) {
        const numberChar = input[end];
        if (numberChar === undefined || !/[0-9A-Za-z_.+-]/.test(numberChar)) {
          break;
        }
        end += 1;
      }
      const numberLiteral = input.slice(pos, end);
      if (!isSupportedZigNumberLiteral(numberLiteral)) {
        return err(zigZonParseError("invalid_number_literal"));
      }
      tokens.push({ type: "number", value: numberLiteral });
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
): Result<{ bytes: Buffer; text?: string; end: number }, OhriskError> {
  let pos = start + 1;
  const len = input.length;
  const bytes: number[] = [];

  while (pos < len) {
    const char = input[pos];
    if (char === undefined) {
      break;
    }

    if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) {
      return err(zigZonParseError("raw_control_character_in_string"));
    }

    if (char === "\\") {
      const next = input[pos + 1];
      if (next === undefined) {
        return err(zigZonParseError("unterminated_escape"));
      }

      switch (next) {
        case "n": bytes.push(0x0a); pos += 2; break;
        case "r": bytes.push(0x0d); pos += 2; break;
        case "t": bytes.push(0x09); pos += 2; break;
        case '"': bytes.push(0x22); pos += 2; break;
        case "\\": bytes.push(0x5c); pos += 2; break;
        case "'": bytes.push(0x27); pos += 2; break;
        case "x": {
          const hex = input.slice(pos + 2, pos + 4);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
            return err(zigZonParseError("invalid_hex_escape"));
          }
          bytes.push(Number.parseInt(hex, 16));
          pos += 4;
          break;
        }
        case "u": {
          if (input[pos + 2] !== "{") {
            return err(zigZonParseError("invalid_unicode_escape"));
          }
          let end = pos + 3;
          let codePoint = 0;
          let digitCount = 0;
          while (end < len && input[end] !== "}") {
            const digitChar = input[end];
            if (digitChar === undefined) {
              return err(zigZonParseError("invalid_unicode_escape"));
            }
            const digit = Number.parseInt(digitChar, 16);
            if (!/[0-9a-fA-F]/.test(digitChar) || Number.isNaN(digit)) {
              return err(zigZonParseError("invalid_unicode_escape"));
            }
            codePoint = codePoint * 16 + digit;
            digitCount += 1;
            if (codePoint > 0x10ffff) {
              return err(zigZonParseError("invalid_unicode_codepoint"));
            }
            end += 1;
          }
          if (
            digitCount === 0
            || input[end] !== "}"
            || (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ) {
            return err(zigZonParseError("invalid_unicode_escape"));
          }
          bytes.push(...ZON_TEXT_ENCODER.encode(String.fromCodePoint(codePoint)));
          pos = end + 1;
          break;
        }
        default:
          return err(zigZonParseError("unsupported_escape"));
      }
      continue;
    }

    if (char === '"') {
      const rawBytes = Buffer.from(bytes);
      try {
        return ok({
          bytes: rawBytes,
          text: ZON_TEXT_DECODER.decode(rawBytes),
          end: pos + 1
        });
      } catch {
        return ok({ bytes: rawBytes, end: pos + 1 });
      }
    }

    const codePoint = input.codePointAt(pos);
    if (codePoint === undefined) {
      return err(zigZonParseError("unterminated_string"));
    }
    const rawCharacter = String.fromCodePoint(codePoint);
    bytes.push(...ZON_TEXT_ENCODER.encode(rawCharacter));
    pos += rawCharacter.length;
  }

  return err(zigZonParseError("unterminated_string"));
}

function isSupportedZigNumberLiteral(value: string): boolean {
  return /^-?[0-9][0-9A-Za-z_]*(?:\.[0-9A-Za-z_]*)?(?:[eEpP][+-]?[0-9A-Za-z_]*)?$/.test(value)
    && !value.includes("__")
    && !value.endsWith("_")
    && !/^-?0[xob]_/.test(value);
}

function readDotIdent(
  input: string,
  start: number
): Result<{ value: string; quoted: boolean; end: number }, OhriskError> {
  let pos = start + 1;
  const len = input.length;
  let result = "";

  if (input[pos] === "@" && input[pos + 1] === '"') {
    const quoted = readStringLiteral(input, pos + 1);
    if (!quoted.ok) {
      return quoted;
    }
    return ok({
      value: quoted.value.bytes.toString("latin1"),
      quoted: true,
      end: quoted.value.end
    });
  }

  while (pos < len) {
    const char = input[pos];
    if (char === undefined) {
      break;
    }
    if (/[A-Za-z0-9_]/.test(char)) {
      result += char;
      pos += 1;
      continue;
    }

    break;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(result) || ZIG_RESERVED_KEYWORDS.has(result)) {
    return err(zigZonParseError("invalid_identifier"));
  }

  return ok({ value: result, quoted: false, end: pos });
}

type ParseState = {
  tokens: Token[];
  index: number;
};

const MAX_ZON_NESTING_DEPTH = 128;

function parseZonValue(tokens: Token[]): Result<ZonValue, OhriskError> {
  const state: ParseState = { tokens, index: 0 };
  const parsed = parseValue(state, 0);
  if (!parsed.ok) {
    return parsed;
  }
  if (state.index !== tokens.length) {
    return err(zigZonParseError("trailing_tokens"));
  }
  return parsed;
}

function parseValue(state: ParseState, depth: number): Result<ZonValue, OhriskError> {
  const token = peek(state);
  if (!token) {
    return err(zigZonParseError("unexpected_end"));
  }

  switch (token.type) {
    case "struct_start":
      if (depth >= MAX_ZON_NESTING_DEPTH) {
        return err(zigZonParseError("nesting_too_deep"));
      }
      return parseStruct(state, depth + 1);
    case "empty_struct":
      state.index += 1;
      return ok({
        kind: "struct",
        fields: new Map(),
        fieldValues: new Map(),
        fieldCounts: new Map(),
        positional: []
      });
    case "string":
      state.index += 1;
      return ok({
        kind: "string",
        bytes: token.bytes,
        ...(token.text === undefined ? {} : { text: token.text })
      });
    case "true":
      state.index += 1;
      return ok({ kind: "bool", value: true });
    case "false":
      state.index += 1;
      return ok({ kind: "bool", value: false });
    case "dot_ident":
      state.index += 1;
      return ok({ kind: "ident", value: token.value, quoted: token.quoted });
    case "number":
      state.index += 1;
      return ok({ kind: "number", value: token.value });
    default:
      return err(zigZonParseError("unexpected_token"));
  }
}

function parseStruct(state: ParseState, depth: number): Result<ZonValue, OhriskError> {
  const token = peek(state);
  if (!token || token.type !== "struct_start") {
    return err(zigZonParseError("expected_struct"));
  }

  state.index += 1;
  const fields = new Map<string, ZonValue>();
  const fieldValues = new Map<string, ZonValue[]>();
  const fieldCounts = new Map<string, number>();
  const positional: ZonValue[] = [];
  let needsComma = false;

  while (true) {
    const next = peek(state);
    if (!next) {
      return err(zigZonParseError("unexpected_end_in_struct"));
    }

    if (next.type === "brace_close") {
      state.index += 1;
      return ok({ kind: "struct", fields, fieldValues, fieldCounts, positional });
    }

    if (needsComma) {
      if (next.type !== "comma") {
        return err(zigZonParseError("missing_comma"));
      }
      state.index += 1;
      const afterComma = peek(state);
      if (!afterComma) {
        return err(zigZonParseError("unexpected_end_in_struct"));
      }
      if (afterComma.type === "comma") {
        return err(zigZonParseError("repeated_comma"));
      }
      if (afterComma.type === "brace_close") {
        state.index += 1;
        return ok({ kind: "struct", fields, fieldValues, fieldCounts, positional });
      }
    } else if (next.type === "comma") {
      return err(zigZonParseError("unexpected_comma"));
    }

    const valueStart = peek(state);
    if (!valueStart) {
      return err(zigZonParseError("unexpected_end_in_struct"));
    }

    if (valueStart.type !== "dot_ident") {
      const posValue = parseValue(state, depth);
      if (!posValue.ok) {
        return posValue;
      }
      positional.push(posValue.value);
      needsComma = true;
      continue;
    }

    state.index += 1;
    const key = valueStart.value;

    const afterKey = peek(state);
    if (!afterKey || afterKey.type !== "equals") {
      positional.push({ kind: "ident", value: key, quoted: valueStart.quoted });
      needsComma = true;
      continue;
    }

    state.index += 1;
    const value = parseValue(state, depth);
    if (!value.ok) {
      return value;
    }

    fields.set(key, value.value);
    const occurrences = fieldValues.get(key) ?? [];
    occurrences.push(value.value);
    fieldValues.set(key, occurrences);
    fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    needsComma = true;
  }
}

function peek(state: ParseState): Token | undefined {
  return state.tokens[state.index];
}

type ZonStruct = Extract<ZonValue, { kind: "struct" }>;

function isValidKnownZigManifest(root: ZonStruct): boolean {
  if (
    root.positional.length > 0
    || [...root.fields.keys()].some((key) => !ZIG_ROOT_FIELDS.has(key))
  ) {
    return false;
  }

  return everyFieldValue(root, "name", isValidZigNameValue)
    && everyFieldValue(root, "version", isValidZigVersionValue)
    && everyFieldValue(root, "fingerprint", isZigU64Literal)
    && everyFieldValue(root, "minimum_zig_version", isValidZigVersionValue)
    && everyFieldValue(root, "dependencies", isValidDependencyCollection)
    && everyFieldValue(root, "paths", isValidPathsStruct);
}

function everyFieldValue(
  struct: ZonStruct,
  key: string,
  predicate: (value: ZonValue) => boolean
): boolean {
  return (struct.fieldValues.get(key) ?? []).every(predicate);
}

function isUtf8String(value: ZonValue): boolean {
  return value.kind === "string" && value.text !== undefined;
}

function isValidZigNameValue(value: ZonValue): boolean {
  return value.kind === "ident" && !value.quoted && isValidZigName(value.value);
}

function isValidZigVersionValue(value: ZonValue): boolean {
  return value.kind === "string"
    && value.text !== undefined
    && isValidZigVersion(value.text);
}

function isZigU64Literal(value: ZonValue): boolean {
  if (value.kind !== "number") {
    return false;
  }
  if (!/^(?:0x[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*|0o[0-7]+(?:_[0-7]+)*|0b[01]+(?:_[01]+)*|[0-9]+(?:_[0-9]+)*)$/.test(value.value)) {
    return false;
  }
  const normalized = value.value.replaceAll("_", "");
  try {
    const parsed = BigInt(normalized);
    return parsed >= 0n && parsed <= 0xffffffffffffffffn;
  } catch {
    return false;
  }
}

function isValidDependencyCollection(value: ZonValue): boolean {
  if (value.kind !== "struct" || value.positional.length > 0) {
    return false;
  }
  return [...value.fieldValues.values()]
    .every((occurrences) => occurrences.every(isValidDependencyRecord));
}

function isValidDependencyRecord(value: ZonValue): boolean {
  if (
    value.kind !== "struct"
    || value.positional.length > 0
    || [...value.fields.keys()].some((key) => !ZIG_DEPENDENCY_FIELDS.has(key))
  ) {
    return false;
  }

  const locationCount = (value.fieldCounts.get("url") ?? 0)
    + (value.fieldCounts.get("path") ?? 0);
  return locationCount === 1
    && everyFieldValue(value, "url", isUtf8String)
    && everyFieldValue(value, "hash", isUtf8String)
    && everyFieldValue(value, "path", isUtf8String)
    && everyFieldValue(value, "lazy", (field) => field.kind === "bool");
}

function isValidPathsStruct(value: ZonValue): boolean {
  return value.kind === "struct"
    && value.fields.size === 0
    && value.positional.every((entry) => entry.kind === "string")
    && value.fieldValues.size === 0;
}

function stringFieldValue(
  struct: Extract<ZonValue, { kind: "struct" }>,
  key: string
): string | undefined {
  const field = struct.fields.get(key);
  return field?.kind === "string" ? field.text : undefined;
}

function boolFieldValue(
  struct: Extract<ZonValue, { kind: "struct" }>,
  key: string
): boolean | undefined {
  const field = struct.fields.get(key);
  return field?.kind === "bool" ? field.value : undefined;
}

function hasFieldWithUnexpectedKind(
  value: Extract<ZonValue, { kind: "struct" }>,
  key: string,
  expectedKind: ZonValue["kind"]
): boolean {
  return (value.fieldValues.get(key) ?? []).some((field) => field.kind !== expectedKind);
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

export function extractZigManifestMetadata(zonText: string): ZigManifestMetadata | undefined {
  const manifestValidation = parseZigZonText(zonText, "build.zig.zon");
  if (!manifestValidation.ok) {
    return undefined;
  }

  const tokens = tokenizeZon(zonText);
  if (!tokens.ok) {
    return undefined;
  }

  const parsed = parseZonValue(tokens.value);
  if (!parsed.ok || parsed.value.kind !== "struct") {
    return undefined;
  }

  const root = parsed.value;
  const nameField = root.fields.get("name");
  const name = nameField?.kind === "ident" ? nameField.value : undefined;

  const versionField = root.fields.get("version");
  const version = versionField?.kind === "string" ? versionField.text : undefined;

  const fingerprintField = root.fields.get("fingerprint");
  let fingerprint: bigint | undefined;
  if (fingerprintField !== undefined) {
    if (fingerprintField.kind !== "number") {
      return undefined;
    }
    try {
      fingerprint = BigInt(fingerprintField.value.replaceAll("_", ""));
    } catch {
      return undefined;
    }
  }

  if (!name || !version || !isValidZigName(name) || !isValidZigVersion(version)) {
    return undefined;
  }

  if (fingerprint !== undefined && !isValidZigFingerprint(name, fingerprint)) {
    return undefined;
  }

  const extractedPaths = extractPaths(root);
  if (!extractedPaths.valid) {
    return undefined;
  }

  return {
    name,
    version,
    fingerprint,
    paths: extractedPaths.paths
  };
}

function isValidZigName(name: string): boolean {
  return Buffer.byteLength(name, "utf8") <= ZIG_NAME_MAX_BYTES
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    && !ZIG_RESERVED_KEYWORDS.has(name);
}

function isValidZigVersion(version: string): boolean {
  if (Buffer.byteLength(version, "utf8") > ZIG_VERSION_MAX_BYTES) {
    return false;
  }

  const extraIndex = version.search(/[-+]/);
  const required = extraIndex === -1 ? version : version.slice(0, extraIndex);
  const requiredParts = required.split(".");
  if (requiredParts.length !== 3 || requiredParts.some((part) => !isValidSemanticVersionNumber(part))) {
    return false;
  }
  if (extraIndex === -1) {
    return true;
  }

  const extra = version.slice(extraIndex);
  let prerelease: string | undefined;
  let build: string | undefined;
  if (extra.startsWith("-")) {
    const buildIndex = extra.indexOf("+");
    prerelease = extra.slice(1, buildIndex === -1 ? undefined : buildIndex);
    build = buildIndex === -1 ? undefined : extra.slice(buildIndex + 1);
  } else {
    build = extra.slice(1);
  }

  if (prerelease !== undefined && !isValidSemanticIdentifiers(prerelease, true)) {
    return false;
  }
  return build === undefined || isValidSemanticIdentifiers(build, false);
}

function isValidSemanticVersionNumber(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value)
    && BigInt(value) <= 0xffffffffffffffffn;
}

function isValidSemanticIdentifiers(value: string, rejectLeadingZeroNumbers: boolean): boolean {
  const identifiers = value.split(".");
  return identifiers.every((identifier) =>
    identifier.length > 0
    && /^[0-9A-Za-z-]+$/.test(identifier)
    && (!rejectLeadingZeroNumbers || !/^[0-9]+$/.test(identifier) || isValidSemanticVersionNumber(identifier))
  );
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidZigFingerprint(name: string, fingerprint: bigint): boolean {
  if (fingerprint < 0n || fingerprint > 0xffffffffffffffffn) {
    return false;
  }
  const id = Number(fingerprint & 0xffffffffn);
  const checksum = Number((fingerprint >> 32n) & 0xffffffffn);
  return id !== 0 && id !== 0xffffffff && checksum === crc32(Buffer.from(name, "utf8"));
}

function extractPaths(
  root: Extract<ZonValue, { kind: "struct" }>
):
  | { valid: true; paths?: string[] }
  | { valid: false } {
  const pathsField = root.fields.get("paths");
  if (!pathsField) {
    return { valid: true };
  }
  if (pathsField.kind !== "struct" || pathsField.fields.size > 0) {
    return { valid: false };
  }

  const paths: string[] = [];
  for (const pos of pathsField.positional) {
    if (pos.kind !== "string") {
      return { valid: false };
    }
    paths.push(pos.bytes.toString("latin1"));
  }

  return { valid: true, paths };
}
