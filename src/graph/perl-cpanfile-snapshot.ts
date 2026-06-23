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

type CpanDistributionRecord = {
  id: string;
  name: string;
  version: string;
  pathname?: string;
  provides: string[];
  requirements: string[];
};

export function parseCpanfileSnapshotFile(
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
        code: "CPANFILE_SNAPSHOT_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "cpanfile.snapshot exceeded the maximum supported size."
          : "Failed to read cpanfile.snapshot.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseCpanfileSnapshotText(lockfileText.value, lockfilePath);
}

export function parseCpanfileSnapshotText(
  input: string,
  lockfilePath = "cpanfile.snapshot"
): Result<DependencyGraph, OhriskError> {
  const records = readCpanDistributionRecords(input, lockfilePath);
  if (!records.ok) {
    return records;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<perl-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: records.value
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "cpan",
        ...(record.pathname ? { resolved: record.pathname } : {}),
        dependencyType: "unknown",
        direct: !hasDistributionParent(record, records.value),
        paths: cpanDistributionPaths({
          record,
          records: records.value,
          rootName
        })
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readCpanDistributionRecords(
  input: string,
  lockfilePath: string
): Result<CpanDistributionRecord[], OhriskError> {
  const lines = input.split(/\r?\n/);
  if (!lines.some((line) => line.trim() === "# carton snapshot format: version 1.0")) {
    return cpanfileSnapshotShapeError(lockfilePath, "missing_carton_snapshot_header");
  }

  const distributionsIndex = lines.findIndex((line) => line.trim() === "DISTRIBUTIONS");
  if (distributionsIndex < 0) {
    return cpanfileSnapshotShapeError(lockfilePath, "missing_distributions_section");
  }

  const records: CpanDistributionRecord[] = [];
  let current: Partial<CpanDistributionRecord> | undefined;
  let section: "provides" | "requirements" | undefined;

  for (const rawLine of lines.slice(distributionsIndex + 1)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      continue;
    }

    const distribution = /^  ([^\s]+)$/.exec(line);
    if (distribution?.[1]) {
      const finalized = finalizeCpanRecord(current, lockfilePath);
      if (!finalized.ok) {
        return finalized;
      }

      if (finalized.value) {
        records.push(finalized.value);
      }

      const parsed = parseCpanDistributionName(distribution[1]);
      if (!parsed) {
        return cpanfileSnapshotShapeError(lockfilePath, "invalid_distribution_name", distribution[1]);
      }

      current = {
        ...parsed,
        provides: [],
        requirements: []
      };
      section = undefined;
      continue;
    }

    if (!current) {
      return cpanfileSnapshotShapeError(lockfilePath, "entry_before_distribution", line.trim());
    }

    const field = /^    ([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (field?.[1]) {
      const key = field[1];
      const value = field[2]?.trim() ?? "";
      section = undefined;
      if (key === "pathname") {
        current.pathname = value;
      } else if (key === "provides") {
        section = "provides";
      } else if (key === "requirements") {
        section = "requirements";
      }
      continue;
    }

    const moduleEntry = /^      ([A-Za-z0-9_:]+)(?:\s+.*)?$/.exec(line);
    if (moduleEntry?.[1] && section) {
      const moduleName = moduleEntry[1];
      if (moduleName !== "perl") {
        if (section === "provides") {
          current.provides?.push(moduleName);
        } else {
          current.requirements?.push(moduleName);
        }
      }
      continue;
    }

    return cpanfileSnapshotShapeError(lockfilePath, "unsupported_distribution_line", line.trim());
  }

  const finalized = finalizeCpanRecord(current, lockfilePath);
  if (!finalized.ok) {
    return finalized;
  }

  if (finalized.value) {
    records.push(finalized.value);
  }

  if (records.length === 0) {
    return cpanfileSnapshotShapeError(lockfilePath, "no_distributions");
  }

  return ok(deduplicateCpanRecords(records));
}

function finalizeCpanRecord(
  current: Partial<CpanDistributionRecord> | undefined,
  lockfilePath: string
): Result<CpanDistributionRecord | undefined, OhriskError> {
  if (!current) {
    return ok(undefined);
  }

  if (!current.id || !current.name || !current.version) {
    return cpanfileSnapshotShapeError(lockfilePath, "incomplete_distribution_record");
  }

  return ok({
    id: current.id,
    name: current.name,
    version: current.version,
    ...(current.pathname ? { pathname: current.pathname } : {}),
    provides: [...new Set(current.provides ?? [])].sort(),
    requirements: [...new Set(current.requirements ?? [])].sort()
  });
}

function parseCpanDistributionName(input: string): Pick<CpanDistributionRecord, "id" | "name" | "version"> | undefined {
  const match = /^(.+)-((?:v)?[0-9][0-9A-Za-z._]*)$/.exec(input);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    id: `${match[1]}@${match[2]}`,
    name: match[1],
    version: match[2]
  };
}

function deduplicateCpanRecords(records: CpanDistributionRecord[]): CpanDistributionRecord[] {
  const seen = new Map<string, CpanDistributionRecord>();
  for (const record of records) {
    const existing = seen.get(record.id);
    seen.set(record.id, existing
      ? {
          ...existing,
          pathname: existing.pathname ?? record.pathname,
          provides: [...new Set([...existing.provides, ...record.provides])].sort(),
          requirements: [...new Set([...existing.requirements, ...record.requirements])].sort()
        }
      : record);
  }

  return [...seen.values()];
}

function hasDistributionParent(
  record: CpanDistributionRecord,
  records: CpanDistributionRecord[]
): boolean {
  const providedModules = new Set(record.provides);
  return records.some((candidate) =>
    candidate.id !== record.id
    && candidate.requirements.some((requiredModule) => providedModules.has(requiredModule))
  );
}

function cpanDistributionPaths(input: {
  record: CpanDistributionRecord;
  records: CpanDistributionRecord[];
  rootName: string;
  visiting?: Set<string>;
}): string[][] {
  const providedModules = new Set(input.record.provides);
  const parentRecords = input.records.filter((candidate) =>
    candidate.id !== input.record.id
    && candidate.requirements.some((requiredModule) => providedModules.has(requiredModule))
  );
  if (parentRecords.length === 0) {
    return [[input.rootName, input.record.id]];
  }

  const visiting = input.visiting ?? new Set<string>();
  if (visiting.has(input.record.id)) {
    return [[input.rootName, input.record.id]];
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(input.record.id);

  return deduplicatePaths(parentRecords.flatMap((parent) =>
    cpanDistributionPaths({
      record: parent,
      records: input.records,
      rootName: input.rootName,
      visiting: nextVisiting
    }).map((parentPath) => [...parentPath, input.record.id])
  ));
}

function deduplicatePaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];
  for (const item of paths) {
    const key = item.join("\0");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function cpanfileSnapshotShapeError(
  lockfilePath: string,
  reason: string,
  entry?: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "CPANFILE_SNAPSHOT_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse cpanfile.snapshot. Ohrisk supports Carton snapshot v1 DISTRIBUTIONS entries.",
      details: {
        lockfilePath,
        reason,
        ...(entry === undefined ? {} : { entry })
      }
    })
  );
}
