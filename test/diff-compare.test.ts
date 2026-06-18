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
  test("does not report an existing finding as new when only prose evidence changes", () => {
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

    expect(diff.newFindings).toEqual([]);
  });

  test("reports an existing package path as new when severity changes", () => {
    const baseline = finding({
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
});
