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

type GradleCatalogLibraryRecord = {
  alias: string;
  groupId: string;
  artifactId: string;
  version: string;
  id: string;
};

export function parseGradleVersionCatalogFile(
  catalogPath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const catalogText = readInputTextFile({
    filePath: catalogPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!catalogText.ok) {
    return err(
      createError({
        code: "GRADLE_VERSION_CATALOG_READ_FAILED",
        category: inputFileReadErrorCategory(catalogText.error),
        message: catalogText.error.kind === "too_large"
          ? "libs.versions.toml exceeded the maximum supported size."
          : "Failed to read libs.versions.toml.",
        details: {
          lockfilePath: catalogPath,
          ...inputFileReadErrorDetails(catalogText.error)
        }
      })
    );
  }

  return parseGradleVersionCatalogText(catalogText.value, catalogPath);
}

export function parseGradleVersionCatalogText(
  input: string,
  catalogPath = path.join("gradle", "libs.versions.toml")
): Result<DependencyGraph, OhriskError> {
  const parsed = readGradleVersionCatalogRecords(input, catalogPath);
  if (!parsed.ok) {
    return parsed;
  }

  const rootName = gradleCatalogRootName(catalogPath);
  const nodes = new Map<string, DependencyNode>();

  for (const record of parsed.value) {
    const name = `${record.groupId}:${record.artifactId}`;
    const existing = nodes.get(record.id);
    const pathItems = [rootName, record.alias, record.id];

    if (existing) {
      existing.installNames = [...new Set([...(existing.installNames ?? []), record.alias])].sort();
      existing.paths.push(pathItems);
      continue;
    }

    nodes.set(record.id, {
      id: record.id,
      name,
      installNames: [record.alias],
      version: record.version,
      ecosystem: "maven",
      dependencyType: "unknown",
      direct: true,
      paths: [pathItems]
    });
  }

  return ok({
    rootName,
    lockfilePath: catalogPath,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readGradleVersionCatalogRecords(
  input: string,
  catalogPath: string
): Result<GradleCatalogLibraryRecord[], OhriskError> {
  const versions = new Map<string, string>();
  const records: GradleCatalogLibraryRecord[] = [];
  let currentTable: "versions" | "libraries" | "other" = "other";

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    const table = readTomlTableHeader(line);
    if (table) {
      currentTable = table === "versions" || table === "libraries" ? table : "other";
      continue;
    }

    const assignment = readTomlAssignment(line);
    if (!assignment) {
      continue;
    }

    if (currentTable === "versions") {
      const version = readTomlString(assignment.value);
      if (version) {
        versions.set(assignment.key, version);
      }
      continue;
    }

    if (currentTable !== "libraries") {
      continue;
    }

    const record = readGradleCatalogLibraryRecord({
      alias: assignment.key,
      value: assignment.value,
      versions,
      catalogPath,
      line: index + 1
    });

    if (!record.ok) {
      return record;
    }

    records.push(record.value);
  }

  if (records.length === 0) {
    return err(
      createError({
        code: "GRADLE_VERSION_CATALOG_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse libs.versions.toml. Ohrisk expected at least one [libraries] entry with an exact Maven module version.",
        details: {
          lockfilePath: catalogPath
        }
      })
    );
  }

  return ok(records);
}

function readGradleCatalogLibraryRecord(input: {
  alias: string;
  value: string;
  versions: Map<string, string>;
  catalogPath: string;
  line: number;
}): Result<GradleCatalogLibraryRecord, OhriskError> {
  const compactNotation = readTomlString(input.value);
  if (compactNotation) {
    const coordinates = parseMavenCoordinates(compactNotation);
    if (coordinates) {
      return ok(gradleCatalogRecord({
        alias: input.alias,
        ...coordinates
      }));
    }

    return gradleCatalogParseError({
      lockfilePath: input.catalogPath,
      line: input.line,
      alias: input.alias,
      reason: "compact_notation_not_group_artifact_version"
    });
  }

  const inlineTable = parseTomlInlineTable(input.value);
  if (!inlineTable) {
    return gradleCatalogParseError({
      lockfilePath: input.catalogPath,
      line: input.line,
      alias: input.alias,
      reason: "library_value_not_string_or_inline_table"
    });
  }

  const module = inlineTable.get("module");
  const group = inlineTable.get("group");
  const name = inlineTable.get("name");
  const version = inlineTable.get("version");
  const versionRef = inlineTable.get("version.ref");

  const moduleParts = module ? parseMavenModule(module) : undefined;
  const groupId = moduleParts?.groupId ?? group;
  const artifactId = moduleParts?.artifactId ?? name;
  const resolvedVersion = version ?? (versionRef ? input.versions.get(versionRef) : undefined);

  if (!groupId || !artifactId || !resolvedVersion) {
    return gradleCatalogParseError({
      lockfilePath: input.catalogPath,
      line: input.line,
      alias: input.alias,
      reason: "library_missing_group_artifact_or_exact_version",
      versionRef
    });
  }

  return ok(gradleCatalogRecord({
    alias: input.alias,
    groupId,
    artifactId,
    version: resolvedVersion
  }));
}

function gradleCatalogRecord(input: {
  alias: string;
  groupId: string;
  artifactId: string;
  version: string;
}): GradleCatalogLibraryRecord {
  const id = `${input.groupId}:${input.artifactId}@${input.version}`;
  return {
    ...input,
    id
  };
}

function parseMavenCoordinates(value: string): {
  groupId: string;
  artifactId: string;
  version: string;
} | undefined {
  const [groupId, artifactId, version, extra] = value.split(":");
  if (!groupId || !artifactId || !version || extra !== undefined) {
    return undefined;
  }

  return { groupId, artifactId, version };
}

function parseMavenModule(value: string): {
  groupId: string;
  artifactId: string;
} | undefined {
  const [groupId, artifactId, extra] = value.split(":");
  if (!groupId || !artifactId || extra !== undefined) {
    return undefined;
  }

  return { groupId, artifactId };
}

function readTomlTableHeader(line: string): string | undefined {
  const match = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/.exec(line);
  return match?.[1];
}

function readTomlAssignment(line: string): { key: string; value: string } | undefined {
  const separatorIndex = findTopLevelEquals(line);
  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = normalizeTomlKey(line.slice(0, separatorIndex).trim());
  const value = line.slice(separatorIndex + 1).trim();
  return key && value ? { key, value } : undefined;
}

function parseTomlInlineTable(value: string): Map<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  const table = new Map<string, string>();
  for (const part of splitTopLevel(trimmed.slice(1, -1), ",")) {
    const assignment = readTomlAssignment(part.trim());
    if (!assignment) {
      return undefined;
    }

    const stringValue = readTomlString(assignment.value);
    if (!stringValue) {
      return undefined;
    }

    table.set(assignment.key, stringValue);
  }

  return table;
}

function readTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return undefined;
  }

  const body = trimmed.slice(1, -1);
  return quote === "\"" ? unescapeBasicTomlString(body) : body;
}

