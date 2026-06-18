import type { DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import type { UsageProfile } from "./profiles";
import type { RiskFinding, RiskRecommendation, RiskSeverity } from "./types";

const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0"
]);

const WEAK_COPYLEFT_LICENSE_PREFIXES = [
  "LGPL",
  "MPL",
  "EPL"
];

const STRONG_COPYLEFT_LICENSE_PREFIXES = [
  "GPL"
];

const NETWORK_COPYLEFT_LICENSE_PREFIXES = [
  "AGPL"
];

const COMMERCIAL_RESTRICTION_LICENSES = new Set([
  "SSPL-1.0",
  "BUSL-1.1",
  "Commons-Clause"
]);

export function evaluateLicenseRisk(input: {
  license: NormalizedLicense;
  dependency: DependencyNode;
  profile: UsageProfile;
}): RiskFinding {
  const severity = classifySeverity(input.license, input.profile);

  return {
    packageId: input.license.packageId,
    severity,
    reason: explainSeverity(input.license, input.profile, severity),
    evidence: buildEvidence(input.license, input.dependency),
    paths: input.dependency.paths,
    recommendation: recommendationFor(severity, input.dependency)
  };
}

export function evaluateLicenseRisks(input: {
  licenses: NormalizedLicense[];
  dependencies: DependencyNode[];
  profile: UsageProfile;
}): RiskFinding[] {
  const dependencyById = new Map(input.dependencies.map((dependency) => [dependency.id, dependency]));

  return input.licenses
    .map((license) => {
      const dependency = dependencyById.get(license.packageId);
      if (!dependency) {
        return undefined;
      }

      return evaluateLicenseRisk({
        license,
        dependency,
        profile: input.profile
      });
    })
    .filter((finding): finding is RiskFinding => finding !== undefined)
    .sort(compareFindings);
}

function classifySeverity(license: NormalizedLicense, profile: UsageProfile): RiskSeverity {
  if (license.signals.includes("missing") || license.signals.includes("malformed")) {
    return "unknown";
  }

  if (license.choices.length === 0) {
    return "unknown";
  }

  const severities = license.choices.map((choice) => classifyLicenseChoice(choice, profile));

  if (isOrExpression(license)) {
    return minSeverity(severities);
  }

  return maxSeverity(severities);
}

function classifyLicenseChoice(choice: string, profile: UsageProfile): RiskSeverity {
  if (PERMISSIVE_LICENSES.has(choice)) {
    return "low";
  }

  if (COMMERCIAL_RESTRICTION_LICENSES.has(choice)) {
    return "high";
  }

  if (matchesPrefix(choice, NETWORK_COPYLEFT_LICENSE_PREFIXES)) {
    return "high";
  }

  if (matchesPrefix(choice, STRONG_COPYLEFT_LICENSE_PREFIXES)) {
    return profile === "distributed-app" ? "high" : "review";
  }

  if (matchesPrefix(choice, WEAK_COPYLEFT_LICENSE_PREFIXES)) {
    return "review";
  }

  return "unknown";
}

function explainSeverity(
  license: NormalizedLicense,
  profile: UsageProfile,
  severity: RiskSeverity
): string {
  switch (severity) {
    case "low":
      return `License expression is low risk for ${profile}.`;
    case "review":
      return `License expression should be reviewed before shipping under ${profile}.`;
    case "high":
      return `License expression is high risk for ${profile}.`;
    case "unknown":
      return "License evidence is missing, malformed, or not recognized.";
  }
}

function buildEvidence(license: NormalizedLicense, dependency: DependencyNode): string[] {
  const evidence = [
    license.original ? `license: ${license.original}` : "license: missing",
    `dependency: ${dependency.dependencyType}`,
    dependency.direct ? "direct dependency" : "transitive dependency"
  ];

  if (license.signals.length > 0) {
    evidence.push(`signals: ${license.signals.join(", ")}`);
  }

  return evidence;
}

function recommendationFor(
  severity: RiskSeverity,
  dependency: DependencyNode
): RiskRecommendation {
  if (severity === "low") {
    return "allow";
  }

  if (severity === "unknown") {
    return "collect-evidence";
  }

  if (dependency.dependencyType === "development") {
    return "exclude-dev-only";
  }

  if (severity === "review") {
    return "review";
  }

  return "replace";
}

function isOrExpression(license: NormalizedLicense): boolean {
  return /\sOR\s/i.test(license.expression ?? license.original ?? "");
}

function matchesPrefix(choice: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => choice === prefix || choice.startsWith(`${prefix}-`));
}

function minSeverity(severities: RiskSeverity[]): RiskSeverity {
  return severities.sort(compareSeverity)[0] ?? "unknown";
}

function maxSeverity(severities: RiskSeverity[]): RiskSeverity {
  return severities.sort(compareSeverity).at(-1) ?? "unknown";
}

function compareSeverity(left: RiskSeverity, right: RiskSeverity): number {
  return severityRank(left) - severityRank(right);
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

function compareFindings(left: RiskFinding, right: RiskFinding): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) {
    return severity;
  }

  return left.packageId.localeCompare(right.packageId);
}
