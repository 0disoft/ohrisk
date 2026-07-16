import type { RiskFinding } from "../policy/types";

export type RiskDiff = {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
  newFindings: RiskFinding[];
  changedFindings: RiskFinding[];
  resolvedFindings: RiskFinding[];
  introducedFindings: RiskFinding[];
};

export function diffRiskFindings(input: {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
}): RiskDiff {
  const baselineById = new Map(input.baselineFindings.map((finding) => [finding.id, finding]));
  const currentIds = new Set(input.currentFindings.map((finding) => finding.id));
  const newFindings: RiskFinding[] = [];
  const changedFindings: RiskFinding[] = [];

  for (const finding of input.currentFindings) {
    const baseline = baselineById.get(finding.id);
    if (!baseline) {
      newFindings.push(finding);
      continue;
    }

    if (findingKey(baseline) !== findingKey(finding)) {
      changedFindings.push(finding);
    }
  }

  const resolvedFindings = input.baselineFindings.filter((finding) => !currentIds.has(finding.id));

  return {
    baselineFindings: input.baselineFindings,
    currentFindings: input.currentFindings,
    newFindings,
    changedFindings,
    resolvedFindings,
    introducedFindings: [...newFindings, ...changedFindings]
  };
}

function findingKey(finding: RiskFinding): string {
  return finding.fingerprint;
}