function unescapeBasicTomlString(value: string): string {
  return value
    .replace(/\\b/g, "\b")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\f/g, "\f")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function stripTomlComment(line: string): string {
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote === "\"") {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }

  return line;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  let braceDepth = 0;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote === "\"") {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (!quote && char === "{") {
      braceDepth += 1;
      continue;
    }

    if (!quote && char === "}") {
      braceDepth -= 1;
      continue;
    }

    if (!quote && braceDepth === 0 && char === separator) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(input.slice(start));
  return parts.filter((part) => part.trim() !== "");
}

function findTopLevelEquals(input: string): number {
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  let braceDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote === "\"") {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (!quote && char === "{") {
      braceDepth += 1;
      continue;
    }

    if (!quote && char === "}") {
      braceDepth -= 1;
      continue;
    }

    if (!quote && braceDepth === 0 && char === "=") {
      return index;
    }
  }

  return -1;
}

function normalizeTomlKey(key: string): string | undefined {
  const trimmed = key.trim();
  const quoted = readTomlString(trimmed);
  if (quoted) {
    return quoted;
  }

  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : undefined;
}

function gradleCatalogRootName(catalogPath: string): string {
  const dir = path.dirname(catalogPath);
  const rootDir = path.basename(dir) === "gradle" ? path.dirname(dir) : dir;
  return path.basename(rootDir) || "<gradle-project>";
}

function gradleCatalogParseError(input: {
  lockfilePath: string;
  line: number;
  alias: string;
  reason: string;
  versionRef?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "GRADLE_VERSION_CATALOG_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse libs.versions.toml library entry. Ohrisk supports exact Maven coordinates, module plus exact version, and module plus version.ref entries.",
      details: input
    })
  );
}
