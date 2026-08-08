import { omitUndefined } from "../shared/object";
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
import {
  collectBoundedDependencyPaths,
  type BoundedPathLimits
} from "./bounded-dependency-paths";
import type {
  DependencyGraph,
  DependencyNode
} from "./types";

type SpdxPackageRecord = {
  spdxId: string;
  name: string;
  version: string;
  id: string;
  ecosystem: DependencyNode["ecosystem"];
  licenseExpression?: string;
};

type UnsupportedSpdxDependencyField = "relationships" | "spdxElementId" | "relatedSpdxElement";
type UnsupportedSpdxRelationshipReason =
  | "unsupported_spdx_dependency_relationships"
  | "unsupported_spdx_describes_relationships"
  | "unsupported_spdx_relationships";

export function parseSpdxJsonFile(
  lockfilePath: string,
  options: { maxBytes?: number; limits?: Partial<BoundedPathLimits> } = {}
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

  return parseSpdxJsonText(lockfileText.value, lockfilePath, {
    limits: options.limits
  });
}

export function parseSpdxJsonText(
  input: string,
  lockfilePath = "spdx.json",
  options: { limits?: Partial<BoundedPathLimits> } = {}
): Result<DependencyGraph, OhriskError> {
  const parsed = parseSpdxJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  return parseSpdxDocument(parsed.value, lockfilePath, options);
}

