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

type RequirementsRecord = {
  name: string;
  version: string;
  id: string;
};

export type RequirementsIncludedFile = {
  path: string;
  text: string;
};

export type RequirementsIncludedFileReader = (input: {
  includePath: string;
  fromFilePath: string;
  directive: "requirement" | "constraint";
}) => Result<RequirementsIncludedFile, OhriskError>;

type RequirementsParseOptions = {
  readIncludedFile?: RequirementsIncludedFileReader;
  rootName?: string;
};

type RequirementsDirective = {
  kind: "requirement" | "constraint";
  path: string;
};

type RequirementsLineEntry = {
  line: number;
  entry: string;
  directive?: RequirementsDirective;
};

const MAX_REQUIREMENTS_INCLUDE_DEPTH = 32;

export function parseRequirementsFile(
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
        code: "REQUIREMENTS_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "requirements.txt exceeded the maximum supported size."
          : "Failed to read requirements.txt.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseRequirementsText(lockfileText.value, lockfilePath, {
    readIncludedFile: createDiskRequirementsIncludedFileReader({
      rootDir: path.dirname(lockfilePath),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
    })
  });
}

export function parseRequirementsText(
  input: string,
  lockfilePath = "requirements.txt",
  options: RequirementsParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  const rootName = options.rootName ?? (path.basename(path.dirname(lockfilePath)) || "<root>");
  const constraints = new Map<string, RequirementsRecord>();
  const records = parseRequirementsDocument({
    text: input,
    lockfilePath,
    mode: "requirements",
    readIncludedFile: options.readIncludedFile,
    constraints,
    seenFiles: new Set(),
    depth: 0
  });

  if (!records.ok) {
    return records;
  }

  return ok({
    rootName,
    lockfilePath,
    nodes: [...records.value.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [[rootName, record.id]]
      }))
  });
}

function parseRequirementsDocument(input: {
  text: string;
  lockfilePath: string;
  mode: "requirements" | "constraints";
  readIncludedFile?: RequirementsIncludedFileReader;
  constraints: Map<string, RequirementsRecord>;
  seenFiles: Set<string>;
  depth: number;
}): Result<Map<string, RequirementsRecord>, OhriskError> {
  const normalizedLockfilePath = normalizeRequirementsPathKey(input.lockfilePath);
  if (input.seenFiles.has(normalizedLockfilePath)) {
    return err(
      createError({
        code: "REQUIREMENTS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse requirements.txt. Nested requirement or constraint files contain an include cycle.",
        details: {
          lockfilePath: input.lockfilePath
        }
      })
    );
  }

  if (input.depth > MAX_REQUIREMENTS_INCLUDE_DEPTH) {
    return err(
      createError({
        code: "REQUIREMENTS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse requirements.txt. Nested requirement or constraint files exceeded the maximum include depth.",
        details: {
          lockfilePath: input.lockfilePath,
          maxDepth: MAX_REQUIREMENTS_INCLUDE_DEPTH
        }
      })
    );
  }

  const seenFiles = new Set(input.seenFiles);
  seenFiles.add(normalizedLockfilePath);
  const records = new Map<string, RequirementsRecord>();
  const entries: RequirementsLineEntry[] = [];

  for (const [index, rawLine] of input.text.split(/\r?\n/).entries()) {
    const line = stripRequirementComment(rawLine).trim();
    if (line === "" || isIgnoredRequirementLine(line)) {
      continue;
    }

    const directive = parseRequirementDirective(line);
    if (directive) {
      entries.push({
        line: index + 1,
        entry: line,
        directive
      });
      continue;
    }

    if (isUnsupportedRequirementDirective(line)) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Ohrisk v0 only supports package registry requirements, nested requirement files, and nested constraint files.",
          details: {
            lockfilePath: input.lockfilePath,
            line: index + 1,
            entry: line
          }
        })
      );
    }

    entries.push({
      line: index + 1,
      entry: line
    });
  }

  for (const entry of entries) {
    if (entry.directive?.kind !== "constraint") {
      continue;
    }

    const included = readIncludedRequirementsDocument({
      directive: entry.directive,
      fromFilePath: input.lockfilePath,
      readIncludedFile: input.readIncludedFile,
      line: entry.line,
      entry: entry.entry
    });
    if (!included.ok) {
      return included;
    }

    const parsedConstraints = parseRequirementsDocument({
      text: included.value.text,
      lockfilePath: included.value.path,
      mode: "constraints",
      readIncludedFile: input.readIncludedFile,
      constraints: input.constraints,
      seenFiles,
      depth: input.depth + 1
    });
    if (!parsedConstraints.ok) {
      return parsedConstraints;
    }
  }

  for (const entry of entries) {
    if (entry.directive) {
      if (entry.directive.kind === "constraint") {
        continue;
      }

      if (input.mode === "constraints") {
        return err(
          createError({
            code: "REQUIREMENTS_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse requirements.txt. Constraint files cannot include requirement files.",
            details: {
              lockfilePath: input.lockfilePath,
              line: entry.line,
              entry: entry.entry
            }
          })
        );
      }

      const included = readIncludedRequirementsDocument({
        directive: entry.directive,
        fromFilePath: input.lockfilePath,
        readIncludedFile: input.readIncludedFile,
        line: entry.line,
        entry: entry.entry
      });
      if (!included.ok) {
        return included;
      }

      const parsedIncluded = parseRequirementsDocument({
        text: included.value.text,
        lockfilePath: included.value.path,
        mode: "requirements",
        readIncludedFile: input.readIncludedFile,
        constraints: input.constraints,
        seenFiles,
        depth: input.depth + 1
      });
      if (!parsedIncluded.ok) {
        return parsedIncluded;
      }

      mergeRequirementsRecords(records, parsedIncluded.value);
      continue;
    }

    const parsed = parsePinnedRequirement(entry.entry)
      ?? parseConstrainedRequirement(entry.entry, input.constraints);
    if (!parsed) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt dependency entry. Ohrisk v0 requires name==version pins or a matching exact constraint pin.",
          details: {
            lockfilePath: input.lockfilePath,
            line: entry.line,
            entry: entry.entry
          }
        })
      );
    }

    if (input.mode === "constraints") {
      input.constraints.set(normalizePythonPackageName(parsed.name), parsed);
    } else {
      records.set(parsed.id, parsed);
    }
  }

  return ok(records);
}

