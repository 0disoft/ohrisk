import type { ScanCompleteness } from "../report/scan-report";

export type DiffEvidenceCompleteness = {
  status: "complete" | "partial";
  baseline: ScanCompleteness;
  current: ScanCompleteness;
};

export function buildDiffEvidenceCompleteness(input: {
  baseline: ScanCompleteness;
  current: ScanCompleteness;
}): DiffEvidenceCompleteness {
  return {
    status: input.baseline.status === "complete" && input.current.status === "complete"
      ? "complete"
      : "partial",
    baseline: input.baseline,
    current: input.current
  };
}

export function renderIncompleteDiffEvidence(
  completeness: DiffEvidenceCompleteness
): string {
  const revisions = [
    ...(completeness.baseline.status === "partial"
      ? [`baseline (${renderCounts(completeness.baseline)})`]
      : []),
    ...(completeness.current.status === "partial"
      ? [`current (${renderCounts(completeness.current)})`]
      : [])
  ];
  return `Diff evidence is partial for ${revisions.join(" and ")}. `
    + "Treat the result as indeterminate and retry after evidence collection succeeds.
";
}

function renderCounts(completeness: ScanCompleteness): string {
  return `${completeness.unavailablePackageCount} unavailable packages, `
    + `${completeness.skippedRepositoryEntryCount} skipped repository entries`;
}
