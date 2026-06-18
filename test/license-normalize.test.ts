import { describe, expect, test } from "bun:test";

import { normalizeLicenseEvidence } from "../src/license/normalize";
import { parseSpdxExpression } from "../src/license/spdx";

describe("parseSpdxExpression", () => {
  test("parses simple OR expressions", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0")).toEqual({
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      malformed: false,
      usedAlias: false
    });
  });

  test("normalizes common aliases", () => {
    expect(parseSpdxExpression("MIT License")).toEqual({
      original: "MIT License",
      expression: "MIT",
      choices: ["MIT"],
      malformed: false,
      usedAlias: true
    });
  });

  test("marks malformed expressions", () => {
    const parsed = parseSpdxExpression("not a license ???");

    expect(parsed.malformed).toBe(true);
    expect(parsed.original).toBe("not a license ???");
  });
});

describe("normalizeLicenseEvidence", () => {
  test("uses package.json license as high-confidence expression", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "dual-license@2.0.0",
        packageJsonLicense: "MIT OR Apache-2.0",
        files: [],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "dual-license@2.0.0",
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      signals: [],
      confidence: "high"
    });
  });

  test("marks notice files as notice-required", () => {
    const normalized = normalizeLicenseEvidence({
      packageId: "notice-package@1.0.0",
      packageJsonLicense: "Apache-2.0",
      files: [
        {
          path: "NOTICE",
          kind: "notice",
          text: "Notice text"
        }
      ],
      source: "local",
      warnings: []
    });

    expect(normalized.signals).toContain("notice-required");
  });

  test("marks missing license fields as low-confidence evidence", () => {
    expect(
      normalizeLicenseEvidence({
        packageId: "missing-license@1.0.0",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "Custom terms"
          }
        ],
        source: "local",
        warnings: []
      })
    ).toEqual({
      packageId: "missing-license@1.0.0",
      choices: [],
      signals: ["missing", "custom-text"],
      confidence: "low"
    });
  });
});
