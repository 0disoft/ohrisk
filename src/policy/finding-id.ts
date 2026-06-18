import type { RiskFinding } from "./types";

export function buildFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return [
    input.packageId,
    input.dependencyType,
    input.dependencyScope,
    input.paths.map((items) => items.join(">")).join("|")
  ].join("::");
}

export function buildFindingFingerprint(input: {
  id: string;
  severity: RiskFinding["severity"];
  recommendation: RiskFinding["recommendation"];
  reason: string;
  evidence: string[];
}): string {
  return [
    input.id,
    input.severity,
    input.recommendation,
    input.reason,
    input.evidence.join("|")
  ].join("::");
}
