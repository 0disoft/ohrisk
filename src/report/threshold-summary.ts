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
