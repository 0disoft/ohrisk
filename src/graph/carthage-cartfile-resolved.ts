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

type CarthageRecord = {
  name: string;
  version: string;
  id: string;
  sourceKind: "github" | "git" | "binary";
  location: string;
};

export function parseCartfileResolvedFile(
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
        code: "CARTFILE_RESOLVED_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "Cartfile.resolved exceeded the maximum supported size."
          : "Failed to read Cartfile.resolved.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseCartfileResolvedText(lockfileText.value, lockfilePath);
}

export function parseCartfileResolvedText(
  input: string,
  lockfilePath = "Cartfile.resolved"
): Result<DependencyGraph, OhriskError> {
  const records = readCartfileResolvedRecords(input, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<carthage-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "carthage",
        dependencyType: "unknown",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readCartfileResolvedRecords(
  input: string,
  lockfilePath: string
): Result<CarthageRecord[], OhriskError> {
  const records: CarthageRecord[] = [];

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const parsed = parseCartfileResolvedLine(line);
    if (!parsed) {
      return cartfileResolvedParseError({
        lockfilePath,
        line: index + 1,
        entry: line
      });
    }

    records.push(parsed);
  }

  if (records.length === 0) {
    return err(
      createError({
        code: "CARTFILE_RESOLVED_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Cartfile.resolved. Ohrisk expected at least one resolved dependency.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok(deduplicateCarthageRecords(records));
}

function parseCartfileResolvedLine(line: string): CarthageRecord | undefined {
  const match = /^(github|git|binary)\s+"([^"]+)"\s+"([^"]+)"$/.exec(line);
  if (!match) {
    return undefined;
  }

  const sourceKind = match[1] as CarthageRecord["sourceKind"];
  const location = match[2]?.trim();
  const version = match[3]?.trim();
  if (!location || !version) {
    return undefined;
  }

  const name = carthagePackageName({
    sourceKind,
    location
  });
  if (!name) {
    return undefined;
  }

  return {
    name,
    version,
    id: `${name}@${version}`,
    sourceKind,
    location
  };
}

function carthagePackageName(input: {
  sourceKind: CarthageRecord["sourceKind"];
  location: string;
}): string | undefined {
  switch (input.sourceKind) {
    case "github":
      return githubPackageName(input.location);
    case "git":
      return packageNameFromRepositoryLocation(input.location);
    case "binary":
      return packageNameFromBinaryLocation(input.location);
  }
}

function githubPackageName(location: string): string | undefined {
  const normalized = location.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter((part) => part !== "");
  if (parts.length !== 2) {
    return undefined;
  }

  const [owner, repository] = parts;
  if (!owner || !repository) {
    return undefined;
  }

  return `${owner}/${stripGitSuffix(repository)}`;
}

function packageNameFromRepositoryLocation(location: string): string | undefined {
  const pathLike = pathLikeLocation(location);
  const candidate = basenameWithoutExtension(pathLike, ".git");
  return candidate === "" ? undefined : candidate;
}

function packageNameFromBinaryLocation(location: string): string | undefined {
  const pathLike = pathLikeLocation(location);
  const candidate = basenameWithoutExtension(pathLike, ".json");
  return candidate === "" ? undefined : candidate;
}

function pathLikeLocation(location: string): string {
  try {
    const url = new URL(location);
    return url.pathname;
  } catch {
    return location;
  }
}

function basenameWithoutExtension(value: string, extension: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/[/?#]+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const stripped = extension !== "" && basename.endsWith(extension)
    ? basename.slice(0, -extension.length)
    : basename;
  return stripped.trim();
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function deduplicateCarthageRecords(records: CarthageRecord[]): CarthageRecord[] {
  const deduped = new Map<string, CarthageRecord>();
  for (const record of records) {
    deduped.set(record.id, record);
  }

  return [...deduped.values()];
}

function cartfileResolvedParseError(input: {
  lockfilePath: string;
  line: number;
  entry: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "CARTFILE_RESOLVED_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Cartfile.resolved entry. Ohrisk expects github, git, or binary entries with quoted location and version.",
      details: input
    })
  );
}
