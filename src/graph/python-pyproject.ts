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

type PyprojectDependencyRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
};

export function parsePyprojectFile(
  lockfilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(createError({
      code: "PYPROJECT_READ_FAILED",
      category: inputFileReadErrorCategory(lockfileText.error),
      message: lockfileText.error.kind === "too_large"
        ? "pyproject.toml exceeded the maximum supported size."
        : "Failed to read pyproject.toml.",
      details: {
        lockfilePath,
        ...inputFileReadErrorDetails(lockfileText.error)
      }
    }));
  }

  return parsePyprojectText(lockfileText.value, lockfilePath);
}

export function parsePyprojectText(
  input: string,
  lockfilePath = "pyproject.toml"
): Result<DependencyGraph, OhriskError> {
  const rootName = readProjectName(input) ?? path.basename(path.dirname(lockfilePath)) ?? "<root>";
  const dependencies = readPyprojectDependencies(input, lockfilePath);
  if (!dependencies.ok) {
    return dependencies;
  }

  if (dependencies.value.length === 0) {
    return err(createError({
      code: "PYPROJECT_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse pyproject.toml. Ohrisk expected at least one exact PEP 621 dependency pin.",
      details: {
        lockfilePath
      }
    }));
  }

  return ok({
    rootName,
    lockfilePath,
    nodes: dependencies.value
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "pypi",
        dependencyType: record.dependencyType,
        direct: true,
        paths: [[rootName, record.id]]
      }))
  });
}

function readPyprojectDependencies(
  input: string,
  lockfilePath: string
): Result<PyprojectDependencyRecord[], OhriskError> {
  const records = new Map<string, PyprojectDependencyRecord>();
  let section = "";
  let activeArray: { type: DependencyType; lines: string[] } | undefined;

  const flushArray = (): Result<void, OhriskError> => {
    if (!activeArray) {
      return ok(undefined);
    }

    for (const entry of readStringArrayValues(activeArray.lines.join("\n"))) {
      const parsed = parseExactDependency(entry);
      if (!parsed) {
        return err(createError({
          code: "PYPROJECT_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse pyproject.toml dependency entry. Ohrisk v0 requires exact name==version PEP 621 dependency pins.",
          details: {
            lockfilePath,
            entry
          }
        }));
      }

      records.set(parsed.id, {
        ...parsed,
        dependencyType: activeArray.type
      });
    }

    activeArray = undefined;
    return ok(undefined);
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (activeArray) {
      activeArray.lines.push(line);
      if (line.includes("]")) {
        const flushed = flushArray();
        if (!flushed.ok) {
          return flushed;
        }
      }
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      const flushed = flushArray();
      if (!flushed.ok) {
        return flushed;
      }

      section = line.slice(1, -1);
      continue;
    }

    const dependencyType = dependencyTypeForLine(section, line);
    if (!dependencyType) {
      continue;
    }

    const value = line.slice(line.indexOf("=") + 1).trim();
    activeArray = { type: dependencyType, lines: [value] };
    if (value.includes("]")) {
      const flushed = flushArray();
      if (!flushed.ok) {
        return flushed;
      }
    }
  }

  const flushed = flushArray();
  if (!flushed.ok) {
    return flushed;
  }

  return ok([...records.values()]);
}

function dependencyTypeForLine(section: string, line: string): DependencyType | undefined {
  if (section === "project" && /^dependencies\s*=/.test(line)) {
    return "production";
  }

  if (section === "project.optional-dependencies" && /^[A-Za-z0-9_.-]+\s*=/.test(line)) {
    return "optional";
  }

  return undefined;
}

function parseExactDependency(entry: string): Omit<PyprojectDependencyRecord, "dependencyType"> | undefined {
  const requirement = entry.split(";", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?\s*==\s*([^\s;]+)$/.exec(requirement);
  if (!match?.[1] || !match[2] || match[2].includes("*")) {
    return undefined;
  }

  return {
    name: match[1],
    version: match[2],
    id: `${match[1]}@${match[2]}`
  };
}

function readProjectName(input: string): string | undefined {
  let section = "";
  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }

    if (section === "project") {
      const match = /^name\s*=\s*"([^"]+)"/.exec(line);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  return undefined;
}

function readStringArrayValues(value: string): string[] {
  const values: string[] = [];
  for (const match of value.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'/g)) {
    const item = match[1] ?? match[2];
    if (item !== undefined) {
      values.push(item.replace(/\\"/g, "\"").trim());
    }
  }

  return values.filter((item) => item.length > 0);
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
}
