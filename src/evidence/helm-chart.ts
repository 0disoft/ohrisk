import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  readTextFileWithLimit,
  type TextFileReadError
} from "../shared/read-text-file";
import { ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";
import type { OhriskError } from "../shared/errors";

const HELM_CHART_YAML_MAX_BYTES = 1024 * 1024;
const HELM_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const HELM_EVIDENCE_FILE_LIMIT = 50;

export function collectHelmChartEvidence(input: {
  packageId: string;
  chartName: string;
  version: string;
  projectRoot: string;
  chartYamlMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const chartRoot = findLocalChartRoot({
    chartName: input.chartName,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (!chartRoot) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Helm chart source was not found in the local charts/ directory."]
    });
  }

  const warnings: string[] = [];
  const metadataLicense = readChartYamlLicense({
    chartRoot,
    maxBytes: input.chartYamlMaxBytes ?? HELM_CHART_YAML_MAX_BYTES,
    warnings
  });
  const files = readEvidenceFiles({
    chartRoot,
    maxBytes: input.evidenceFileMaxBytes ?? HELM_EVIDENCE_FILE_MAX_BYTES,
    limit: HELM_EVIDENCE_FILE_LIMIT,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Helm chart source.");
  }

  if (!metadataLicense) {
    warnings.push("Helm Chart.yaml did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadataLicense
      ? {
          metadataLicense,
          metadataSource: "Chart.yaml"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findLocalChartRoot(input: {
  chartName: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const chartsDir = path.resolve(input.projectRoot, "charts");
  const candidates = [
    path.join(chartsDir, input.chartName),
    path.join(chartsDir, `${input.chartName}-${input.version}`)
  ];

  return candidates.find(isReadableDirectory);
}

function readChartYamlLicense(input: {
  chartRoot: string;
  maxBytes: number;
  warnings: string[];
}): string | undefined {
  const chartYamlPath = path.join(input.chartRoot, "Chart.yaml");
  if (!existsSync(chartYamlPath)) {
    input.warnings.push("Local Helm chart source is missing Chart.yaml.");
    return undefined;
  }

  const text = readTextFileWithLimit({
    filePath: chartYamlPath,
    maxBytes: input.maxBytes
  });
  if (!text.ok) {
    input.warnings.push(`Skipped Helm Chart.yaml metadata: ${evidenceReadError(text.error)}.`);
    return undefined;
  }

  try {
    const parsed = parseYaml(text.value) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }

    if (typeof parsed.license === "string" && parsed.license.trim() !== "") {
      return parsed.license.trim();
    }

    const annotations = parsed.annotations;
    if (!isRecord(annotations)) {
      return undefined;
    }

    for (const key of ["artifacthub.io/license", "license", "licenses"]) {
      const value = annotations[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
  } catch (cause) {
    input.warnings.push(`Failed to parse local Helm Chart.yaml metadata: ${cause instanceof Error ? cause.message : String(cause)}.`);
  }

  return undefined;
}

function readEvidenceFiles(input: {
  chartRoot: string;
  maxBytes: number;
  limit: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files = new Map<string, LicenseEvidenceFile>();
  for (const entry of directoryEntries(input.chartRoot)) {
    if (!entry.isFile()) {
      continue;
    }

    const kind = classifyEvidenceFile(entry.name);
    if (!kind) {
      continue;
    }

    if (files.size >= input.limit) {
      input.warnings.push(`Helm chart evidence file limit reached at ${input.limit} files.`);
      break;
    }

    const absolutePath = path.join(input.chartRoot, entry.name);
    const text = readTextFileWithLimit({
      filePath: absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Helm evidence file ${entry.name}: ${evidenceReadError(text.error)}.`);
      continue;
    }

    files.set(entry.name, {
      path: entry.name,
      kind,
      text: text.value
    });
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function directoryEntries(dir: string): import("node:fs").Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function evidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "filesystem":
      return error.cause;
  }
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
