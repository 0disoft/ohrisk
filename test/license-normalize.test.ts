import { describe, expect, test } from "bun:test";

import { normalizeLicenseEvidence } from "../src/license/normalize";
import { parseSpdxExpression } from "../src/license/spdx";

describe("parseSpdxExpression", () => {
  test("parses simple OR expressions", () => {
    expect(parseSpdxExpression("MIT OR Apache-2.0")).toEqual({
      original: "MIT OR Apache-2.0",
      expression: "MIT OR Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "or",
      malformed: false,
      usedAlias: false
    });
  });

  test("parses simple AND expressions", () => {
    expect(parseSpdxExpression("MIT AND Apache-2.0")).toEqual({
      original: "MIT AND Apache-2.0",
      expression: "MIT AND Apache-2.0",
      choices: ["MIT", "Apache-2.0"],
      joiner: "and",
      malformed: false,
      usedAlias: false
    });
  });

  test("marks mixed AND and OR expressions without pretending to resolve precedence", () => {
    expect(parseSpdxExpression("MIT OR GPL-3.0-only AND Apache-2.0")).toMatchObject({
      original: "MIT OR GPL-3.0-only AND Apache-2.0",
      choices: ["MIT", "GPL-3.0-only", "Apache-2.0"],
      joiner: "mixed",
      malformed: false
    });
  });

  test("normalizes common aliases", () => {
    expect(parseSpdxExpression("MIT License")).toEqual({
      original: "MIT License",
      expression: "MIT",
      choices: ["MIT"],
      joiner: "single",
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
      joiner: "or",
      signals: [],
      evidenceSources: ["source: local", "package.json license: MIT OR Apache-2.0"],
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
      joiner: "single",
      signals: ["missing", "custom-text"],
      evidenceSources: ["source: local", "file: LICENSE (license)"],
      confidence: "low"
    });
  });
});
