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
import type {
  DependencyGraph,
  DependencyGraphDiagnostic,
  DependencyNode,
  DependencyType,
  PackageEcosystem
} from "./types";

export const CYCLONEDX_MAX_PATHS_PER_COMPONENT = 64;
export const CYCLONEDX_MAX_DEPENDENCY_DEPTH = 256;

const CYCLONEDX_TRUNCATED_PATH_SEGMENT = "<cyclonedx-path-truncated>";

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
  const traversal = traverseCycloneDxDependencies({
    rootName,
    rootRefs,
    components,
    dependencyMap: dependencyMap.value
  });
  const nodeMap = traversal.nodeMap;

  const nodes = [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  const nodeIds = new Set(nodes.map((node) => node.id));

  return ok({
    rootName,
    lockfilePath,
    nodes,
    embeddedEvidence: components
      .filter((component) => nodeIds.has(component.id))
      .map(cycloneDxComponentEvidence),
    ...(traversal.diagnostics.length > 0
      ? { diagnostics: traversal.diagnostics }
      : {})
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

    const ref = entry.ref;
    const dependsOn = entry.dependsOn;
    if (typeof ref !== "string") {
      unsupportedEntryIndexes.add(index);
      unsupportedFields.add("ref");
    }
    if (!Array.isArray(dependsOn)) {
      unsupportedEntryIndexes.add(index);
      unsupportedFields.add("dependsOn");
    }
    if (typeof ref !== "string" || !Array.isArray(dependsOn)) {
      continue;
    }

    for (const child of dependsOn) {
      if (typeof child !== "string") {
        unsupportedEntryIndexes.add(index);
        unsupportedValueKinds.add(cycloneDxDependencyValueKind(child));
      }
    }

    const parentRef = aliases.get(ref) ?? ref;
    const childRefs = dependsOn
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

function traverseCycloneDxDependencies(input: {
  rootName: string;
  rootRefs: string[];
  components: CycloneDxComponentRecord[];
  dependencyMap: Map<string, string[]>;
}): {
  nodeMap: Map<string, DependencyNode>;
  diagnostics: DependencyGraphDiagnostic[];
} {
  const componentsByRef = new Map(input.components.map((component) => [component.ref, component]));
  const directRefs = new Set(input.rootRefs);
  const dependencyTypesByRef = resolveCycloneDxDependencyTypes({
    rootRefs: input.rootRefs,
    componentsByRef,
    dependencyMap: input.dependencyMap
  });
  const nodeMap = new Map<string, DependencyNode>();

  for (const [ref, dependencyType] of dependencyTypesByRef) {
    const record = componentsByRef.get(ref);
    if (!record) {
      continue;
    }

    const existing = nodeMap.get(record.id);
    if (existing) {
      existing.direct = existing.direct || directRefs.has(ref);
      existing.dependencyType = mergeDependencyType(existing.dependencyType, dependencyType);
      continue;
    }

    nodeMap.set(record.id, {
      id: record.id,
      name: record.name,
      version: record.version,
      ecosystem: record.ecosystem,
      dependencyType,
      direct: directRefs.has(ref),
      paths: []
    });
  }

  const pathLimitAffected = new Set<string>();
  const depthLimitAffected = new Set<string>();
  const pathKeysByNodeId = new Map<string, Set<string>>();

  for (const rootRef of input.rootRefs) {
    const stack: Array<{
      ref: string;
      pathIds: string[];
      pathRefs: string[];
    }> = [{ ref: rootRef, pathIds: [input.rootName], pathRefs: [] }];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current.pathRefs.includes(current.ref)) {
        continue;
      }

      const record = componentsByRef.get(current.ref);
      if (!record) {
        continue;
      }

      const componentDepth = current.pathRefs.length + 1;
      if (componentDepth > CYCLONEDX_MAX_DEPENDENCY_DEPTH) {
        depthLimitAffected.add(record.id);
        continue;
      }

      const nextPath = [...current.pathIds, record.id];
      const pathKey = nextPath.join("\u0000");
      const pathKeys = pathKeysByNodeId.get(record.id) ?? new Set<string>();
      if (pathKeys.has(pathKey)) {
        continue;
      }

      if (pathKeys.size >= CYCLONEDX_MAX_PATHS_PER_COMPONENT) {
        pathLimitAffected.add(record.id);
        continue;
      }

      pathKeys.add(pathKey);
      pathKeysByNodeId.set(record.id, pathKeys);
      nodeMap.get(record.id)?.paths.push(nextPath);

      const nextPathRefs = [...current.pathRefs, current.ref];
      const childRefs = input.dependencyMap.get(current.ref) ?? [];
      for (let index = childRefs.length - 1; index >= 0; index -= 1) {
        const childRef = childRefs[index];
        if (!childRef) {
          continue;
        }

        stack.push({
          ref: childRef,
          pathIds: nextPath,
          pathRefs: nextPathRefs
        });
      }
    }
  }

  for (const node of nodeMap.values()) {
    if (node.paths.length > 0) {
      continue;
    }

    node.paths.push([input.rootName, CYCLONEDX_TRUNCATED_PATH_SEGMENT, node.id]);
    depthLimitAffected.add(node.id);
  }

  const diagnostics: DependencyGraphDiagnostic[] = [];
  if (pathLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: pathLimitAffected.size,
      limit: CYCLONEDX_MAX_PATHS_PER_COMPONENT,
      message: `CycloneDX dependency paths were limited to ${CYCLONEDX_MAX_PATHS_PER_COMPONENT} paths per component.`
    });
  }
  if (depthLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_path_depth_summarized",
      affectedNodeCount: depthLimitAffected.size,
      limit: CYCLONEDX_MAX_DEPENDENCY_DEPTH,
      message: `CycloneDX dependency paths deeper than ${CYCLONEDX_MAX_DEPENDENCY_DEPTH} components were summarized.`
    });
  }

  return { nodeMap, diagnostics };
}

function resolveCycloneDxDependencyTypes(input: {
  rootRefs: string[];
  componentsByRef: Map<string, CycloneDxComponentRecord>;
  dependencyMap: Map<string, string[]>;
}): Map<string, DependencyType> {
  const resolved = new Map<string, DependencyType>();
  const queue: Array<{ ref: string; dependencyType: DependencyType }> = input.rootRefs
    .map((ref) => {
      const record = input.componentsByRef.get(ref);
      return record ? { ref, dependencyType: record.dependencyType } : undefined;
    })
    .filter((item): item is { ref: string; dependencyType: DependencyType } => item !== undefined);
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (!current) {
      continue;
    }

    const previous = resolved.get(current.ref);
    const dependencyType = previous
      ? mergeDependencyType(previous, current.dependencyType)
      : current.dependencyType;
    if (previous === dependencyType) {
      continue;
    }
    resolved.set(current.ref, dependencyType);

    for (const childRef of input.dependencyMap.get(current.ref) ?? []) {
      const child = input.componentsByRef.get(childRef);
      if (!child) {
        continue;
      }

      queue.push({
        ref: childRef,
        dependencyType: dependencyTypeForChildEdge(dependencyType, child.dependencyType)
      });
    }
  }

  return resolved;
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
