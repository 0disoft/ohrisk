import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph, UnresolvedDependency } from "../graph/types";
import type { NormalizedLicense } from "../license/types";

export type ScanCompletenessDimensions = {
  input: { status: "complete" | "partial"; skippedRepositoryEntryCount: number };
  graph: {
    status: "complete" | "partial" | "unknown";
    unresolvedDependencyCount: number;
    unknownRelationshipNodeCount: number;
    rootRelationshipsUnknown: boolean;
  };
  evidence: { status: "complete" | "partial"; unavailablePackageCount: number; artifactConflictPackageCount: number };
  licenses: { status: "identified" | "unidentified" | "not-assessed"; unidentifiedPackageCount: number };
};

export type ScanCompleteness = {
  status: "complete" | "partial";
  unavailablePackageCount: number;
  skippedRepositoryEntryCount: number;
  unresolvedDependencyCount?: number;
  unresolvedDependencies?: UnresolvedDependency[];
  dimensions?: ScanCompletenessDimensions;
};

export type ComparisonCompleteness = {
  status: "complete" | "partial";
  baseline: ScanCompleteness;
  current: ScanCompleteness;
};

export function buildScanCompleteness(input: {
  evidence: LicenseEvidence[];
  graph?: DependencyGraph;
  normalizedLicenses?: NormalizedLicense[];
  repository?: {
    submodules: { skippedCount: number };
    symbolicLinks: { skippedCount: number };
    nonPortablePaths: { skippedCount: number };
  };
}): ScanCompleteness {
  const unavailablePackageCount = input.evidence.filter((evidence) => evidence.source === "unavailable").length;
  const skippedRepositoryEntryCount = input.repository
    ? input.repository.submodules.skippedCount + input.repository.symbolicLinks.skippedCount
      + input.repository.nonPortablePaths.skippedCount
    : 0;
  const unresolvedDependencies = input.graph?.unresolvedDependencies ?? [];
  const unresolvedDependencyCount = unresolvedDependencies.length;
  const unknownRelationshipNodeCount = input.graph?.edges === undefined
    ? input.graph?.nodes.length ?? 0 : input.graph.unknownDependencyNodeIds?.length ?? 0;
  const rootRelationshipsUnknown = input.graph?.edges === undefined || input.graph.rootDependenciesUnknown === true;
  const identifiedIds = new Set(input.normalizedLicenses?.filter((license) =>
    license.expression !== undefined && !license.signals.some((signal) =>
      signal === "missing" || signal === "malformed" || signal === "conflicting-evidence"))
    .map((license) => license.packageId));
  const unidentifiedPackageCount = input.graph
    ? input.graph.nodes.filter((node) => !identifiedIds.has(node.id)).length
    : (input.normalizedLicenses?.length ?? 0) - identifiedIds.size;
  return {
    status: unavailablePackageCount > 0 || skippedRepositoryEntryCount > 0 || unresolvedDependencyCount > 0 ? "partial" : "complete",
    unavailablePackageCount,
    skippedRepositoryEntryCount,
    ...(input.graph ? {
      unresolvedDependencyCount,
      ...(unresolvedDependencyCount > 0 ? { unresolvedDependencies } : {}),
      dimensions: {
        input: { status: skippedRepositoryEntryCount > 0 ? "partial" : "complete", skippedRepositoryEntryCount },
        graph: {
          status: unresolvedDependencyCount > 0 ? "partial"
            : unknownRelationshipNodeCount > 0 || rootRelationshipsUnknown ? "unknown" : "complete",
          unresolvedDependencyCount, unknownRelationshipNodeCount, rootRelationshipsUnknown
        },
        evidence: {
          status: unavailablePackageCount > 0 ? "partial" : "complete", unavailablePackageCount,
          artifactConflictPackageCount: input.evidence.filter((item) => item.artifactIdentityConflict).length
        },
        licenses: {
          status: input.normalizedLicenses === undefined ? "not-assessed"
            : unidentifiedPackageCount > 0 ? "unidentified" : "identified",
          unidentifiedPackageCount
        }
      } satisfies ScanCompletenessDimensions
    } : {})
  };
}

export function formatScanCompleteness(completeness: ScanCompleteness): string {
  const reasons = [
    completeness.unavailablePackageCount > 0
      ? `${completeness.unavailablePackageCount} package evidence source${completeness.unavailablePackageCount === 1 ? "" : "s"} unavailable` : undefined,
    completeness.skippedRepositoryEntryCount > 0
      ? `${completeness.skippedRepositoryEntryCount} repository entr${completeness.skippedRepositoryEntryCount === 1 ? "y" : "ies"} skipped` : undefined,
    (completeness.unresolvedDependencyCount ?? 0) > 0
      ? `${completeness.unresolvedDependencyCount} unresolved dependency requests` : undefined
  ].filter((reason): reason is string => reason !== undefined);
  const summary = completeness.status === "complete" ? "complete" : `partial (${reasons.join(", ")})`;
  const dimensions = completeness.dimensions;
  return dimensions ? `${summary}; input ${dimensions.input.status}, graph ${dimensions.graph.status}, evidence ${dimensions.evidence.status}, licenses ${dimensions.licenses.status}` : summary;
}

export function incompleteEvidenceGateFailed(input: {
  enabled: boolean;
  allowPartialEvidence: boolean;
  completeness: { status: "complete" | "partial" };
}): boolean {
  return input.enabled && input.completeness.status === "partial" && !input.allowPartialEvidence;
}
