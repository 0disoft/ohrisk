import type { RiskFinding } from "../policy/types";

export type RiskDiff = {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
  newFindings: RiskFinding[];
};

export function diffRiskFindings(input: {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
}): RiskDiff {
  const baselineKeys = new Set(input.baselineFindings.map(findingKey));

  return {
    baselineFindings: input.baselineFindings,
    currentFindings: input.currentFindings,
    newFindings: input.currentFindings.filter((finding) => !baselineKeys.has(findingKey(finding)))
  };
}

function findingKey(finding: RiskFinding): string {
  return [
    finding.id,
    finding.severity,
    finding.recommendation
  ].join("::");
}