export function parseSpdxDocument(
  document: unknown,
  lockfilePath: string,
  options: { limits?: Partial<BoundedPathLimits> } = {}
): Result<DependencyGraph, OhriskError> {
  if (!isRecord(document) || !Array.isArray(document.packages)) {
    return spdxShapeError(lockfilePath);
  }

  const packages = readSpdxPackageRecords(document.packages);
  if (packages.length === 0) {
    return spdxShapeError(lockfilePath);
  }

  const dependencyMap = readSpdxDependencyMap(document.relationships, packages);
  if (!dependencyMap.ok) {
    return unsupportedSpdxDependencyError(lockfilePath, dependencyMap.error);
  }

  const rootName = typeof document.name === "string" && document.name !== ""
    ? document.name
    : "<spdx-project>";
  const rootRefs = readSpdxRootRefs({
    document,
    packages,
    dependencyMap: dependencyMap.value
  });
  const pathCollection = collectBoundedDependencyPaths({
    rootName,
    rootRefs,
    childRefs: (nodeKey) => dependencyMap.value.get(nodeKey) ?? [],
    pathNoun: "package",
    limits: options.limits
  });
  if (!pathCollection.ok) {
    return err(pathCollection.error);
  }
  const nodeMap = new Map<string, DependencyNode>();
  const packagesBySpdxId = new Map(packages.map((pkg) => [pkg.spdxId, pkg]));
  const rootRefSet = new Set(pathCollection.value.rootRefs);
  for (const nodeKey of pathCollection.value.discoveredNodeKeys) {
    const record = packagesBySpdxId.get(nodeKey);
    if (!record) {
      continue;
    }

    const rawPaths = pathCollection.value.pathsByNode.get(nodeKey);
    const paths = rawPaths
      ? rawPaths.map((item) => item.map((segment) => {
      const segmentRecord = packagesBySpdxId.get(segment);
      return segmentRecord ? segmentRecord.id : segment;
      }))
      : rootRefSet.has(nodeKey)
        ? [[rootName]]
        : [];
    const existing = nodeMap.get(record.id);
    if (existing) {
      existing.direct = existing.direct || paths.some((item) => item.length === 2);
      existing.paths.push(...paths);
    } else {
      nodeMap.set(record.id, {
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: record.ecosystem,
        dependencyType: "production",
        direct: paths.some((item) => item.length === 2),
        paths: [...paths]
      });
    }
  }
  for (const node of nodeMap.values()) {
    node.paths.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
  }
  const diagnostics = pathCollection.value.diagnostics;

  const nodes = [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  return ok({
    rootName,
    lockfilePath,
    nodes,
    ...(diagnostics.length > 0
      ? { diagnostics }
      : {}),
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

    records.push(omitUndefined({
      spdxId: pkg.SPDXID,
      name: purl.name,
      version: purl.version,
      id: purl.id,
      ecosystem: purl.ecosystem,
      ...(readSpdxPackageLicenseExpression(pkg) ? {
        licenseExpression: readSpdxPackageLicenseExpression(pkg)
      } : {})
    }));
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
): Result<Map<string, string[]>, {
  reason?: UnsupportedSpdxRelationshipReason;
  relationshipIndexes: number[];
  unsupportedRelationshipFields: UnsupportedSpdxDependencyField[];
}> {
  const packageIds = new Set(packages.map((pkg) => pkg.spdxId));
  const dependencyMap = new Map<string, string[]>();
  if (value === undefined) {
    return ok(dependencyMap);
  }
  if (!Array.isArray(value)) {
    return err({
      relationshipIndexes: [],
      unsupportedRelationshipFields: ["relationships"]
    });
  }

  const addEdge = (parent: string, child: string): void => {
    if (!packageIds.has(parent) || !packageIds.has(child) || parent === child) {
      return;
    }

    dependencyMap.set(parent, [
      ...new Set([...(dependencyMap.get(parent) ?? []), child])
    ]);
  };

  const unsupportedIndexes = new Set<number>();
  const unsupportedFields = new Set<UnsupportedSpdxDependencyField>();
  const unsupportedReasons = new Set<UnsupportedSpdxRelationshipReason>();
  for (const [index, relationship] of value.entries()) {
    if (
      isRecord(relationship)
      && (relationship.relationshipType === "DEPENDS_ON"
        || relationship.relationshipType === "DEPENDENCY_OF")
    ) {
      if (typeof relationship.spdxElementId !== "string") {
        unsupportedIndexes.add(index);
        unsupportedFields.add("spdxElementId");
      }

      if (typeof relationship.relatedSpdxElement !== "string") {
        unsupportedIndexes.add(index);
        unsupportedFields.add("relatedSpdxElement");
      }

      if (unsupportedIndexes.has(index)) {
        unsupportedReasons.add("unsupported_spdx_dependency_relationships");
      }
    }

    if (isRecord(relationship) && relationship.relationshipType === "DESCRIBES") {
      if (typeof relationship.spdxElementId !== "string") {
        unsupportedIndexes.add(index);
        unsupportedFields.add("spdxElementId");
      }

      if (typeof relationship.relatedSpdxElement !== "string") {
        unsupportedIndexes.add(index);
        unsupportedFields.add("relatedSpdxElement");
      }

      if (unsupportedIndexes.has(index)) {
        unsupportedReasons.add("unsupported_spdx_describes_relationships");
      }
    }

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

  if (unsupportedIndexes.size > 0) {
    return err(omitUndefined({
      reason: unsupportedReasons.size === 1
        ? [...unsupportedReasons][0]
        : "unsupported_spdx_relationships",
      relationshipIndexes: [...unsupportedIndexes].sort((left, right) => left - right),
      unsupportedRelationshipFields: [...unsupportedFields].sort()
    }));
  }

  return ok(dependencyMap);
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
      ? omitUndefined({
          ...existing,
          licenseExpression: existing.licenseExpression ?? record.licenseExpression
        })
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

function unsupportedSpdxDependencyError(
  lockfilePath: string,
  details: {
    reason?: UnsupportedSpdxRelationshipReason;
    relationshipIndexes: number[];
    unsupportedRelationshipFields: UnsupportedSpdxDependencyField[];
  }
): Result<never, OhriskError> {
  const {
    reason = "unsupported_spdx_dependency_relationships",
    ...structuredDetails
  } = details;

  return err(
    createError({
      code: "SPDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse SPDX relationships. Ohrisk supports array relationships with complete string SPDX references.",
      details: {
        lockfilePath,
        reason,
        ...structuredDetails
      }
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
