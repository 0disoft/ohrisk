import type { DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import { buildFindingFingerprint, buildFindingId } from "./finding-id";
import type { UsageProfile } from "./profiles";
import type {
  RiskDependencyScope,
  RiskFinding,
  RiskRecommendation,
  RiskSeverity
} from "./types";

const PERMISSIVE_LICENSES = new Set([
  "0BSD",
  "MIT",
  "MIT-CMU",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "Zlib",
  "CC0-1.0",
  "Unlicense"
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

const SOURCE_AVAILABLE_RESTRICTION_LICENSES = new Set([
  "SSPL-1.0",
  "BUSL-1.1",
  "Commons-Clause",
  "Elastic-2.0",
  "PolyForm-Noncommercial-1.0.0",
  "PolyForm-Free-Trial-1.0.0"
]);

const COMMERCIAL_RESTRICTION_LICENSES = new Set([
  ...SOURCE_AVAILABLE_RESTRICTION_LICENSES,
  "UNLICENSED"
]);

const NO_ACTION_NEEDED = "No action needed for this profile.";
const REPLACE_ACTION = "Replace this package or escalate before shipping.";
const UNLICENSED_ACTION = "Do not ship this package until license permissions are clarified.";
export const NOTICE_ACTION = "Preserve required NOTICE or attribution files when distributing this package.";

export function evaluateLicenseRisk(input: {
  license: NormalizedLicense;
  dependency: DependencyNode;
  profile: UsageProfile;
}): RiskFinding {
  const severity = classifySeverity(input.license, input.profile);
  const recommendation = recommendationFor(severity, input.dependency);
  const paths = input.dependency.paths;
  const packageId = input.license.packageId;
  const reason = explainSeverity(input.license, input.profile, severity);
  const action = actionFor(recommendation, input.license);
  const dependencyScope = dependencyScopeFor(input.dependency);
  const evidence = buildEvidence(input.license, input.dependency);
  const id = buildFindingId({
    packageId,
    dependencyType: input.dependency.dependencyType,
    dependencyScope,
    paths
  });

  return {
    id,
    fingerprint: buildFindingFingerprint({
      id,
      severity,
      recommendation,
      reason,
      evidence
    }),
    packageId,
    severity,
    reason,
    action,
    dependencyType: input.dependency.dependencyType,
    dependencyScope,
    evidence,
    paths,
    recommendation
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
  if (
    license.signals.includes("commercial-restriction")
    && !hasCommercialRestrictionChoice(license)
  ) {
    return "high";
  }

  if (license.signals.includes("internal-private") && !license.signals.includes("malformed")) {
    return "low";
  }

  if (license.signals.includes("missing") || license.signals.includes("malformed")) {
    return "unknown";
  }

  if (license.choices.length === 0) {
    return "unknown";
  }

  const severities = license.choices.map((choice) => classifyLicenseChoice(choice, profile));

  if (license.joiner === "or") {
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

function hasCommercialRestrictionChoice(license: NormalizedLicense): boolean {
  return license.choices.some((choice) => COMMERCIAL_RESTRICTION_LICENSES.has(choice));
}

function explainSeverity(
  license: NormalizedLicense,
  profile: UsageProfile,
  severity: RiskSeverity
): string {
  switch (severity) {
    case "low":
      if (license.signals.includes("internal-private") && license.choices.length === 0) {
        return "Local package is marked private in package.json, so missing public license metadata is treated as internal package evidence.";
      }

      return `License expression is low risk for ${profile}.`;
    case "review":
      return `License expression should be reviewed before shipping under ${profile}.`;
    case "high":
      if (license.choices.includes("UNLICENSED")) {
        return "Package metadata explicitly marks the package as UNLICENSED.";
      }

      if (license.choices.some((choice) => SOURCE_AVAILABLE_RESTRICTION_LICENSES.has(choice))) {
        return `License expression includes a source-available or commercial-use restriction for ${profile}.`;
      }

      if (license.signals.includes("commercial-restriction")) {
        return `License evidence contains an explicit commercial-use restriction for ${profile}.`;
      }

      return `License expression is high risk for ${profile}.`;
    case "unknown":
      if (license.signals.includes("missing")) {
        return "Package metadata does not declare a license expression.";
      }

      if (license.signals.includes("malformed")) {
        return "Package metadata declares a malformed license expression.";
      }

      return "License expression is not recognized by Ohrisk.";
  }
}

function buildEvidence(license: NormalizedLicense, dependency: DependencyNode): string[] {
  const evidence = [
    license.original
      ? `license: ${license.original}`
      : license.signals.includes("internal-private")
        ? "license: private package"
        : "license: missing",
    `dependency: ${dependency.dependencyType}`,
    dependency.direct ? "direct dependency" : "transitive dependency",
    ...license.evidenceSources
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

function actionFor(recommendation: RiskRecommendation, license?: NormalizedLicense): string {
  switch (recommendation) {
    case "allow":
      return license?.signals.includes("notice-required") ? NOTICE_ACTION : NO_ACTION_NEEDED;
    case "review":
      return "Review this package before shipping.";
    case "replace":
      return license?.choices.includes("UNLICENSED") ? UNLICENSED_ACTION : REPLACE_ACTION;
    case "exclude-dev-only":
      return "Keep this package out of production or scan with --prod.";
    case "collect-evidence":
      if (license?.signals.includes("missing")) {
        return "Add or verify package license metadata before approving this package.";
      }

      if (license?.signals.includes("malformed")) {
        return "Fix or manually review the declared license expression before approving this package.";
      }

      return "Collect license evidence before approving this package.";
  }
}

function dependencyScopeFor(dependency: DependencyNode): RiskDependencyScope {
  return dependency.direct ? "direct" : "transitive";
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
