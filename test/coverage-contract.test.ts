import { describe, expect, test } from "bun:test";

import { parseLcovSummary } from "../scripts/check-coverage";

describe("coverage gate", () => {
  test("aggregates LCOV line and function totals across files", () => {
    const summary = parseLcovSummary([
      "TN:",
      "SF:/repo/src/a.ts",
      "FNF:4",
      "FNH:3",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:/repo/src/b.ts",
      "FNF:6",
      "FNH:6",
      "LF:20",
      "LH:18",
      "end_of_record"
    ].join("\n"));

    expect(summary.lines).toEqual({ found: 30, hit: 26, ratio: 26 / 30 });
    expect(summary.functions).toEqual({ found: 10, hit: 9, ratio: 0.9 });
  });

  test("rejects empty and internally inconsistent reports", () => {
    expect(() => parseLcovSummary("TN:\nend_of_record\n")).toThrow(
      "did not contain line and function totals"
    );
    expect(() => parseLcovSummary("LF:1\nLH:2\nFNF:1\nFNH:1\n")).toThrow(
      "impossible hit totals"
    );
  });
});
