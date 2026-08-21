import type { LicenseEvidence } from "../evidence/types";
import type { ProjectLockfile } from "../project/discover";
import { packageUrl } from "./package-url";
import type {
  DependencyGraph,
  DependencyGraphDiagnostic,
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
  const diagnostics: DependencyGraphDiagnostic[] = [];
  const mavenRepositoryUrls: string[] = [];

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
    diagnostics.push(...(item.graph.diagnostics ?? []));
    mavenRepositoryUrls.push(...(item.graph.mavenRepositoryUrls ?? []));
  }

  const lockfilePaths = unique(graphs.map((item) => item.source.lockfilePath));
  const rootNames = unique(
    graphs.flatMap((item) => item.graph.rootName ? [item.graph.rootName] : [])
  );

  return {
    ...(rootNames.length === 1 ? { rootName: rootNames[0] } : {}),
    lockfilePath: first.graph.lockfilePath,
    lockfilePaths,
    ...(mavenRepositoryUrls.length > 0
      ? { mavenRepositoryUrls: unique(mavenRepositoryUrls).sort() }
      : {}),
    nodes: [...nodesByPurl.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(evidenceByPackageId.size > 0
      ? { embeddedEvidence: [...evidenceByPackageId.values()] }
      : {}),
    ...(warnings.length > 0 ? { warnings: unique(warnings) } : {}),
    ...(diagnostics.length > 0 ? { diagnostics: mergeGraphDiagnostics(diagnostics) } : {})
  };
}

