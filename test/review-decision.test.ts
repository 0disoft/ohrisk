import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { evaluateLicenseRisk } from "../src/policy/evaluate";
import { diffRiskFindings } from "../src/diff/compare";
import { applyRiskWaivers, readRiskWaivers } from "../src/policy/waivers";
import type { UsageProfile } from "../src/policy/profiles";
import { renderDiffReport } from "../src/report/diff-report";

export function reviewedFinding(options: {
  parent?: string; source?: string; profile?: UsageProfile; prodOnly?: boolean;
  expression?: string; ecosystem?: "npm" | "pypi"; direct?: boolean;
} = {}) {
  const expression = options.expression ?? "AGPL-3.0-only";
  return evaluateLicenseRisk({
    dependency: { id: "example@1.0.0", name: "example", version: "1.0.0", ecosystem: options.ecosystem ?? "npm",
      dependencyType: "production", direct: options.direct ?? false,
      paths: [["app", options.parent ?? "parent@1", "example@1.0.0"]] },
    license: { packageId: "example@1.0.0", expression, choices: [expression], joiner: "single", confidence: "high", signals: [],
      evidenceSources: [`file: ${options.source ?? "LICENSE"} (license)`], exceptions: [] },
    profile: options.profile ?? "saas", prodOnly: options.prodOnly ?? false
  });
}

test("decision identity ignores paths, keeps provenance visible, and retains ecosystem and usage scope", () => {
  const old = reviewedFinding();
  const renamed = reviewedFinding({ parent: "another@2", source: "COPYING" });
  expect(renamed.id).not.toBe(old.id);
  expect(renamed.evidenceFingerprint).not.toBe(old.evidenceFingerprint);
  expect(renamed.decision).toEqual(old.decision);
  for (const changed of [reviewedFinding({ ecosystem: "pypi" }), reviewedFinding({ profile: "distributed-app" }),
    reviewedFinding({ prodOnly: true }), reviewedFinding({ direct: true })]) expect(changed.decision?.id).not.toBe(old.decision?.id);
});

test("stable decision waivers require explicit selection and cannot widen through a legacy ID", () => {
  const old = reviewedFinding();
  const renamed = reviewedFinding({ parent: "another@2", source: "COPYING" });
  const waiver = { decisionFingerprint: old.decision!.fingerprint, id: renamed.id, reason: "Reviewed for this use." };
  expect(applyRiskWaivers({ findings: [renamed], waivers: [waiver] }).waivedFindings[0]?.matchedBy).toBe("decisionFingerprint");
  expect(applyRiskWaivers({ findings: [renamed], waivers: [{ id: old.id, reason: "Legacy path scope." }] }).activeFindings).toEqual([renamed]);
  for (const changed of [reviewedFinding({ profile: "distributed-app" }), reviewedFinding({ prodOnly: true }),
    reviewedFinding({ expression: "GPL-3.0-only" }), reviewedFinding({ ecosystem: "pypi" })]) {
    expect(applyRiskWaivers({ findings: [changed], waivers: [{ ...waiver, id: changed.id }] }).activeFindings).toEqual([changed]);
  }
});

test("provenance-only changes are reported without introducing gate risk, while license meaning changes are gated", () => {
  const old = reviewedFinding();
  const renamed = reviewedFinding({ parent: "another@2", source: "COPYING" });
  const diff = diffRiskFindings({ baselineFindings: [old], currentFindings: [renamed] });
  expect(diff.introducedFindings).toEqual([]);
  expect(diff.resolvedFindings).toEqual([]);
  expect(diff.provenanceChangedFindings).toEqual([renamed]);
  const report = JSON.parse(renderDiffReport({ baselineRef: "main", profile: "saas", prodOnly: false, diff,
    json: true, markdown: false, failOn: "high", lockfileChanges: { current: [], baseline: [], added: [], removed: [] } }));
  expect(report.provenanceChangedFindingCount).toBe(1);
  expect(report.failed).toBe(false);
  const changed = diffRiskFindings({ baselineFindings: [old], currentFindings: [reviewedFinding({ expression: "SSPL-1.0" })] });
  expect(changed.changedFindings).toHaveLength(1);
  expect(changed.introducedFindings).toHaveLength(1);
});

test("invalid decision selectors fail parsing rather than silently falling back to an ID", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ohrisk-decision-waiver-"));
  try {
    writeFileSync(path.join(root, ".ohrisk-waivers.json"), JSON.stringify({ waivers: [
      { decisionFingerprint: {}, id: reviewedFinding().id, reason: "Must not widen." }
    ] }));
    const result = readRiskWaivers(root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("decisionFingerprint must be a non-empty string");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ambiguous decision keys fail comparison rather than overwriting one license decision", () => {
  const one = reviewedFinding();
  const another = reviewedFinding({ expression: "SSPL-1.0", parent: "another@2" });
  expect(() => diffRiskFindings({ baselineFindings: [], currentFindings: [one, another] })).toThrow("ambiguous");
  const legacy = { ...one };
  delete legacy.decision;
  const diff = diffRiskFindings({ baselineFindings: [legacy], currentFindings: [one] });
  expect(diff.newFindings).toEqual([one]);
  expect(diff.resolvedFindings).toEqual([legacy]);
});
