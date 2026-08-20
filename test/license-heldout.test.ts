import { describe, expect, test } from "bun:test";

import heldoutJson from "../evaluation/license-heldout.json" with { type: "json" };
import {
  evaluateHeldoutLicenseCases,
  renderHeldoutLicenseReport,
  validateHeldoutLicenseDataset,
  type HeldoutLicenseCase
} from "../scripts/license-heldout";

describe("held-out license evaluation", () => {
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
    expected: input.expected,
    external: {
      scancode: input.scancode,
      licensee: input.licensee
    }
  };
}
