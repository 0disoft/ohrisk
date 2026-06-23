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

type HelmDependencyRecord = {
  chartName: string;
  packageName: string;
  version: string;
  repository?: string;
  digest?: string;
  id: string;
};

export function parseHelmChartFile(
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
        code: "HELM_CHART_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? `${path.basename(lockfilePath)} exceeded the maximum supported size.`
          : `Failed to read ${path.basename(lockfilePath)}.`,
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseHelmChartText(lockfileText.value, lockfilePath);
}

export function parseHelmChartText(
  input: string,
  lockfilePath = "Chart.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (cause) {
    return err(
      createError({
        code: "HELM_CHART_PARSE_FAILED",
        category: "unsupported_input",
        message: `Failed to parse ${path.basename(lockfilePath)}.`,
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const records = readHelmDependencyRecords(parsed, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<helm-chart>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.packageName,
        installNames: [record.chartName],
        version: record.version,
        ecosystem: "helm",
        resolved: record.repository,
        integrity: record.digest,
        dependencyType: "production",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readHelmDependencyRecords(
  parsed: unknown,
  lockfilePath: string
): Result<HelmDependencyRecord[], OhriskError> {
  if (!isRecord(parsed)) {
    return helmChartShapeError({
      lockfilePath,
      reason: "root_not_object"
    });
  }

  if (parsed.dependencies === undefined) {
    return ok([]);
  }

  if (!Array.isArray(parsed.dependencies)) {
    return helmChartShapeError({
      lockfilePath,
      reason: "dependencies_not_array"
    });
  }

  const records = new Map<string, HelmDependencyRecord>();
  for (const [index, dependency] of parsed.dependencies.entries()) {
    if (!isRecord(dependency)) {
      return helmChartShapeError({
        lockfilePath,
        index,
        reason: "dependency_not_object"
      });
    }

    const chartName = typeof dependency.name === "string" ? dependency.name.trim() : "";
    const version = typeof dependency.version === "string" ? dependency.version.trim() : "";
    const repository = typeof dependency.repository === "string"
      ? dependency.repository.trim()
      : undefined;
    const digest = typeof dependency.digest === "string"
      ? dependency.digest.trim()
      : undefined;

    if (chartName === "" || version === "") {
      return helmChartShapeError({
        lockfilePath,
        index,
        reason: "dependency_missing_name_or_version"
      });
    }

    const packageName = repository && repository !== ""
      ? `${repository}/${chartName}`
      : chartName;
    const id = `${packageName}@${version}`;
    records.set(id, {
      chartName,
      packageName,
      version,
      ...(repository && repository !== "" ? { repository } : {}),
      ...(digest && digest !== "" ? { digest } : {}),
      id
    });
  }

  return ok([...records.values()]);
}

function helmChartShapeError(input: {
  lockfilePath: string;
  index?: number;
  reason: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "HELM_CHART_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse Helm chart dependency metadata. Ohrisk supports Chart.lock and Chart.yaml dependencies arrays.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
