import type { LicenseEvidence } from "../src/evidence/types";
import type { DependencyNode } from "../src/graph/types";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import { collectSpdxLicenseTerms, parseSpdxExpression } from "../src/license/spdx";
import type { NormalizedLicenseConfidence } from "../src/license/types";
import { evaluateLicenseRisk } from "../src/policy/evaluate";
import type { UsageProfile } from "../src/policy/profiles";
import type { RiskSeverity } from "../src/policy/types";

export type ExternalLicenseToolStatus =
  | "detected"
  | "no-detection"
  | "not-run"
  | "error";

export type ExternalLicenseToolObservation = {
  status: ExternalLicenseToolStatus;
  expressions?: string[];
  version?: string;
  note?: string;
};

export type HeldoutLicenseCase = {
  id: string;
  sourceUrl: string;
  rationale: string;
  evidence: Omit<LicenseEvidence, "packageId">;
  profile: UsageProfile;
  expected: {
    severity: RiskSeverity;
    confidence: NormalizedLicenseConfidence;
  };
  external: {
    scancode: ExternalLicenseToolObservation;
    licensee: ExternalLicenseToolObservation;
  };
};

export type ExternalLicenseToolComparison = {
  status: "agree" | "disagree" | "unavailable";
  observedStatus: ExternalLicenseToolStatus;
  expressions: string[];
  version?: string;
  note?: string;
};

export type HeldoutLicenseEvaluation = {
  id: string;
  sourceUrl: string;
  rationale: string;
  expected: HeldoutLicenseCase["expected"];
  actual: HeldoutLicenseCase["expected"];
  exactDecisionMatch: boolean;
  ohriskExpression?: string;
  ohriskChoices: string[];
  external: {
    scancode: ExternalLicenseToolComparison;
    licensee: ExternalLicenseToolComparison;
  };
};

export type HeldoutLicenseSummary = {
  cases: number;
  exactDecisionMatches: number;
  ohriskDecisionMismatches: number;
  scancodeDisagreements: number;
  licenseeDisagreements: number;
  unavailableToolObservations: number;
};

export function validateHeldoutLicenseDataset(
  input: unknown,
  expectedCases = 20
): string[] {
  if (!Array.isArray(input)) {
    return ["Held-out dataset root must be an array."];
  }
  const errors: string[] = [];
  if (input.length !== expectedCases) {
    errors.push(`Held-out dataset must contain exactly ${expectedCases} cases; found ${input.length}.`);
  }
  const ids = new Set<string>();
  for (const [index, candidate] of input.entries()) {
    if (!isRecord(candidate)) {
      errors.push(`Held-out case ${index + 1} must be an object.`);
      continue;
    }
    const id = candidate.id;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
      errors.push(`Held-out case ${index + 1} has an invalid id.`);
    } else if (ids.has(id)) {
      errors.push(`Held-out case id is duplicated: ${id}.`);
    } else {
      ids.add(id);
    }
    if (typeof candidate.sourceUrl !== "string" || !candidate.sourceUrl.startsWith("https://")) {
      errors.push(`Held-out case ${String(id)} must use an HTTPS source URL.`);
    }
    if (typeof candidate.rationale !== "string" || candidate.rationale.trim().length < 20) {
      errors.push(`Held-out case ${String(id)} must include a reviewable rationale.`);
    }
    if (!isRecord(candidate.external)) {
      errors.push(`Held-out case ${String(id)} must include external observations.`);
      continue;
    }
    for (const tool of ["scancode", "licensee"] as const) {
      const observation = candidate.external[tool];
      if (!isRecord(observation) || !isExternalStatus(observation.status)) {
        errors.push(`Held-out case ${String(id)} has an invalid ${tool} observation.`);
      }
    }
  }
  return errors;
}

export function evaluateHeldoutLicenseCases(
  cases: readonly HeldoutLicenseCase[]
): { summary: HeldoutLicenseSummary; evaluations: HeldoutLicenseEvaluation[] } {
  const evaluations = cases.map(evaluateHeldoutLicenseCase);
  const summary: HeldoutLicenseSummary = {
    cases: evaluations.length,
    exactDecisionMatches: evaluations.filter((item) => item.exactDecisionMatch).length,
    ohriskDecisionMismatches: evaluations.filter((item) => !item.exactDecisionMatch).length,
    scancodeDisagreements: evaluations.filter(
      (item) => item.external.scancode.status === "disagree"
    ).length,
    licenseeDisagreements: evaluations.filter(
      (item) => item.external.licensee.status === "disagree"
    ).length,
    unavailableToolObservations: evaluations.reduce(
      (count, item) => count
        + Number(item.external.scancode.status === "unavailable")
        + Number(item.external.licensee.status === "unavailable"),
      0
    )
  };
  return { summary, evaluations };
}

