import type { LicenseEvidence } from "../evidence/types";
import type { ProjectLockfile } from "../project/discover";
import { packageUrl } from "./package-url";
import type {
  DependencyGraph,
  DependencyNode,
  DependencyOrigin,
  DependencyType
} from "./types";

export type SourcedDependencyGraph = {
  graph: DependencyGraph;
  source: {
    lockfileKind: ProjectLockfile["kind"];
    lockfilePath: string;
  };
};

export function mergeDependencyGraphs(graphs: SourcedDependencyGraph[]): DependencyGraph {
  const first = graphs[0];
  if (!first) {
    return { lockfilePath: "", nodes: [] };
  }

  const nodesByPurl = new Map<string, DependencyNode>();
  const canonicalIdByPurl = new Map<string, string>();
  const evidenceByPackageId = new Map<string, LicenseEvidence>();
  const warnings: string[] = [];

  for (const item of graphs) {
    for (const node of item.graph.nodes) {
      const purl = packageUrl(node);
      if (!canonicalIdByPurl.has(purl)) {
        canonicalIdByPurl.set(purl, node.id);
      }
    }
  }

  for (const item of graphs) {
    const idMap = new Map(
      item.graph.nodes.map((node) => [
        node.id,
        canonicalIdByPurl.get(packageUrl(node)) ?? node.id
      ])
    );
    const origin: DependencyOrigin = {
      lockfileKind: item.source.lockfileKind,
      lockfilePath: item.source.lockfilePath
    };

    for (const node of item.graph.nodes) {
      const purl = packageUrl(node);
      const canonicalId = canonicalIdByPurl.get(purl) ?? node.id;
      const remapped = remapNode(node, canonicalId, idMap, origin);
      const existing = nodesByPurl.get(purl);
      if (existing) {
        warnings.push(...artifactConflictWarnings(existing, remapped, purl));
      }
      nodesByPurl.set(purl, existing ? mergeDependencyNode(existing, remapped) : remapped);
    }

    for (const evidence of item.graph.embeddedEvidence ?? []) {
      const packageId = idMap.get(evidence.packageId) ?? evidence.packageId;
      const remapped = { ...evidence, packageId };
      const existing = evidenceByPackageId.get(packageId);
      evidenceByPackageId.set(
        packageId,
        existing ? mergeLicenseEvidence(existing, remapped) : remapped
      );
    }
    warnings.push(...(item.graph.warnings ?? []));
  }

  const lockfilePaths = unique(graphs.map((item) => item.source.lockfilePath));
  const rootNames = unique(
    graphs.flatMap((item) => item.graph.rootName ? [item.graph.rootName] : [])
  );

  return {
    ...(rootNames.length === 1 ? { rootName: rootNames[0] } : {}),
    lockfilePath: first.graph.lockfilePath,
    lockfilePaths,
    nodes: [...nodesByPurl.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(evidenceByPackageId.size > 0
      ? { embeddedEvidence: [...evidenceByPackageId.values()] }
      : {}),
    ...(warnings.length > 0 ? { warnings: unique(warnings) } : {})
  };
}

function remapNode(
  node: DependencyNode,
  canonicalId: string,
  idMap: ReadonlyMap<string, string>,
  origin: DependencyOrigin
): DependencyNode {
  return {
    ...node,
    id: canonicalId,
    paths: node.paths.map((dependencyPath) =>
      dependencyPath.map((segment) => idMap.get(segment) ?? segment)
    ),
    origins: uniqueOrigins([...(node.origins ?? []), origin])
  };
}


function artifactConflictWarnings(
  left: DependencyNode,
  right: DependencyNode,
  purl: string
): string[] {
  const warnings: string[] = [];
  if (left.resolved && right.resolved && left.resolved !== right.resolved) {
    warnings.push(`Multiple lockfiles resolve ${purl} to different artifact locations.`);
  }
  if (left.integrity && right.integrity && left.integrity !== right.integrity) {
    warnings.push(`Multiple lockfiles declare different integrity values for ${purl}.`);
  }
  return warnings;
}

function mergeDependencyNode(left: DependencyNode, right: DependencyNode): DependencyNode {
  return {
    ...left,
    ...(left.resolved ? {} : right.resolved ? { resolved: right.resolved } : {}),
    ...(left.integrity ? {} : right.integrity ? { integrity: right.integrity } : {}),
    ...((left.installNames?.length ?? 0) > 0 || (right.installNames?.length ?? 0) > 0
      ? { installNames: unique([...(left.installNames ?? []), ...(right.installNames ?? [])]) }
      : {}),
    dependencyType: mergeDependencyType(left.dependencyType, right.dependencyType),
    direct: left.direct || right.direct,
    paths: uniquePaths([...left.paths, ...right.paths]),
    origins: uniqueOrigins([...(left.origins ?? []), ...(right.origins ?? [])])
  };
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  const rank: Record<DependencyType, number> = {
    production: 5,
    optional: 4,
    peer: 3,
    unknown: 2,
    development: 1
  };
  return rank[left] >= rank[right] ? left : right;
}

function mergeLicenseEvidence(left: LicenseEvidence, right: LicenseEvidence): LicenseEvidence {
  return {
    ...left,
    ...(left.packageJsonLicense ? {} : right.packageJsonLicense
      ? { packageJsonLicense: right.packageJsonLicense }
      : {}),
    ...(left.packageJsonLicenses !== undefined ? {} : right.packageJsonLicenses !== undefined
      ? { packageJsonLicenses: right.packageJsonLicenses }
      : {}),
    ...(left.metadataLicense ? {} : right.metadataLicense
      ? { metadataLicense: right.metadataLicense }
      : {}),
    ...(left.metadataLicenses !== undefined ? {} : right.metadataLicenses !== undefined
      ? { metadataLicenses: right.metadataLicenses }
      : {}),
    ...(left.metadataSource ? {} : right.metadataSource
      ? { metadataSource: right.metadataSource }
      : {}),
    ...(left.packageJsonPrivate !== undefined ? {} : right.packageJsonPrivate !== undefined
      ? { packageJsonPrivate: right.packageJsonPrivate }
      : {}),
    files: uniqueEvidenceFiles([...left.files, ...right.files]),
    warnings: unique([...left.warnings, ...right.warnings]),
    source: strongerEvidenceSource(left.source, right.source)
  };
}

function strongerEvidenceSource(
  left: LicenseEvidence["source"],
  right: LicenseEvidence["source"]
): LicenseEvidence["source"] {
  const rank: Record<LicenseEvidence["source"], number> = {
    local: 5,
    tarball: 4,
    sbom: 3,
    unavailable: 1
  };
  return rank[left] >= rank[right] ? left : right;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniquePaths(paths: string[][]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const dependencyPath of paths) {
    byKey.set(JSON.stringify(dependencyPath), dependencyPath);
  }
  return [...byKey.values()];
}

function uniqueOrigins(origins: DependencyOrigin[]): DependencyOrigin[] {
  const byKey = new Map<string, DependencyOrigin>();
  for (const origin of origins) {
    byKey.set(`${origin.lockfileKind}\0${origin.lockfilePath}`, origin);
  }
  return [...byKey.values()];
}

function uniqueEvidenceFiles(files: LicenseEvidence["files"]): LicenseEvidence["files"] {
  const byKey = new Map<string, LicenseEvidence["files"][number]>();
  for (const file of files) {
    byKey.set(`${file.kind}\0${file.path}\0${file.text}`, file);
  }
  return [...byKey.values()];
}
