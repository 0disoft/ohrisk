import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import adversarialEvidenceJson from "./fixtures/license-gold/adversarial-evidence.json" with { type: "json" };
import expressionsJson from "./fixtures/license-gold/expressions.json" with { type: "json" };
import fileEvidenceJson from "./fixtures/license-gold/file-evidence.json" with { type: "json" };
import metadataJson from "./fixtures/license-gold/metadata.json" with { type: "json" };
import registryMavenCargoJson from "./fixtures/license-gold/registry-maven-cargo.json" with { type: "json" };
import registryNpmPyPiJson from "./fixtures/license-gold/registry-npm-pypi.json" with { type: "json" };
import restrictionsJson from "./fixtures/license-gold/restrictions.json" with { type: "json" };
import type { LicenseEvidence } from "../src/evidence/types";
import type { DependencyNode } from "../src/graph/types";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import type {
  NormalizedLicenseConfidence,
  NormalizedLicenseSignal
} from "../src/license/types";
import { evaluateLicenseRisk } from "../src/policy/evaluate";
import type { UsageProfile } from "../src/policy/profiles";
import type { RiskSeverity } from "../src/policy/types";

type GoldCase = {
  id: string;
  sourceUrl: string;
  rationale: string;
  evidence: Omit<LicenseEvidence, "packageId">;
  profile: UsageProfile;
  registryContext?: {
    ecosystem: "npm" | "pypi" | "maven" | "cargo";
    artifactVerified: boolean;
    ignoredRegistryLicense?: string;
  };
  expected: {
    severity: RiskSeverity;
    confidence: NormalizedLicenseConfidence;
    signals?: NormalizedLicenseSignal[];
  };
};

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = [
  ...adversarialEvidenceJson,
  ...metadataJson,
  ...expressionsJson,
  ...restrictionsJson,
  ...fileEvidenceJson,
  ...registryNpmPyPiJson,
  ...registryMavenCargoJson
] as GoldCase[];

describe("license decision gold corpus", () => {
  for (const item of corpus) {
    test(item.id, () => {
      expect(item.sourceUrl).toMatch(/^https:\/\//);
      expect(item.rationale.trim().length).toBeGreaterThan(20);

      const outcome = evaluateCase(item);
      expect(outcome.severity).toBe(item.expected.severity);
      expect(outcome.confidence).toBe(item.expected.confidence);
      for (const signal of item.expected.signals ?? []) {
        expect(outcome.signals).toContain(signal);
      }
    });
  }

  test("reports the reviewed corpus size and metric denominators without overclaiming", () => {
    expect(new Set(corpus.map((item) => item.id)).size).toBe(corpus.length);
    const outcomes = corpus.map((item) => ({ item, actual: evaluateCase(item) }));
    const exactMatches = outcomes.filter(({ item, actual }) =>
      item.expected.severity === actual.severity
      && item.expected.confidence === actual.confidence
    ).length;
    const expectedHigh = outcomes.filter(({ item }) => item.expected.severity === "high");
    const highTruePositives = expectedHigh.filter(({ actual }) => actual.severity === "high").length;
    const expectedNonHigh = outcomes.filter(({ item }) => item.expected.severity !== "high");
    const highFalsePositives = expectedNonHigh.filter(({ actual }) => actual.severity === "high").length;
    const expectedUnknown = outcomes.filter(({ item }) => item.expected.severity === "unknown");
    const unknownMatches = expectedUnknown.filter(({ actual }) => actual.severity === "unknown").length;

    expect({
      cases: corpus.length,
      exactMatches,
      expectedHigh: expectedHigh.length,
      highTruePositives,
      expectedNonHigh: expectedNonHigh.length,
      highFalsePositives,
      expectedUnknown: expectedUnknown.length,
      unknownMatches
    }).toEqual({
      cases: 80,
      exactMatches: 80,
      expectedHigh: 23,
      highTruePositives: 23,
      expectedNonHigh: 57,
      highFalsePositives: 0,
      expectedUnknown: 22,
      unknownMatches: 22
    });

    const accuracyDoc = readFileSync(path.join(repoRoot, "docs", "accuracy.md"), "utf8");
    expect(accuracyDoc).toContain("80/80");
    expect(accuracyDoc).toContain("23/23");
    expect(accuracyDoc).toContain("0/57");
    expect(accuracyDoc).toContain("22/22");
    expect(accuracyDoc).toContain("not statistically representative");
  });

  test("keeps registry claims outside verified artifact evidence", () => {
    const registryCases = corpus.filter((item) => item.registryContext !== undefined);
    expect(registryCases).toHaveLength(30);

    for (const item of registryCases) {
      expect(item.registryContext?.artifactVerified).toBe(true);
      expect(item.evidence.source).toBe("tarball");
      const ignoredClaim = item.registryContext?.ignoredRegistryLicense;
      if (ignoredClaim) {
        expect(declaredLicenseClaims(item.evidence)).not.toContain(ignoredClaim);
      }
    }
  });
});

function evaluateCase(item: GoldCase): {
  severity: RiskSeverity;
  confidence: NormalizedLicenseConfidence;
  signals: NormalizedLicenseSignal[];
} {
  const packageId = `${item.id}@1.0.0`;
  const normalized = normalizeLicenseEvidence({ packageId, ...item.evidence });
  const finding = evaluateLicenseRisk({
    license: normalized,
    dependency: dependency(packageId),
    profile: item.profile
  });
  return {
    severity: finding.severity,
    confidence: normalized.confidence,
    signals: normalized.signals
  };
}

function declaredLicenseClaims(evidence: Omit<LicenseEvidence, "packageId">): string[] {
  return [
    evidence.packageJsonLicense,
    evidence.metadataLicense,
    ...(Array.isArray(evidence.packageJsonLicenses)
      ? evidence.packageJsonLicenses.flatMap((item) =>
          typeof item === "object" && item !== null && "type" in item
            ? [String(item.type)]
            : typeof item === "string"
              ? [item]
              : [])
      : [])
  ].filter((claim): claim is string => claim !== undefined);
}

function dependency(packageId: string): DependencyNode {
  return {
    id: packageId,
    name: packageId.slice(0, packageId.lastIndexOf("@")),
    version: "1.0.0",
    ecosystem: "npm",
    dependencyType: "production",
    direct: true,
    paths: [["gold-corpus", packageId]]
  };
}
