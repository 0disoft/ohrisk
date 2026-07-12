import { packageUrl } from "../graph/package-url";
import type { DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import type { SpdxExpressionNode, SpdxLicenseNode } from "../license/spdx";
import { buildFindingFingerprint, buildFindingId } from "./finding-id";
import type { UsageProfile } from "./profiles";
import {
  evaluationPolicyForProfile,
  matchPolicyPackageRule,
  type EvaluationPolicy
} from "./config";
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

const COPYLEFT_RELAXING_EXCEPTIONS = new Set([
  "Autoconf-exception-2.0",
  "Autoconf-exception-3.0",
  "Bison-exception-2.2",
  "Classpath-exception-2.0",
  "eCos-exception-2.0",
  "FLTK-exception",
  "Font-exception-2.0",
  "GCC-exception-2.0",
  "GCC-exception-3.1",
  "LLVM-exception",
  "Linux-syscall-note",
  "OpenJDK-assembly-exception-1.0",
  "Qt-GPL-exception-1.0",
  "WxWindows-exception-3.1"
]);

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
  policy?: EvaluationPolicy;
}): RiskFinding {
  const effectivePolicy = input.policy
    ? evaluationPolicyForProfile(input.policy, input.profile)
    : undefined;
  const policyRule = effectivePolicy
    ? matchPolicyPackageRule(
        [input.license.packageId, packageUrl(input.dependency)],
        effectivePolicy.packageRules
      )
    : undefined;
  const classifiedSeverity = classifySeverity(input.license, input.profile, effectivePolicy);
  const severity = policyRule?.severity ?? classifiedSeverity;
  const recommendation = policyRule?.recommendation
    ?? recommendationFor(severity, input.dependency);
  const paths = input.dependency.paths;
  const packageId = input.license.packageId;
  const reason = policyRule?.reason
    ?? explainSeverity(input.license, input.profile, severity, effectivePolicy);
  const action = policyRule?.action ?? actionFor(recommendation, input.license);
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
  policy?: EvaluationPolicy;
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
        profile: input.profile,
        ...(input.policy ? { policy: input.policy } : {})
      });
    })
    .filter((finding): finding is RiskFinding => finding !== undefined)
    .sort(compareFindings);
}

function classifySeverity(
  license: NormalizedLicense,
  profile: UsageProfile,
  policy: EvaluationPolicy | undefined
): RiskSeverity {
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

  if (license.spdxAst) {
    return classifySpdxNode(license.spdxAst, profile, policy);
  }

  if (license.choices.length === 0) {
    return "unknown";
  }

  const severities = license.choices.map((choice) =>
    classifyLicenseChoice({ type: "license", license: choice }, profile, policy)
  );

  if (license.joiner === "or") {
    return minSeverity(severities);
  }

  return maxSeverity(severities);
}

function classifySpdxNode(
  node: SpdxExpressionNode,
  profile: UsageProfile,
  policy: EvaluationPolicy | undefined
): RiskSeverity {
  if (node.type === "license") {
    return classifyLicenseChoice(node, profile, policy);
  }

  const left = classifySpdxNode(node.left, profile, policy);
  const right = classifySpdxNode(node.right, profile, policy);
  return node.type === "or"
    ? minSeverity([left, right])
    : maxSeverity([left, right]);
}

function classifyLicenseChoice(
  choice: SpdxLicenseNode,
  profile: UsageProfile,
  policy: EvaluationPolicy | undefined
): RiskSeverity {
  const term = choice.exception
    ? `${choice.license} WITH ${choice.exception}`
    : choice.license;

  if (policy?.denyLicenses.has(term) || policy?.denyLicenses.has(choice.license)) {
    return "high";
  }

  const policySeverity = policy?.severityOverrides.get(term)
    ?? policy?.severityOverrides.get(choice.license);
  if (policySeverity) {
    return policySeverity;
  }

  if (policy?.allowLicenses.has(term) || policy?.allowLicenses.has(choice.license)) {
    return "low";
  }

  if (PERMISSIVE_LICENSES.has(choice.license)) {
    return "low";
  }

  if (COMMERCIAL_RESTRICTION_LICENSES.has(choice.license)) {
    return "high";
  }

  if (matchesPrefix(choice.license, NETWORK_COPYLEFT_LICENSE_PREFIXES)) {
    return "high";
  }

  if (matchesPrefix(choice.license, STRONG_COPYLEFT_LICENSE_PREFIXES)) {
    if (choice.exception && COPYLEFT_RELAXING_EXCEPTIONS.has(choice.exception)) {
      return "review";
    }
    return profile === "distributed-app" ? "high" : "review";
  }

  if (matchesPrefix(choice.license, WEAK_COPYLEFT_LICENSE_PREFIXES)) {
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
  severity: RiskSeverity,
  policy: EvaluationPolicy | undefined
): string {
  const policyMatchedTerms = license.choices.filter((choice) =>
    policy?.allowLicenses.has(choice)
    || policy?.denyLicenses.has(choice)
    || policy?.severityOverrides.has(choice)
  );
  if (policyMatchedTerms.length > 0) {
    return `Organization policy classified ${policyMatchedTerms.join(", ")} as ${severity} risk for ${profile}.`;
  }
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
