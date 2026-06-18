import type { RiskFinding, RiskSeverity } from "./types";

export function countFindingsAtOrAbove(
  findings: RiskFinding[],
  threshold: RiskSeverity
): number {
  return findings.filter((finding) => severityRank(finding.severity) >= severityRank(threshold))
    .length;
}

export function hasFindingAtOrAbove(findings: RiskFinding[], threshold: RiskSeverity): boolean {
  return countFindingsAtOrAbove(findings, threshold) > 0;
}

function severityRank(severity: RiskSeverity): number {
  switch (severity) {
    case "low":
      return 0;
    case "review":
      return 1;
    case "unknown":
      return 2;
    case "high":
      return 3;
  }
}
