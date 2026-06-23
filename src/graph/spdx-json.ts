import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { LicenseEvidence } from "../evidence/types";
import { parsePackageUrl } from "./package-url";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type SpdxPackageRecord = {
  spdxId: string;
  name: string;
  version: string;
  id: string;
  ecosystem: DependencyNode["ecosystem"];
  licenseExpression?: string;
};

export function parseSpdxJsonFile(
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
        code: "SPDX_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "SPDX JSON input exceeded the maximum supported size."
          : "Failed to read SPDX JSON input.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseSpdxJsonText(lockfileText.value, lockfilePath);
}

export function parseSpdxJsonText(
  input: string,
  lockfilePath = "spdx.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseSpdxJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  return parseSpdxDocument(parsed.value, lockfilePath);
}

export function parseSpdxDocument(
  document: unknown,
  lockfilePath: string
): Result<DependencyGraph, OhriskError> {
  if (!isRecord(document) || !Array.isArray(document.packages)) {
    return spdxShapeError(lockfilePath);
  }

  const packages = readSpdxPackageRecords(document.packages);
  if (packages.length === 0) {
    return spdxShapeError(lockfilePath);
  }

  const dependencyMap = readSpdxDependencyMap(document.relationships, packages);
  const rootName = typeof document.name === "string" && document.name !== ""
    ? document.name
    : "<spdx-project>";
  const rootRefs = readSpdxRootRefs({
    document,
    packages,
    dependencyMap
  });
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootRef of rootRefs) {
    const record = packages.find((pkg) => pkg.spdxId === rootRef);
    if (!record) {
      continue;
    }

    walkSpdxDependency({
      record,
      dependencyType: "production",
      direct: true,
      path: [rootName],
      packages,
      dependencyMap,
      nodeMap,
      seen: new Set()
    });
  }

  const nodes = [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  return ok({
    rootName,
    lockfilePath,
    nodes,
    embeddedEvidence: packages
      .filter((pkg) => nodeIds.has(pkg.id))
      .map(spdxPackageEvidence)
  });
}

