import { describe, expect, test } from "bun:test";

import heldoutJson from "../evaluation/license-heldout.json" with { type: "json" };
import { parseSpdxExpression } from "../src/license/spdx";
import {
  evaluateHeldoutLicenseCases,
  renderHeldoutLicenseReport,
  validateHeldoutLicenseDataset,
  licenseSemanticsMatch,
  type HeldoutLicenseCase
} from "../scripts/license-heldout";

describe("held-out license evaluation", () => {
  test("the reviewed corpus matches license meaning and scope, not just severity", () => {
    const result = evaluateHeldoutLicenseCases(heldoutJson as HeldoutLicenseCase[]);
    expect(result.evaluations.filter((item) => !item.exactDecisionMatch)).toEqual([]);
    expect(result.summary.semanticMismatches).toBe(0);
    expect(result.summary.deferredForInsufficientEvidence).toBe(2);
  });

  test("rejects a different license, operator, exception or scope at the same risk level", () => {
    const observation = { status: "not-run" as const };
    const caseFor = (license: string) => heldoutCase({ id: "semantic-case", license,
      expected: { severity: "low", confidence: "high" }, scancode: observation, licensee: observation });
    for (const [actual, expected] of [["MIT", "ISC"], ["MIT AND Apache-2.0", "MIT OR Apache-2.0"],
      ["Apache-2.0 WITH LLVM-exception", "Apache-2.0"]]) {
      const candidate = caseFor(actual!);
      candidate.expected.license = caseFor(expected!).expected.license!;
      const result = evaluateHeldoutLicenseCases([candidate]).evaluations[0]!;
      expect(result.actual.severity).toBe("low");
      expect(result.actual.confidence).toBe("high");
      expect(result.exactDecisionMatch).toBe(false);
      expect(result.outcome).toBe("semantic-mismatch");
    }
    const bundled = caseFor("MIT");
    bundled.evidence.files.push({ path: "vendor/LICENSE", kind: "license", text: "SPDX-License-Identifier: ISC", scope: "component" });
    bundled.expected.license = { ...caseFor("MIT AND ISC").expected.license!,
      packageExpression: "ISC", componentExpressions: ["MIT"] };
    expect(evaluateHeldoutLicenseCases([bundled]).evaluations[0]!.exactDecisionMatch).toBe(false);
  });

  test("preserves equivalent expression ordering while distinguishing exceptions and scopes", () => {
    const candidate = heldoutCase({ id: "equivalent", license: "MIT AND Apache-2.0",
      expected: { severity: "low", confidence: "high" }, scancode: { status: "not-run" }, licensee: { status: "not-run" } });
    const expected = { ...candidate.expected.license!, expression: "(Apache-2.0 AND MIT)", packageExpression: "Apache-2.0 AND MIT",
      choices: ["Apache-2.0", "MIT"] };
    expect(licenseSemanticsMatch(candidate.expected.license!, expected)).toBe(true);
    expect(licenseSemanticsMatch(candidate.expected.license!, { ...expected, exceptions: ["LLVM-exception"] })).toBe(false);
  });

  test("separates risk direction from unknown decisions and still fails unexpected deferrals", () => {
    const scancode = { status: "not-run" as const }, licensee = scancode;
    const under = heldoutCase({ id: "under", license: "MIT", expected: { severity: "high", confidence: "high" }, scancode, licensee });
    const over = heldoutCase({ id: "over", license: "AGPL-3.0-only", expected: { severity: "low", confidence: "high" }, scancode, licensee });
    const deferred = { ...under, id: "deferred", evidence: { files: [], source: "tarball" as const, warnings: [] } };
    const result = evaluateHeldoutLicenseCases([under, over, deferred]);
    expect(result.summary.underClassifiedRisk).toBe(1);
    expect(result.summary.overClassifiedRisk).toBe(1);
    expect(result.summary.deferredForInsufficientEvidence).toBe(1);
    expect(result.evaluations.every((item) => !item.exactDecisionMatch)).toBe(true);
    expect(result.summary.semanticMismatches).toBe(1);
  });

  test("rejects release expectations that omit semantic fields", () => {
    const candidate = heldoutCase({ id: "missing-semantics", license: "MIT", expected: { severity: "low", confidence: "high" },
      scancode: { status: "not-run" }, licensee: { status: "not-run" } });
    delete candidate.expected.license;
    expect(validateHeldoutLicenseDataset([candidate], 1)).toContain(
      "Held-out case missing-semantics must include a reviewed decision and complete license semantics.");
    expect(evaluateHeldoutLicenseCases([candidate]).evaluations[0]!.exactDecisionMatch).toBe(false);
  });

  test("keeps the release-only dataset structurally separate from the tuning corpus", () => {
    expect(validateHeldoutLicenseDataset(heldoutJson)).toEqual([]);
    expect(heldoutJson).toHaveLength(20);
    expect(heldoutJson.every((item) => item.external.scancode.status === "not-run")).toBe(true);
    expect(heldoutJson.every((item) => item.external.licensee.status === "not-run")).toBe(true);
  });

  test("separates Ohrisk mismatches, external disagreements, and unavailable tools", () => {
    const result = evaluateHeldoutLicenseCases([
      heldoutCase({
        id: "all-agree",
        license: "MIT",
        expected: { severity: "low", confidence: "high" },
        scancode: { status: "detected", expressions: ["MIT"] },
        licensee: { status: "detected", expressions: ["MIT"] }
      }),
      heldoutCase({
        id: "tool-disagreements",
        license: "Apache-2.0",
        expected: { severity: "low", confidence: "high" },
        scancode: { status: "detected", expressions: ["GPL-3.0-only"] },
        licensee: { status: "no-detection" }
      }),
      heldoutCase({
        id: "decision-mismatch",
        license: "AGPL-3.0-only",
        expected: { severity: "low", confidence: "high" },
        scancode: { status: "not-run", note: "fixture" },
        licensee: { status: "error", note: "fixture" }
      })
    ]);

    expect(result.summary).toEqual({
      cases: 3,
      exactDecisionMatches: 2,
      ohriskDecisionMismatches: 1,
      semanticMismatches: 0,
      underClassifiedRisk: 0,
      overClassifiedRisk: 1,
      deferredForInsufficientEvidence: 0,
      scancodeDisagreements: 1,
      licenseeDisagreements: 1,
      unavailableToolObservations: 2
    });
    expect(result.evaluations[0]?.external).toMatchObject({
      scancode: { status: "agree" },
      licensee: { status: "agree" }
    });
  });

  test("renders a stable Markdown disagreement report without breaking table cells", () => {
    const result = evaluateHeldoutLicenseCases([
      heldoutCase({
        id: "pipe|newline\ncase",
        license: "MIT OR Apache-2.0",
        expected: { severity: "low", confidence: "high" },
        scancode: { status: "detected", expressions: ["Apache-2.0 OR MIT"] },
        licensee: { status: "detected", expressions: ["MIT"] }
      })
    ]);

    const report = renderHeldoutLicenseReport(result);
    expect(report).toContain("| Cases | 1 |");
    expect(report).toContain("| ScanCode disagreements | 0 |");
    expect(report).toContain("| Licensee disagreements | 1 |");
    expect(report).toContain("| pipe\\|newline case | [source](https://example.test/license) | low/high | low/high |");
    expect(report.endsWith("\n")).toBe(true);
  });

test("distinguishes SPDX AND from OR when the license terms match", () => {
  const result = evaluateHeldoutLicenseCases([
    heldoutCase({
      id: "operator-mismatch",
      license: "MIT AND Apache-2.0",
      expected: { severity: "low", confidence: "high" },
      scancode: { status: "detected", expressions: ["MIT OR Apache-2.0"] },
      licensee: { status: "detected", expressions: ["Apache-2.0 AND MIT"] }
    })
  ]);

  expect(result.evaluations[0]?.external).toMatchObject({
    scancode: { status: "disagree" },
    licensee: { status: "agree" }
  });
});

  test("does not collapse SPDX exceptions into their base license", () => {
    const result = evaluateHeldoutLicenseCases([
      heldoutCase({
        id: "exception-mismatch",
        license: "GPL-2.0-only WITH Classpath-exception-2.0",
        expected: { severity: "high", confidence: "high" },
        scancode: { status: "detected", expressions: ["GPL-2.0-only"] },
        licensee: {
          status: "detected",
          expressions: ["GPL-2.0-only WITH Classpath-exception-2.0"]
        }
      })
    ]);

    expect(result.evaluations[0]?.external).toMatchObject({
      scancode: { status: "disagree" },
      licensee: { status: "agree" }
    });
  });

  test("rejects duplicate ids and incomplete external observations", () => {
    const invalid = heldoutCase({
      id: "duplicate-case",
      license: "MIT",
      expected: { severity: "low", confidence: "high" },
      scancode: { status: "not-run" },
      licensee: { status: "not-run" }
    });
    expect(validateHeldoutLicenseDataset([
      invalid,
      invalid,
      { ...invalid, id: "missing-external", external: undefined }
    ], 3)).toEqual([
      "Held-out case id is duplicated: duplicate-case.",
      "Held-out case missing-external must include external observations."
    ]);
  });
});

function heldoutCase(input: {
  id: string;
  license: string;
  expected: HeldoutLicenseCase["expected"];
  scancode: HeldoutLicenseCase["external"]["scancode"];
  licensee: HeldoutLicenseCase["external"]["licensee"];
}): HeldoutLicenseCase {
  const parsed = parseSpdxExpression(input.license);
  return {
    id: input.id,
    sourceUrl: "https://example.test/license",
    rationale: "A deterministic evaluation fixture for the held-out report contract.",
    evidence: {
      metadataLicense: input.license,
      metadataSource: "fixture",
      files: [],
      source: "tarball",
      warnings: []
    },
    profile: "saas",
    expected: { ...input.expected, license: input.expected.license ?? {
      expression: parsed.expression ?? null, choices: parsed.choices, joiner: parsed.joiner,
      exceptions: parsed.exceptions, signals: [], packageExpression: parsed.expression ?? null, componentExpressions: []
    } },
    external: {
      scancode: input.scancode,
      licensee: input.licensee
    }
  };
}
