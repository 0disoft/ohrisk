import type { NormalizedLicense } from "../license/types";
import type { RiskFinding } from "./types";
import { semanticEvidenceSources } from "../../bin/finding-fingerprint.mjs";
import { createHash } from "node:crypto";
import type { ReviewDecision, UsageProfile } from "../../types/report-types";

export function buildReviewDecision(input: {
  packageUrl: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  profile: UsageProfile;
  prodOnly: boolean;
  severity: RiskFinding["severity"];
  recommendation: RiskFinding["recommendation"];
  license: NormalizedLicense;
}): ReviewDecision {
  const id = ["review-v1", input.packageUrl, input.profile, input.prodOnly ? "production-only" : "all-dependencies",
    input.dependencyType, input.dependencyScope].map(encodeFindingComponent).join("::");
  return { id, profile: input.profile, prodOnly: input.prodOnly,
    fingerprint: buildSemanticFindingFingerprint({ id, severity: input.severity, recommendation: input.recommendation, license: input.license }) };
}

/** Digest of reported evidence labels; this is not an artifact-content checksum. */
export function buildEvidenceFingerprint(evidence: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(canonicalStringSet(evidence))).digest("hex");
}

export function buildFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return joinFindingIdentity(
    input.packageId,
    input.dependencyType,
    input.dependencyScope,
    canonicalPathSet(input.paths)
  );
}

// Legacy raw-order identity used only to keep pre-canonicalization waivers
// matching. Reports, diffs, and new waivers always use buildFindingId.
export function buildLegacyFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return joinFindingIdentity(
    input.packageId,
    input.dependencyType,
    input.dependencyScope,
    input.paths
  );
}

function joinFindingIdentity(
  packageId: string,
  dependencyType: RiskFinding["dependencyType"],
  dependencyScope: RiskFinding["dependencyScope"],
  paths: string[][]
): string {
  return [
    encodeFindingComponent(packageId),
    encodeFindingComponent(dependencyType),
    encodeFindingComponent(dependencyScope),
    paths.map((items) => items.map(encodeFindingComponent).join(">")).join("|")
  ].join("::");
}

function canonicalPathSet(paths: string[][]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const dependencyPath of paths) {
    byKey.set(JSON.stringify(dependencyPath), dependencyPath);
  }

  return [...byKey.values()].sort(comparePaths);
}

function comparePaths(left: string[], right: string[]): number {
  const leftKey = left.join("\u0000");
  const rightKey = right.join("\u0000");
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
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

export function buildSemanticFindingFingerprint(input: {
  id: string;
  severity: RiskFinding["severity"];
  recommendation: RiskFinding["recommendation"];
  license: Pick<
    NormalizedLicense,
    | "expression"
    | "choices"
    | "joiner"
    | "signals"
    | "evidenceSources"
    | "confidence"
    | "exceptions"
  >;
}): string {
  const semanticLicense = JSON.stringify({
    expression: input.license.expression ?? null,
    choices: canonicalStringSet(input.license.choices),
    joiner: input.license.joiner,
    signals: canonicalStringSet(input.license.signals),
    evidenceSources: semanticEvidenceSources(input.license.evidenceSources),
    confidence: input.license.confidence,
    exceptions: canonicalStringSet(input.license.exceptions ?? [])
  });

  return [
    input.id,
    encodeFindingComponent(input.severity),
    encodeFindingComponent(input.recommendation),
    encodeFindingComponent(semanticLicense)
  ].join("::");
}

function canonicalStringSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function encodeFindingComponent(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/:/g, "%3A")
    .replace(/>/g, "%3E")
    .replace(/\|/g, "%7C");
}
