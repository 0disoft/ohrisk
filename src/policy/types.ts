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

export type RiskDependencyScope =
  | "direct"
  | "transitive";

export type RiskDependencyType =
  | "production"
  | "development"
  | "optional"
  | "peer"
  | "unknown";

export type RiskFinding = {
  packageId: string;
  severity: RiskSeverity;
  reason: string;
  action: string;
  dependencyType: RiskDependencyType;
  dependencyScope: RiskDependencyScope;
  evidence: string[];
  paths: string[][];
  recommendation: RiskRecommendation;
};
