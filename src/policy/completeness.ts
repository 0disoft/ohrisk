import type { LicenseEvidence } from "../evidence/types";

export type ScanCompleteness = {
  status: "complete" | "partial";
  unavailablePackageCount: number;
  skippedRepositoryEntryCount: number;
};

export type ComparisonCompleteness = {
  status: "complete" | "partial";
  baseline: ScanCompleteness;
  current: ScanCompleteness;
};

export function buildScanCompleteness(input: {
  evidence: LicenseEvidence[];
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
  return {
    status: unavailablePackageCount > 0 || skippedRepositoryEntryCount > 0 ? "partial" : "complete",
    unavailablePackageCount,
    skippedRepositoryEntryCount
  };
}

export function incompleteEvidenceGateFailed(input: {
  enabled: boolean;
  allowPartialEvidence: boolean;
  completeness: { status: "complete" | "partial" };
}): boolean {
  return input.enabled && input.completeness.status === "partial" && !input.allowPartialEvidence;
}
