import { countFindingsAtOrAbove } from "../policy/severity";
import type { RiskFinding, RiskSeverity } from "../policy/types";

export type ThresholdSummary = {
  failOn?: RiskSeverity;
  failed?: boolean;
  failingFindingCount?: number;
};

export function buildThresholdSummary(
  findings: RiskFinding[],
  failOn: RiskSeverity | undefined
): ThresholdSummary {
  if (!failOn) {
    return {};
  }

  const failingFindingCount = countFindingsAtOrAbove(findings, failOn);

  return {
    failOn,
    failed: failingFindingCount > 0,
    failingFindingCount
  };
}

export function formatThresholdSummary(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "failed" : "passed";
  const findingLabel = summary.failingFindingCount === 1 ? "finding" : "findings";

  return `Threshold: ${outcome} on ${summary.failOn} (${summary.failingFindingCount} ${findingLabel} at or above threshold)`;
}