function readIncludedRequirementsDocument(input: {
  directive: RequirementsDirective;
  fromFilePath: string;
  readIncludedFile: RequirementsIncludedFileReader | undefined;
  line: number;
  entry: string;
}): Result<RequirementsIncludedFile, OhriskError> {
  if (!input.readIncludedFile) {
    return err(
      createError({
        code: "REQUIREMENTS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse requirements.txt. Nested requirement and constraint files require file access.",
        details: {
          lockfilePath: input.fromFilePath,
          line: input.line,
          entry: input.entry
        }
      })
    );
  }

  return input.readIncludedFile({
    includePath: input.directive.path,
    fromFilePath: input.fromFilePath,
    directive: input.directive.kind
  });
}

function parsePinnedRequirement(line: string): RequirementsRecord | undefined {
  const requirement = line.split(";", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?\s*==\s*([^\s;]+)$/.exec(requirement);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const name = match[1];
  const version = match[2];
  if (version.includes("*")) {
    return undefined;
  }

  return {
    name,
    version,
    id: `${name}@${version}`
  };
}

function parseConstrainedRequirement(
  line: string,
  constraints: Map<string, RequirementsRecord>
): RequirementsRecord | undefined {
  const requirement = line.split(";", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?(?:\s*[<>=!~].*)?$/.exec(requirement);
  if (!match?.[1]) {
    return undefined;
  }

  const constrained = constraints.get(normalizePythonPackageName(match[1]));
  if (!constrained) {
    return undefined;
  }

  return {
    name: match[1],
    version: constrained.version,
    id: `${match[1]}@${constrained.version}`
  };
}

function parseRequirementDirective(line: string): RequirementsDirective | undefined {
  const requirementMatch = /^(?:-r|--requirement)\s+(.+)$/.exec(line)
    ?? /^--requirement=(.+)$/.exec(line);
  if (requirementMatch?.[1]) {
    return {
      kind: "requirement",
      path: unquoteRequirementPath(requirementMatch[1])
    };
  }

  const constraintMatch = /^(?:-c|--constraint)\s+(.+)$/.exec(line)
    ?? /^--constraint=(.+)$/.exec(line);
  if (constraintMatch?.[1]) {
    return {
      kind: "constraint",
      path: unquoteRequirementPath(constraintMatch[1])
    };
  }

  return undefined;
}

function isIgnoredRequirementLine(line: string): boolean {
  return line.startsWith("--index-url ")
    || line.startsWith("--extra-index-url ")
    || line.startsWith("--find-links ")
    || line.startsWith("--trusted-host ")
    || line.startsWith("--prefer-binary")
    || line.startsWith("--no-binary ")
    || line.startsWith("--only-binary ")
    || line.startsWith("--require-hashes")
    || line.startsWith("--no-index")
    || line.startsWith("--pre")
    || line.startsWith("-i ")
    || line.startsWith("-f ");
}

function isUnsupportedRequirementDirective(line: string): boolean {
  return line.startsWith("-e ")
    || line.startsWith("--editable ")
    || line.startsWith("git+")
    || line.startsWith("http://")
    || line.startsWith("https://")
    || line.startsWith("file:");
}

function createDiskRequirementsIncludedFileReader(input: {
  rootDir: string;
  maxBytes: number;
}): RequirementsIncludedFileReader {
  const rootDir = path.resolve(input.rootDir);

  return ({ includePath, fromFilePath }) => {
    if (path.isAbsolute(includePath)) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Absolute nested requirement or constraint paths are not supported.",
          details: {
            lockfilePath: fromFilePath,
            includePath
          }
        })
      );
    }

    const resolved = path.resolve(path.dirname(fromFilePath), includePath);
    if (!isPathInsideOrEqual(resolved, rootDir)) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Nested requirement or constraint paths must stay inside the requirements root.",
          details: {
            lockfilePath: fromFilePath,
            includePath
          }
        })
      );
    }

    const includedText = readInputTextFile({
      filePath: resolved,
      maxBytes: input.maxBytes
    });
    if (!includedText.ok) {
      return err(
        createError({
          code: "REQUIREMENTS_READ_FAILED",
          category: inputFileReadErrorCategory(includedText.error),
          message: includedText.error.kind === "too_large"
            ? "Nested requirements.txt or constraints file exceeded the maximum supported size."
            : "Failed to read nested requirements.txt or constraints file.",
          details: {
            lockfilePath: fromFilePath,
            includePath,
            includedPath: resolved,
            ...inputFileReadErrorDetails(includedText.error)
          }
        })
      );
    }

    return ok({
      path: resolved,
      text: includedText.value
    });
  };
}

function mergeRequirementsRecords(
  target: Map<string, RequirementsRecord>,
  source: Map<string, RequirementsRecord>
): void {
  for (const [id, record] of source.entries()) {
    target.set(id, record);
  }
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function normalizeRequirementsPathKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

function unquoteRequirementPath(input: string): string {
  const value = input.trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stripRequirementComment(line: string): string {
  let quote: "\"" | "'" | undefined;
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

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }

  return line;
}
