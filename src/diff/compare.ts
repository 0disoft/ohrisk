import type { RiskFinding } from "../policy/types";
import { comparableFindingFingerprint } from "../../bin/finding-fingerprint.mjs";

export type RiskDiff = {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
  newFindings: RiskFinding[];
  changedFindings: RiskFinding[];
  resolvedFindings: RiskFinding[];
  introducedFindings: RiskFinding[];
  provenanceChangedFindings?: RiskFinding[];
};

export function diffRiskFindings(input: {
  baselineFindings: RiskFinding[];
  currentFindings: RiskFinding[];
}): RiskDiff {
  const baselineById = indexFindings(input.baselineFindings, "baseline");
  const currentIds = new Set(indexFindings(input.currentFindings, "current").keys());
  const newFindings: RiskFinding[] = [];
  const changedFindings: RiskFinding[] = [];
  const provenanceChangedFindings: RiskFinding[] = [];

  for (const finding of input.currentFindings) {
    const baseline = baselineById.get(comparisonIdentity(finding));
    if (!baseline) {
      newFindings.push(finding);
      continue;
    }

    if (findingKey(baseline) !== findingKey(finding)) {
      changedFindings.push(finding);
    } else if (baseline.id !== finding.id || baseline.evidenceFingerprint !== finding.evidenceFingerprint) {
      provenanceChangedFindings.push(finding);
    }
  }

  const resolvedFindings = input.baselineFindings.filter((finding) => !currentIds.has(comparisonIdentity(finding)));

  return {
    baselineFindings: input.baselineFindings,
    currentFindings: input.currentFindings,
    newFindings,
    changedFindings,
    resolvedFindings,
    introducedFindings: [...newFindings, ...changedFindings],
    provenanceChangedFindings
  };
}

function findingKey(finding: RiskFinding): string {
  return comparableFindingFingerprint(finding.decision?.fingerprint ?? finding.fingerprint);
}

function comparisonIdentity(finding: RiskFinding): string {
  return finding.decision ? `decision:${finding.decision.id}` : `legacy:${finding.id}`;
}

function indexFindings(findings: RiskFinding[], side: string): Map<string, RiskFinding> {
  const indexed = new Map<string, RiskFinding>();
  for (const finding of findings) {
    const key = comparisonIdentity(finding);
    if (indexed.has(key)) throw new Error(`Finding comparison identity is ambiguous in ${side} inputs.`);
    indexed.set(key, finding);
  }
  return indexed;
}
