import { describe, expect, test } from "bun:test";

import { NOTICE_ACTION } from "../src/policy/evaluate";
import type { RiskFinding } from "../src/policy/types";
import { renderDiffReport } from "../src/report/diff-report";

function noticeFinding(): RiskFinding {
  return {
    id: "notice-package@1.0.0::production::direct::fixture>notice-package@1.0.0",
    fingerprint: "notice-package@1.0.0::low::allow::notice",
    packageId: "notice-package@1.0.0",
    severity: "low",
    reason: "License expression is low risk for distributed-app.",
    action: NOTICE_ACTION,
    dependencyType: "production",
    dependencyScope: "direct",
    evidence: ["license: MIT", "signals: notice-required"],
    paths: [["fixture", "notice-package@1.0.0"]],
    recommendation: "allow"
  };
}

describe("renderDiffReport", () => {
  test("surfaces attribution work for new or changed notice findings", () => {
    const finding = noticeFinding();
    const output = renderDiffReport({
      baselineRef: "main",
      profile: "distributed-app",
      prodOnly: true,
      diff: {
        baselineFindings: [],
        currentFindings: [finding],
        newFindings: [finding]
      },
      json: false,
      markdown: false
    });

    expect(output).toContain("New or changed risks: 0 high, 0 review, 0 unknown, 1 low");
    expect(output).toContain("New or changed findings:");
    expect(output).toContain("- [low] notice-package@1.0.0");
    expect(output).toContain(
      "Next: Preserve required NOTICE or attribution files for new or changed packages."
    );
  });

  test("includes notice next action in JSON diff output", () => {
    const finding = noticeFinding();
    const payload = JSON.parse(
      renderDiffReport({
        baselineRef: "main",
        profile: "distributed-app",
        prodOnly: true,
        diff: {
          baselineFindings: [],
          currentFindings: [finding],
          newFindings: [finding]
        },
        json: true,
        markdown: false
      })
    ) as { nextAction: string };

    expect(payload.nextAction).toBe(
      "Preserve required NOTICE or attribution files for new or changed packages."
    );
  });
});
