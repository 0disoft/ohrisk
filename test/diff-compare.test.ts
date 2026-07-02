import { describe, expect, test } from "bun:test";

import { diffRiskFindings } from "../src/diff/compare";
import type { RiskFinding } from "../src/policy/types";

function finding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  const base: RiskFinding = {
    id: "package@1.0.0::production::direct::fixture>package@1.0.0",
    fingerprint: "package@1.0.0::high::replace::old reason::old evidence",
    packageId: "package@1.0.0",
    severity: "high",
    reason: "old reason",
    action: "Replace this package or escalate before shipping.",
    dependencyType: "production",
    dependencyScope: "direct",
    evidence: ["old evidence"],
    paths: [["fixture", "package@1.0.0"]],
    recommendation: "replace"
  };

  return {
    ...base,
    ...overrides
  };
}

describe("diffRiskFindings", () => {
  test("reports an existing finding as changed when evidence fingerprint changes", () => {
    const baseline = finding();
    const current = finding({
      fingerprint: "package@1.0.0::high::replace::new reason::new evidence",
      reason: "new reason",
      evidence: ["new evidence"]
    });

    const diff = diffRiskFindings({
      baselineFindings: [baseline],
      currentFindings: [current]
    });

    expect(diff.newFindings).toEqual([current]);
  });

  test("reports an existing package path as new when severity changes", () => {
    const baseline = finding({
      fingerprint: "package@1.0.0::review::review::old reason::old evidence",
      severity: "review",
      recommendation: "review",
      action: "Review this package before shipping."
    });
    const current = finding({
      severity: "high",
      recommendation: "replace",
      action: "Replace this package or escalate before shipping."
    });

    const diff = diffRiskFindings({
      baselineFindings: [baseline],
      currentFindings: [current]
    });

    expect(diff.newFindings).toEqual([current]);
  });

  test("does not report an existing finding as changed when only action prose changes", () => {
    const baseline = finding({
      severity: "low",
      recommendation: "allow",
      action: "No action needed for this profile."
    });
    const current = finding({
      severity: "low",
      recommendation: "allow",
      action: "Preserve required NOTICE or attribution files when distributing this package."
    });

    const diff = diffRiskFindings({
      baselineFindings: [baseline],
      currentFindings: [current]
    });

    expect(diff.newFindings).toEqual([]);
  });
});
