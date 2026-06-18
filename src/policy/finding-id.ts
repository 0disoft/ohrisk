import type { RiskFinding } from "./types";

export function buildFindingId(input: {
  packageId: string;
  severity: RiskFinding["severity"];
  recommendation: RiskFinding["recommendation"];
  paths: string[][];
}): string {
  return [
    input.packageId,
    input.severity,
    input.recommendation,
    input.paths.map((items) => items.join(">")).join("|")
  ].join("::");
}
