import path from "node:path";
import { parse as parseYaml } from "yaml";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type CondaEnvironmentRecord = {
  id: string;
  name: string;
  version: string;
  ecosystem: "conda" | "pypi";
};

export function parseCondaEnvironmentFile(
  environmentPath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const environmentText = readInputTextFile({
    filePath: environmentPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!environmentText.ok) {
    return err(
      createError({
        code: "CONDA_ENVIRONMENT_READ_FAILED",
        category: inputFileReadErrorCategory(environmentText.error),
        message: environmentText.error.kind === "too_large"
          ? "environment.yml exceeded the maximum supported size."
          : "Failed to read environment.yml.",
        details: {
          lockfilePath: environmentPath,
          ...inputFileReadErrorDetails(environmentText.error)
        }
      })
    );
  }

  return parseCondaEnvironmentText(environmentText.value, environmentPath);
}

export function parseCondaEnvironmentText(
  input: string,
  environmentPath = "environment.yml"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (cause) {
    return err(
      createError({
        code: "CONDA_ENVIRONMENT_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse environment.yml.",
        details: {
          lockfilePath: environmentPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readCondaEnvironmentRecords(parsed, environmentPath);
  if (!records.ok) {
    return records;
  }

  const rootName = readRootName(parsed, environmentPath);
  return ok({
    rootName,
    lockfilePath: environmentPath,
    nodes: records.value
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: record.ecosystem,
        dependencyType: "production",
        direct: true,
        paths: [[rootName, record.id]]
      }))
  });
}

function readCondaEnvironmentRecords(
  parsed: unknown,
  environmentPath: string
): Result<CondaEnvironmentRecord[], OhriskError> {
  if (!isRecord(parsed) || !Array.isArray(parsed.dependencies)) {
    return err(
      createError({
        code: "CONDA_ENVIRONMENT_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse environment.yml. Ohrisk expected a dependencies array.",
        details: {
          lockfilePath: environmentPath
        }
      })
    );
  }

  const records = new Map<string, CondaEnvironmentRecord>();
  for (const [index, dependency] of parsed.dependencies.entries()) {
    const parsedDependency = parseCondaEnvironmentDependency({
      dependency,
      index,
      environmentPath
    });

    if (!parsedDependency.ok) {
      return parsedDependency;
    }

    for (const record of parsedDependency.value) {
      records.set(record.id, record);
    }
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "CONDA_ENVIRONMENT_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse environment.yml. Ohrisk expected at least one exact package pin.",
        details: {
          lockfilePath: environmentPath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function parseCondaEnvironmentDependency(input: {
  dependency: unknown;
  index: number;
  environmentPath: string;
}): Result<CondaEnvironmentRecord[], OhriskError> {
  if (typeof input.dependency === "string") {
    const record = parseCondaPackagePin(input.dependency);
    if (!record) {
      return condaEnvironmentParseError({
        lockfilePath: input.environmentPath,
        index: input.index,
        entry: input.dependency,
        reason: "unsupported_conda_dependency"
      });
    }

    return ok([record]);
  }

  if (isRecord(input.dependency) && Array.isArray(input.dependency.pip)) {
    const records: CondaEnvironmentRecord[] = [];
    for (const [pipIndex, pipDependency] of input.dependency.pip.entries()) {
      if (typeof pipDependency !== "string") {
        return condaEnvironmentParseError({
          lockfilePath: input.environmentPath,
          index: input.index,
          pipIndex,
          reason: "pip_dependency_not_string"
        });
      }

      const record = parsePipPackagePin(pipDependency);
      if (!record) {
        return condaEnvironmentParseError({
          lockfilePath: input.environmentPath,
          index: input.index,
          pipIndex,
          entry: pipDependency,
          reason: "unsupported_pip_dependency"
        });
      }

      records.push(record);
    }

    return ok(records);
  }

  return condaEnvironmentParseError({
    lockfilePath: input.environmentPath,
    index: input.index,
    reason: "unsupported_dependency_entry"
  });
}

function parseCondaPackagePin(input: string): CondaEnvironmentRecord | undefined {
  const spec = stripCondaChannel(input.trim());
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)=([^=<>!~\s*]+)(?:=[^\s]+)?$/.exec(spec);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return packageRecord({
    ecosystem: "conda",
    name: match[1],
    version: match[2]
  });
}

function parsePipPackagePin(input: string): CondaEnvironmentRecord | undefined {
  const requirement = input.split(";", 1)[0]?.trim() ?? "";
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?\s*==\s*([^\s;*]+)$/.exec(requirement);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return packageRecord({
    ecosystem: "pypi",
    name: match[1],
    version: match[2]
  });
}

function packageRecord(input: {
  ecosystem: "conda" | "pypi";
  name: string;
  version: string;
}): CondaEnvironmentRecord {
  return {
    id: input.ecosystem === "conda"
      ? `conda:${input.name}@${input.version}`
      : `pypi:${input.name}@${input.version}`,
    name: input.name,
    version: input.version,
    ecosystem: input.ecosystem
  };
}

function stripCondaChannel(input: string): string {
  const separatorIndex = input.lastIndexOf("::");
  return separatorIndex >= 0 ? input.slice(separatorIndex + "::".length) : input;
}

function readRootName(parsed: unknown, environmentPath: string): string {
  if (isRecord(parsed) && typeof parsed.name === "string" && parsed.name.trim() !== "") {
    return parsed.name.trim();
  }

  return path.basename(path.dirname(environmentPath)) || "<conda-environment>";
}

function condaEnvironmentParseError(input: {
  lockfilePath: string;
  index: number;
  pipIndex?: number;
  entry?: string;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "CONDA_ENVIRONMENT_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse environment.yml dependency entry. Ohrisk supports exact Conda name=version pins and exact pip name==version pins.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
