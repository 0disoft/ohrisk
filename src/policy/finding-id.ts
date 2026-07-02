import type { RiskFinding } from "./types";

export function buildFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return [
    encodeFindingComponent(input.packageId),
    encodeFindingComponent(input.dependencyType),
    encodeFindingComponent(input.dependencyScope),
    input.paths.map((items) => items.map(encodeFindingComponent).join(">")).join("|")
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
    encodeFindingComponent(input.severity),
    encodeFindingComponent(input.recommendation),
    encodeFindingComponent(input.reason),
    input.evidence.map(encodeFindingComponent).join("|")
  ].join("::");
}

function encodeFindingComponent(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/:/g, "%3A")
    .replace(/>/g, "%3E")
    .replace(/\|/g, "%7C");
}
