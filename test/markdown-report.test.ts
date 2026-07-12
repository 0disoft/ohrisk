import { describe, expect, test } from "bun:test";

import type { RiskFinding } from "../src/policy/types";
import { renderDiffReport } from "../src/report/diff-report";
import {
  formatMarkdownInlineCode,
  formatMarkdownTableCell,
  formatMarkdownTableCode
} from "../src/report/markdown";

function riskyFinding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  return {
    id: "risk`id@1.0.0::production::direct::fixture>risk`id@1.0.0",
    fingerprint: "risk`id@1.0.0::high::replace::unsafe | reason",
    packageId: "risk`id@1.0.0",
    severity: "high",
    reason: "License text has `ticks`, a | pipe, and\nanother line.",
    action: "Replace this package or escalate before shipping.",
    dependencyType: "production",
    dependencyScope: "direct",
    evidence: ["license: Custom"],
    paths: [["fixture", "risk`id@1.0.0"]],
    recommendation: "replace",
    ...overrides
  };
}

describe("Markdown report formatting", () => {
  test("formats inline code with embedded backticks", () => {
    expect(formatMarkdownInlineCode("release`candidate")).toBe("`` release`candidate ``");
  });

  test("escapes table text that can break Markdown tables", () => {
    expect(formatMarkdownTableCell("one | two\n`tag` <b>")).toBe("one \\| two \\`tag\\` <b>");
  });

  test("formats table code cells with embedded backticks without splitting columns", () => {
    expect(formatMarkdownTableCode("pkg`name | value")).toBe(
      "<code>pkg&#96;name &#124; value</code>"
    );
  });

  test("renders Markdown diff output for hostile baseline and finding text", () => {
    const finding = riskyFinding();
    const output = renderDiffReport({
      baselineRef: "main`release",
      profile: "saas",
      prodOnly: true,
      lockfileChanges: { current: [], baseline: [], added: [], removed: [] },
      diff: {
        baselineFindings: [],
        currentFindings: [finding],
        newFindings: [finding]
      },
      json: false,
      markdown: true
    });

    expect(output).toContain("- Baseline: `` main`release ``");
    expect(output).toContain(
      "<code>risk&#96;id@1.0.0::high::replace::unsafe &#124; reason</code>"
    );
    expect(output).toContain("License text has \\`ticks\\`, a \\| pipe, and another line.");
    expect(output).not.toContain("and\nanother line");
  });
});
