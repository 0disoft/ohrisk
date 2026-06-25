import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { parsePackageUrl } from "./package-url";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph, DependencyNode, DependencyType, PackageEcosystem } from "./types";

type CycloneDxComponentRecord = {
  ref: string;
  aliases: string[];
  name: string;
  version: string;
  id: string;
  ecosystem: PackageEcosystem;
  dependencyType: DependencyType;
  licenseExpressions: string[];
};

type UnsupportedCycloneDxDependencyField = "dependencies" | "dependsOn" | "entry" | "ref";
type UnsupportedCycloneDxDependencyValueKind = "array" | "boolean" | "null" | "number" | "object";

export function parseCycloneDxJsonFile(
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
        code: "CYCLONEDX_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "CycloneDX JSON input exceeded the maximum supported size."
          : "Failed to read CycloneDX JSON input.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseCycloneDxJsonText(lockfileText.value, lockfilePath);
}

export function parseCycloneDxJsonText(
  input: string,
  lockfilePath = "cyclonedx.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseCycloneDxJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  return parseCycloneDxDocument(parsed.value, lockfilePath);
}

export function parseCycloneDxDocument(
  bom: unknown,
  lockfilePath: string
): Result<DependencyGraph, OhriskError> {
  if (!isRecord(bom) || bom.bomFormat !== "CycloneDX") {
    return cycloneDxShapeError(lockfilePath);
  }

  const components = readCycloneDxComponentRecords(bom.components);
  if (components.length === 0) {
    return cycloneDxShapeError(lockfilePath);
  }

  const aliases = buildComponentAliasMap(components);
  const dependencyMap = readCycloneDxDependencyMap(bom.dependencies, aliases);
  if (!dependencyMap.ok) {
    return unsupportedCycloneDxDependencyError(lockfilePath, dependencyMap.error);
  }

  const rootName = readCycloneDxRootName(bom) ?? "<cyclonedx-project>";
  const rootRefs = readCycloneDxRootRefs({
    bom,
    components,
    aliases,
    dependencyMap: dependencyMap.value
  });
  const nodeMap = new Map<string, DependencyNode>();

  for (const rootRef of rootRefs) {
    const record = components.find((component) => component.ref === rootRef);
    if (!record) {
      continue;
    }

    walkCycloneDxDependency({
      record,
      dependencyType: record.dependencyType,
      direct: true,
      path: [rootName],
      components,
      dependencyMap: dependencyMap.value,
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
    embeddedEvidence: components
      .filter((component) => nodeIds.has(component.id))
      .map(cycloneDxComponentEvidence)
  });
}

function parseCycloneDxJson(
  input: string,
  lockfilePath: string
): Result<unknown, OhriskError> {
  try {
    return ok(JSON.parse(input) as unknown);
  } catch (cause) {
    return err(
      createError({
        code: "CYCLONEDX_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse CycloneDX JSON input.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readCycloneDxComponentRecords(value: unknown): CycloneDxComponentRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const records: CycloneDxComponentRecord[] = [];
  for (const component of value) {
    if (!isRecord(component)) {
      continue;
    }

    const purl = typeof component.purl === "string"
      ? parsePackageUrl(component.purl)
      : undefined;
    const fallback = readCycloneDxFallbackIdentity(component);
    const identity = purl ?? fallback;
    if (!identity) {
      continue;
    }

    const ref = typeof component["bom-ref"] === "string" && component["bom-ref"] !== ""
      ? component["bom-ref"]
      : typeof component.purl === "string" && component.purl !== ""
        ? component.purl
        : identity.id;

    records.push({
      ref,
      aliases: [
        ref,
        ...(typeof component.purl === "string" ? [component.purl] : []),
        identity.id
      ],
      name: identity.name,
      version: identity.version,
      id: identity.id,
      ecosystem: identity.ecosystem,
      dependencyType: readCycloneDxDependencyType(component),
      licenseExpressions: readCycloneDxLicenseExpressions(component.licenses)
    });
  }

  return deduplicateCycloneDxRecords(records);
}

function readCycloneDxFallbackIdentity(
  component: Record<string, unknown>
): {
  ecosystem: PackageEcosystem;
  name: string;
  version: string;
  id: string;
} | undefined {
  const ecosystem = readOhriskEcosystem(component.properties);
  if (!ecosystem || typeof component.name !== "string" || typeof component.version !== "string") {
    return undefined;
  }

  return {
    ecosystem,
    name: component.name,
    version: component.version,
    id: `${component.name}@${component.version}`
  };
}

function readOhriskEcosystem(properties: unknown): PackageEcosystem | undefined {
  if (!Array.isArray(properties)) {
    return undefined;
  }

  const property = properties.find((item) =>
    isRecord(item)
    && item.name === "ohrisk:ecosystem"
    && typeof item.value === "string"
  );
  if (!isRecord(property) || typeof property.value !== "string") {
    return undefined;
  }

  switch (property.value) {
    case "npm":
    case "pypi":
    case "maven":
    case "cargo":
    case "go":
    case "nuget":
    case "conan":
    case "conda":
    case "vcpkg":
    case "bazel":
    case "terraform":
    case "helm":
    case "nix":
    case "unity":
    case "cran":
    case "julia":
    case "carthage":
    case "cocoapods":
    case "hex":
    case "gem":
    case "composer":
    case "pub":
    case "swift":
      return property.value;
    default:
      return undefined;
  }
}

function readCycloneDxDependencyType(component: Record<string, unknown>): DependencyType {
  const explicit = readOhriskDependencyType(component.properties);
  if (explicit) {
    return explicit;
  }

  switch (component.scope) {
    case "excluded":
      return "development";
    case "optional":
      return "optional";
    case "required":
    default:
      return "production";
  }
}

function readOhriskDependencyType(properties: unknown): DependencyType | undefined {
  if (!Array.isArray(properties)) {
    return undefined;
  }

  const property = properties.find((item) =>
    isRecord(item)
    && item.name === "ohrisk:dependencyType"
    && typeof item.value === "string"
  );
  if (!isRecord(property) || typeof property.value !== "string") {
    return undefined;
  }

  return isDependencyType(property.value) ? property.value : undefined;
}

function readCycloneDxLicenseExpressions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const expressions: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    if (typeof entry.expression === "string" && entry.expression.trim() !== "") {
      expressions.push(entry.expression.trim());
      continue;
    }

    if (!isRecord(entry.license)) {
      continue;
    }

    if (typeof entry.license.id === "string" && entry.license.id.trim() !== "") {
      expressions.push(entry.license.id.trim());
      continue;
    }

    if (typeof entry.license.name === "string" && entry.license.name.trim() !== "") {
      expressions.push(entry.license.name.trim());
    }
  }

  return [...new Set(expressions)];
}

function buildComponentAliasMap(records: CycloneDxComponentRecord[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const record of records) {
    for (const alias of record.aliases) {
      aliases.set(alias, record.ref);
    }
  }

  return aliases;
}

function readCycloneDxDependencyMap(
  value: unknown,
  aliases: Map<string, string>
): Result<Map<string, string[]>, {
  dependencyEntryIndexes: number[];
  unsupportedDependencyFields?: UnsupportedCycloneDxDependencyField[];
  unsupportedDependencyValueKinds?: UnsupportedCycloneDxDependencyValueKind[];
}> {
  const dependencyMap = new Map<string, string[]>();
  if (value === undefined) {
    return ok(dependencyMap);
  }
  if (!Array.isArray(value)) {
    return err({
      dependencyEntryIndexes: [],
      unsupportedDependencyFields: ["dependencies"]
    });
  }

  const unsupportedEntryIndexes = new Set<number>();
  const unsupportedFields = new Set<UnsupportedCycloneDxDependencyField>();
  const unsupportedValueKinds = new Set<UnsupportedCycloneDxDependencyValueKind>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      unsupportedEntryIndexes.add(index);
      unsupportedFields.add("entry");
      continue;
    }

    const hasUnsupportedShape = typeof entry.ref !== "string" || !Array.isArray(entry.dependsOn);
    if (typeof entry.ref !== "string") {
      unsupportedEntryIndexes.add(index);
      unsupportedFields.add("ref");
    }
    if (!Array.isArray(entry.dependsOn)) {
      unsupportedEntryIndexes.add(index);
      unsupportedFields.add("dependsOn");
    }
    if (hasUnsupportedShape) {
      continue;
    }

    for (const child of entry.dependsOn) {
      if (typeof child !== "string") {
        unsupportedEntryIndexes.add(index);
        unsupportedValueKinds.add(cycloneDxDependencyValueKind(child));
      }
    }

    const parentRef = aliases.get(entry.ref) ?? entry.ref;
    const childRefs = entry.dependsOn
      .filter((child): child is string => typeof child === "string")
      .map((child) => aliases.get(child) ?? child)
      .filter((child, index, all) => child !== parentRef && all.indexOf(child) === index);
    dependencyMap.set(parentRef, [
      ...new Set([...(dependencyMap.get(parentRef) ?? []), ...childRefs])
    ]);
  }

  if (unsupportedEntryIndexes.size > 0) {
    const errorDetails: {
      dependencyEntryIndexes: number[];
      unsupportedDependencyFields?: UnsupportedCycloneDxDependencyField[];
      unsupportedDependencyValueKinds?: UnsupportedCycloneDxDependencyValueKind[];
    } = {
      dependencyEntryIndexes: [...unsupportedEntryIndexes].sort((left, right) => left - right)
    };

    if (unsupportedFields.size > 0) {
      errorDetails.unsupportedDependencyFields = [...unsupportedFields].sort();
    }
    if (unsupportedValueKinds.size > 0) {
      errorDetails.unsupportedDependencyValueKinds = [...unsupportedValueKinds].sort();
    }

    return err(errorDetails);
  }

  return ok(dependencyMap);
}

function readCycloneDxRootRefs(input: {
  bom: Record<string, unknown>;
  components: CycloneDxComponentRecord[];
  aliases: Map<string, string>;
  dependencyMap: Map<string, string[]>;
}): string[] {
  const componentRefs = new Set(input.components.map((component) => component.ref));
  const roots = new Set<string>();
  const metadataRef = readCycloneDxMetadataComponentRef(input.bom);

  if (metadataRef) {
    const canonicalMetadataRef = input.aliases.get(metadataRef) ?? metadataRef;
    for (const ref of input.dependencyMap.get(canonicalMetadataRef) ?? []) {
      if (componentRefs.has(ref)) {
        roots.add(ref);
      }
    }
  }

  for (const [ref, children] of input.dependencyMap) {
    if (componentRefs.has(ref)) {
      continue;
    }

    for (const child of children) {
      if (componentRefs.has(child)) {
        roots.add(child);
      }
    }
  }

  if (roots.size > 0) {
    return [...roots].sort();
  }

  const referenced = new Set<string>();
  for (const [parent, children] of input.dependencyMap) {
    if (!componentRefs.has(parent)) {
      continue;
    }

    for (const child of children) {
      if (componentRefs.has(child)) {
        referenced.add(child);
      }
    }
  }

  const inferredRoots = input.components
    .map((component) => component.ref)
    .filter((ref) => !referenced.has(ref))
    .sort();

  return inferredRoots.length > 0
    ? inferredRoots
    : input.components.map((component) => component.ref).sort();
}

function readCycloneDxMetadataComponentRef(bom: Record<string, unknown>): string | undefined {
  if (!isRecord(bom.metadata) || !isRecord(bom.metadata.component)) {
    return undefined;
  }

  const component = bom.metadata.component;
  return typeof component["bom-ref"] === "string"
    ? component["bom-ref"]
    : typeof component.purl === "string"
      ? component.purl
      : undefined;
}

function readCycloneDxRootName(bom: Record<string, unknown>): string | undefined {
  if (!isRecord(bom.metadata) || !isRecord(bom.metadata.component)) {
    return undefined;
  }

  const component = bom.metadata.component;
  return typeof component.name === "string" && component.name !== ""
    ? component.name
    : undefined;
}

function walkCycloneDxDependency(input: {
  record: CycloneDxComponentRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  components: CycloneDxComponentRecord[];
  dependencyMap: Map<string, string[]>;
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (input.seen.has(input.record.ref)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.ref);
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

  for (const childRef of input.dependencyMap.get(input.record.ref) ?? []) {
    const child = input.components.find((component) => component.ref === childRef);
    if (!child) {
      continue;
    }

    walkCycloneDxDependency({
      record: child,
      dependencyType: dependencyTypeForChildEdge(input.dependencyType, child.dependencyType),
      direct: false,
      path: nextPath,
      components: input.components,
      dependencyMap: input.dependencyMap,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function cycloneDxComponentEvidence(record: CycloneDxComponentRecord): LicenseEvidence {
  return {
    packageId: record.id,
    ...(record.licenseExpressions.length === 1
      ? { metadataLicense: record.licenseExpressions[0] }
      : {}),
    ...(record.licenseExpressions.length > 1
      ? { metadataLicenses: record.licenseExpressions }
      : {}),
    metadataSource: "CycloneDX",
    files: [],
    source: "sbom",
    warnings: record.licenseExpressions.length === 0
      ? ["CycloneDX component did not declare license evidence."]
      : []
  };
}

function deduplicateCycloneDxRecords(
  records: CycloneDxComponentRecord[]
): CycloneDxComponentRecord[] {
  const seen = new Map<string, CycloneDxComponentRecord>();
  for (const record of records) {
    const existing = seen.get(record.ref);
    seen.set(record.ref, existing
      ? {
          ...existing,
          aliases: [...new Set([...existing.aliases, ...record.aliases])],
          dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
          licenseExpressions: [...new Set([
            ...existing.licenseExpressions,
            ...record.licenseExpressions
          ])]
        }
      : record);
  }

  return [...seen.values()];
}

function cycloneDxShapeError(lockfilePath: string): Result<never, OhriskError> {
  return err(
    createError({
      code: "CYCLONEDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse CycloneDX input. Ohrisk expected a CycloneDX document with component entries.",
      details: {
        lockfilePath
      }
    })
  );
}

function unsupportedCycloneDxDependencyError(
  lockfilePath: string,
  details: {
    dependencyEntryIndexes: number[];
    unsupportedDependencyFields?: UnsupportedCycloneDxDependencyField[];
    unsupportedDependencyValueKinds?: UnsupportedCycloneDxDependencyValueKind[];
  }
): Result<never, OhriskError> {
  return err(
    createError({
      code: "CYCLONEDX_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse CycloneDX dependency entries. Ohrisk supports array dependencies with object entries, string refs, and string dependsOn references.",
      details: {
        lockfilePath,
        reason: "unsupported_cyclonedx_dependency_entries",
        ...details
      }
    })
  );
}

function cycloneDxDependencyValueKind(value: unknown): UnsupportedCycloneDxDependencyValueKind {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    default:
      return "object";
  }
}

function dependencyTypeForChildEdge(
  parentType: DependencyType,
  childType: DependencyType
): DependencyType {
  return parentType === "production" ? childType : parentType;
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

function isDependencyType(value: string): value is DependencyType {
  return value === "production"
    || value === "development"
    || value === "optional"
    || value === "peer"
    || value === "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
