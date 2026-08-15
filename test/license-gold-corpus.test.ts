import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import corpusJson from "./fixtures/license-gold-corpus.json" with { type: "json" };
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
  expected: {
    severity: RiskSeverity;
    confidence: NormalizedLicenseConfidence;
    signals?: NormalizedLicenseSignal[];
  };
};

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = corpusJson as GoldCase[];

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
      cases: 20,
      exactMatches: 20,
      expectedHigh: 5,
      highTruePositives: 5,
      expectedNonHigh: 15,
      highFalsePositives: 0,
      expectedUnknown: 4,
      unknownMatches: 4
    });

    const accuracyDoc = readFileSync(path.join(repoRoot, "docs", "accuracy.md"), "utf8");
    expect(accuracyDoc).toContain("20/20");
    expect(accuracyDoc).toContain("5/5");
    expect(accuracyDoc).toContain("0/15");
    expect(accuracyDoc).toContain("4/4");
    expect(accuracyDoc).toContain("not statistically representative");
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
