export type RiskSeverity =
  | "low"
  | "review"
  | "high"
  | "unknown";

export type RiskRecommendation =
  | "allow"
  | "review"
  | "replace"
  | "exclude-dev-only"
  | "collect-evidence";

export type RiskFinding = {
  packageId: string;
  severity: RiskSeverity;
  reason: string;
  action: string;
  evidence: string[];
  paths: string[][];
  recommendation: RiskRecommendation;
};