function mergeGraphDiagnostics(
  diagnostics: DependencyGraphDiagnostic[]
): DependencyGraphDiagnostic[] {
  const byKey = new Map<string, DependencyGraphDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\u0000${diagnostic.limit}\u0000${diagnostic.message}`;
    const existing = byKey.get(key);
    byKey.set(key, existing
      ? {
          ...existing,
          affectedNodeCount: existing.affectedNodeCount + diagnostic.affectedNodeCount
        }
      : diagnostic);
  }
  return [...byKey.values()].sort((left, right) => left.code.localeCompare(right.code));
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
  if (
    left.goModIntegrity
    && right.goModIntegrity
    && left.goModIntegrity !== right.goModIntegrity
  ) {
    warnings.push(`Multiple lockfiles declare different go.mod integrity values for ${purl}.`);
  }
  return warnings;
}

function mergeDependencyNode(left: DependencyNode, right: DependencyNode): DependencyNode {
  return {
    ...left,
    ...(left.resolved ? {} : right.resolved ? { resolved: right.resolved } : {}),
    ...(left.integrity ? {} : right.integrity ? { integrity: right.integrity } : {}),
    ...(left.goModIntegrity
      ? {}
      : right.goModIntegrity
        ? { goModIntegrity: right.goModIntegrity }
        : {}),
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
  const primary = primaryLicenseEvidence(left, right);
  const secondary = primary === left ? right : left;
  const conflictingLicenseClaims = collectConflictingLicenseClaims(left, right);

  return {
    ...primary,
    ...(primary.packageJsonLicense ? {} : secondary.packageJsonLicense
      ? { packageJsonLicense: secondary.packageJsonLicense }
      : {}),
    ...(primary.packageJsonLicenses !== undefined ? {} : secondary.packageJsonLicenses !== undefined
      ? { packageJsonLicenses: secondary.packageJsonLicenses }
      : {}),
    ...(primary.metadataLicense ? {} : secondary.metadataLicense
      ? {
          metadataLicense: secondary.metadataLicense,
          ...(secondary.metadataLicenseKind
            ? { metadataLicenseKind: secondary.metadataLicenseKind }
            : {})
        }
      : {}),
    ...(primary.metadataLicenses !== undefined ? {} : secondary.metadataLicenses !== undefined
      ? { metadataLicenses: secondary.metadataLicenses }
      : {}),
    ...(primary.metadataSource ? {} : secondary.metadataSource
      ? { metadataSource: secondary.metadataSource }
      : {}),
    ...(primary.sbomDeclaredLicense ? {} : secondary.sbomDeclaredLicense
      ? { sbomDeclaredLicense: secondary.sbomDeclaredLicense }
      : {}),
    ...(primary.sbomConcludedLicense ? {} : secondary.sbomConcludedLicense
      ? { sbomConcludedLicense: secondary.sbomConcludedLicense }
      : {}),
    ...(primary.packageJsonPrivate === false
      ? secondary.packageJsonPrivate === true
        ? { packageJsonPrivate: true }
        : {}
      : primary.packageJsonPrivate === true
        ? {}
        : secondary.packageJsonPrivate !== undefined
          ? { packageJsonPrivate: secondary.packageJsonPrivate }
          : {}),
    ...(primary.goModuleRequirements !== undefined || secondary.goModuleRequirements !== undefined
      ? {
          goModuleRequirements: unique([
            ...(primary.goModuleRequirements ?? []),
            ...(secondary.goModuleRequirements ?? [])
          ]).sort()
        }
      : {}),
    ...(conflictingLicenseClaims.length > 0 ? { conflictingLicenseClaims } : {}),
    files: uniqueEvidenceFiles([...primary.files, ...secondary.files]).sort(compareEvidenceFiles),
    warnings: unique([...primary.warnings, ...secondary.warnings]).sort(),
    source: strongerEvidenceSource(primary.source, secondary.source)
  };
}

function primaryLicenseEvidence(
  left: LicenseEvidence,
  right: LicenseEvidence
): LicenseEvidence {
  const rank: Record<LicenseEvidence["source"], number> = {
    local: 5,
    tarball: 4,
    registry: 3,
    sbom: 3,
    unavailable: 1
  };
  const leftRank = rank[left.source] ?? 0;
  const rightRank = rank[right.source] ?? 0;
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? left : right;
  }
  return JSON.stringify(left) <= JSON.stringify(right) ? left : right;
}

function collectConflictingLicenseClaims(
  left: LicenseEvidence,
  right: LicenseEvidence
): string[] {
  const leftClaims = licenseClaimValues(left);
  const rightClaims = licenseClaimValues(right);
  const combined = unique([...leftClaims, ...rightClaims]);
  return combined.length > 1 ? combined.sort() : [];
}

function licenseClaimValues(evidence: LicenseEvidence): string[] {
  const values: string[] = [...(evidence.conflictingLicenseClaims ?? [])];
  if (evidence.packageJsonLicense) {
    values.push(evidence.packageJsonLicense);
  }
  if (evidence.metadataLicense) {
    values.push(evidence.metadataLicense);
  }
  if (evidence.sbomDeclaredLicense) {
    values.push(evidence.sbomDeclaredLicense);
  }
  if (evidence.sbomConcludedLicense) {
    values.push(evidence.sbomConcludedLicense);
  }
  if (evidence.packageJsonLicenses !== undefined) {
    values.push(JSON.stringify(evidence.packageJsonLicenses));
  }
  if (evidence.metadataLicenses !== undefined) {
    values.push(JSON.stringify(evidence.metadataLicenses));
  }
  return values;
}

function strongerEvidenceSource(
  left: LicenseEvidence["source"],
  right: LicenseEvidence["source"]
): LicenseEvidence["source"] {
  const rank: Record<LicenseEvidence["source"], number> = {
    local: 5,
    tarball: 4,
    registry: 3,
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
    byKey.set(`${file.scope ?? "package"}\0${file.kind}\0${file.path}\0${file.text}`, file);
  }
  return [...byKey.values()];
}

function compareEvidenceFiles(
  left: LicenseEvidence["files"][number],
  right: LicenseEvidence["files"][number]
): number {
  return `${left.kind}\0${left.path}\0${left.text}`.localeCompare(
    `${right.kind}\0${right.path}\0${right.text}`
  );
}