export function renderHeldoutLicenseReport(input: {
  summary: HeldoutLicenseSummary;
  evaluations: readonly HeldoutLicenseEvaluation[];
}): string {
  const lines = [
    "# Held-out license evaluation",
    "",
    "## Summary",
    "",
    "| Metric | Result |",
    "| --- | ---: |",
    `| Cases | ${input.summary.cases} |`,
    `| Exact Ohrisk decision matches | ${input.summary.exactDecisionMatches} |`,
    `| Ohrisk decision mismatches | ${input.summary.ohriskDecisionMismatches} |`,
    `| ScanCode disagreements | ${input.summary.scancodeDisagreements} |`,
    `| Licensee disagreements | ${input.summary.licenseeDisagreements} |`,
    `| Unavailable external observations | ${input.summary.unavailableToolObservations} |`,
    "",
    "## Cases",
    "",
    "| Case | Source | Expected | Actual | Ohrisk expression | ScanCode | Licensee |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const item of input.evaluations) {
    lines.push([
      markdownCell(item.id),
      `[source](${item.sourceUrl})`,
      `${item.expected.severity}/${item.expected.confidence}`,
      `${item.actual.severity}/${item.actual.confidence}`,
      markdownCell(item.ohriskExpression ?? "none"),
      renderExternalComparison(item.external.scancode),
      renderExternalComparison(item.external.licensee)
    ].join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
  }

  return `${lines.join("\n")}\n`;
}

function evaluateHeldoutLicenseCase(item: HeldoutLicenseCase): HeldoutLicenseEvaluation {
  const packageId = `heldout-${item.id}@1.0.0`;
  const normalized = normalizeLicenseEvidence({ packageId, ...item.evidence });
  const finding = evaluateLicenseRisk({
    license: normalized,
    dependency: heldoutDependency(packageId),
    profile: item.profile
  });
  const actual = {
    severity: finding.severity,
    confidence: normalized.confidence
  };
  const ohriskTerms = normalized.expression
    ? canonicalLicenseTerms([normalized.expression])
    : new Set(normalized.choices);
  return {
    id: item.id,
    sourceUrl: item.sourceUrl,
    rationale: item.rationale,
    expected: item.expected,
    actual,
    exactDecisionMatch: actual.severity === item.expected.severity
      && actual.confidence === item.expected.confidence,
    ...(normalized.expression ? { ohriskExpression: normalized.expression } : {}),
    ohriskChoices: normalized.choices,
    external: {
      scancode: compareExternalObservation(ohriskTerms, item.external.scancode),
      licensee: compareExternalObservation(ohriskTerms, item.external.licensee)
    }
  };
}

function compareExternalObservation(
  ohriskTerms: ReadonlySet<string>,
  observation: ExternalLicenseToolObservation
): ExternalLicenseToolComparison {
  const expressions = observation.expressions ?? [];
  const common = {
    observedStatus: observation.status,
    expressions,
    ...(observation.version ? { version: observation.version } : {}),
    ...(observation.note ? { note: observation.note } : {})
  };
  if (observation.status === "not-run" || observation.status === "error") {
    return { status: "unavailable", ...common };
  }

  const externalTerms = canonicalLicenseTerms(expressions);
  const agrees = observation.status === "no-detection"
    ? ohriskTerms.size === 0
    : setEquals(ohriskTerms, externalTerms);
  return { status: agrees ? "agree" : "disagree", ...common };
}

function canonicalLicenseTerms(expressions: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const expression of expressions) {
    const parsed = parseSpdxExpression(expression);
    if (parsed.malformed || !parsed.ast) {
      terms.add(expression.trim());
      continue;
    }
    for (const term of collectSpdxLicenseTerms(parsed.ast)) {
      terms.add(term);
    }
  }
  terms.delete("");
  return terms;
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function renderExternalComparison(item: ExternalLicenseToolComparison): string {
  const expression = item.expressions.length > 0 ? item.expressions.join(", ") : "none";
  const version = item.version ? ` v${item.version}` : "";
  const note = item.note ? ` (${item.note})` : "";
  return markdownCell(`${item.status}${version}: ${expression}${note}`);
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/gu, " ").replace(/\|/gu, "\\|");
}

function heldoutDependency(packageId: string): DependencyNode {
  return {
    id: packageId,
    name: packageId.slice(0, packageId.lastIndexOf("@")),
    version: "1.0.0",
    ecosystem: "npm",
    dependencyType: "production",
    direct: true,
    paths: [["heldout-evaluation", packageId]]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExternalStatus(value: unknown): value is ExternalLicenseToolStatus {
  return value === "detected"
    || value === "no-detection"
    || value === "not-run"
    || value === "error";
}