function parseSpdxJson(
  input: string,
  lockfilePath: string
): Result<unknown, OhriskError> {
  try {
    return ok(JSON.parse(input) as unknown);
  } catch (cause) {
    return err(
      createError({
        code: "SPDX_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse SPDX JSON input.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readSpdxPackageRecords(value: unknown[]): SpdxPackageRecord[] {
  const records: SpdxPackageRecord[] = [];
  for (const pkg of value) {
    if (!isRecord(pkg) || typeof pkg.SPDXID !== "string") {
      continue;
    }

    const purl = readSpdxPackageUrl(pkg.externalRefs);
    if (!purl) {
      continue;
    }

    records.push({
      spdxId: pkg.SPDXID,
      name: purl.name,
      version: purl.version,
      id: purl.id,
      ecosystem: purl.ecosystem,
      ...(readSpdxPackageLicenseExpression(pkg) ? {
        licenseExpression: readSpdxPackageLicenseExpression(pkg)
      } : {})
    });
  }

  return deduplicateSpdxPackageRecords(records);
}

function readSpdxPackageUrl(value: unknown): ReturnType<typeof parsePackageUrl> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const ref of value) {
    if (
      !isRecord(ref)
      || ref.referenceCategory !== "PACKAGE-MANAGER"
      || ref.referenceType !== "purl"
      || typeof ref.referenceLocator !== "string"
    ) {
      continue;
    }

    const purl = parsePackageUrl(ref.referenceLocator);
    if (purl) {
      return purl;
    }
  }

  return undefined;
}

function readSpdxPackageLicenseExpression(pkg: Record<string, unknown>): string | undefined {
  const concluded = readMeaningfulSpdxLicenseValue(pkg.licenseConcluded);
  if (concluded) {
    return concluded;
  }

  return readMeaningfulSpdxLicenseValue(pkg.licenseDeclared);
}

function readMeaningfulSpdxLicenseValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  const normalized = trimmed.toUpperCase();
  if (trimmed === "" || normalized === "NOASSERTION" || normalized === "NONE") {
    return undefined;
  }

  return trimmed;
}

function readSpdxDependencyMap(
  value: unknown,
  packages: SpdxPackageRecord[]
): Map<string, string[]> {
  const packageIds = new Set(packages.map((pkg) => pkg.spdxId));
  const dependencyMap = new Map<string, string[]>();
  if (!Array.isArray(value)) {
    return dependencyMap;
  }

  const addEdge = (parent: string, child: string): void => {
    if (!packageIds.has(parent) || !packageIds.has(child) || parent === child) {
      return;
    }

    dependencyMap.set(parent, [
      ...new Set([...(dependencyMap.get(parent) ?? []), child])
    ]);
  };

  for (const relationship of value) {
    if (
      !isRecord(relationship)
      || typeof relationship.spdxElementId !== "string"
      || typeof relationship.relatedSpdxElement !== "string"
      || typeof relationship.relationshipType !== "string"
    ) {
      continue;
    }

    if (relationship.relationshipType === "DEPENDS_ON") {
      addEdge(relationship.spdxElementId, relationship.relatedSpdxElement);
    }

    if (relationship.relationshipType === "DEPENDENCY_OF") {
      addEdge(relationship.relatedSpdxElement, relationship.spdxElementId);
    }
  }

  return dependencyMap;
}

function readSpdxRootRefs(input: {
  document: Record<string, unknown>;
  packages: SpdxPackageRecord[];
  dependencyMap: Map<string, string[]>;
}): string[] {
  const packageIds = new Set(input.packages.map((pkg) => pkg.spdxId));
  const roots = new Set<string>();

  if (Array.isArray(input.document.documentDescribes)) {
    for (const ref of input.document.documentDescribes) {
      if (typeof ref === "string" && packageIds.has(ref)) {
        roots.add(ref);
      }
    }
  }

  if (Array.isArray(input.document.relationships)) {
    for (const relationship of input.document.relationships) {
      if (
        isRecord(relationship)
        && relationship.relationshipType === "DESCRIBES"
        && typeof relationship.relatedSpdxElement === "string"
        && packageIds.has(relationship.relatedSpdxElement)
      ) {
        roots.add(relationship.relatedSpdxElement);
      }
    }
  }

  if (roots.size > 0) {
    return [...roots].sort();
  }

  const referenced = new Set<string>();
  for (const children of input.dependencyMap.values()) {
    for (const child of children) {
      referenced.add(child);
    }
  }

  const inferredRoots = input.packages
    .map((pkg) => pkg.spdxId)
    .filter((spdxId) => !referenced.has(spdxId))
    .sort();

  return inferredRoots.length > 0
    ? inferredRoots
    : input.packages.map((pkg) => pkg.spdxId).sort();
}

function walkSpdxDependency(input: {
  record: SpdxPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  packages: SpdxPackageRecord[];
  dependencyMap: Map<string, string[]>;
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (input.seen.has(input.record.spdxId)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.spdxId);
  const nextPath = [...input.path, input.record.id];
  const existing = input.nodeMap.get(input.record.id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: input.record.ecosystem,
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const childRef of input.dependencyMap.get(input.record.spdxId) ?? []) {
    const child = input.packages.find((pkg) => pkg.spdxId === childRef);
    if (!child) {
      continue;
    }

    walkSpdxDependency({
      record: child,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      packages: input.packages,
      dependencyMap: input.dependencyMap,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function spdxPackageEvidence(record: SpdxPackageRecord): LicenseEvidence {
  return {
    packageId: record.id,
    ...(record.licenseExpression ? { metadataLicense: record.licenseExpression } : {}),
    metadataSource: "SPDX",
    files: [],
    source: "sbom",
    warnings: record.licenseExpression
      ? []
      : ["SPDX package did not declare usable license evidence."]
  };
}

function deduplicateSpdxPackageRecords(records: SpdxPackageRecord[]): SpdxPackageRecord[] {
  const seen = new Map<string, SpdxPackageRecord>();
  for (const record of records) {
    const existing = seen.get(record.spdxId);
    seen.set(record.spdxId, existing
      ? {
          ...existing,
          licenseExpression: existing.licenseExpression ?? record.licenseExpression
        }
      : record);
  }

  return [...seen.values()];
}

function spdxShapeError(lockfilePath: string): Result<never, OhriskError> {
  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse SPDX input. Ohrisk expected an SPDX document with package entries and Package URL external refs.",
      details: {
        lockfilePath
      }
    })
  );
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  return dependencyTypeRank(left) >= dependencyTypeRank(right) ? left : right;
}

function dependencyTypeRank(type: DependencyType): number {
  switch (type) {
    case "production":
      return 4;
    case "optional":
      return 3;
    case "peer":
      return 2;
    case "development":
      return 1;
    case "unknown":
      return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
