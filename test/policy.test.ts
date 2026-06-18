import { describe, expect, test } from "bun:test";

import type { DependencyNode } from "../src/graph/types";
import { evaluateLicenseRisk } from "../src/policy/evaluate";

const baseDependency: DependencyNode = {
  id: "package@1.0.0",
  name: "package",
  version: "1.0.0",
  ecosystem: "npm",
  dependencyType: "production",
  direct: true,
  paths: [["root", "package@1.0.0"]]
};

describe("evaluateLicenseRisk", () => {
  test("treats permissive licenses as low risk", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "MIT",
        expression: "MIT",
        choices: ["MIT"],
        joiner: "single",
        signals: [],
        evidenceSources: ["source: local", "package.json license: MIT"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("low");
    expect(finding.recommendation).toBe("allow");
  });

  test("uses the least risky branch for OR expressions", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "MIT OR AGPL-3.0-only",
        expression: "MIT OR AGPL-3.0-only",
        choices: ["MIT", "AGPL-3.0-only"],
        joiner: "or",
        signals: [],
        evidenceSources: ["source: local", "package.json license: MIT OR AGPL-3.0-only"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "distributed-app"
    });

    expect(finding.severity).toBe("low");
  });

  test("uses the riskiest branch for AND expressions", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "MIT AND AGPL-3.0-only",
        expression: "MIT AND AGPL-3.0-only",
        choices: ["MIT", "AGPL-3.0-only"],
        joiner: "and",
        signals: [],
        evidenceSources: ["source: local", "package.json license: MIT AND AGPL-3.0-only"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("high");
    expect(finding.recommendation).toBe("replace");
  });

  test("treats mixed expressions conservatively instead of using OR fallback", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "MIT OR GPL-3.0-only AND Apache-2.0",
        expression: "MIT OR GPL-3.0-only AND Apache-2.0",
        choices: ["MIT", "GPL-3.0-only", "Apache-2.0"],
        joiner: "mixed",
        signals: [],
        evidenceSources: [
          "source: local",
          "package.json license: MIT OR GPL-3.0-only AND Apache-2.0"
        ],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "distributed-app"
    });

    expect(finding.severity).toBe("high");
  });

  test("marks AGPL as high risk for SaaS", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "AGPL-3.0-only",
        expression: "AGPL-3.0-only",
        choices: ["AGPL-3.0-only"],
        joiner: "single",
        signals: [],
        evidenceSources: ["source: local", "package.json license: AGPL-3.0-only"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("high");
    expect(finding.recommendation).toBe("replace");
  });

  test("marks UNLICENSED packages as high risk", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "UNLICENSED",
        expression: "UNLICENSED",
        choices: ["UNLICENSED"],
        joiner: "single",
        signals: [],
        evidenceSources: ["source: local", "package.json license: UNLICENSED"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("high");
    expect(finding.recommendation).toBe("replace");
  });

  test("is stricter for GPL in distributed apps than SaaS", () => {
    const license = {
      packageId: "package@1.0.0",
      original: "GPL-3.0-only",
      expression: "GPL-3.0-only",
      choices: ["GPL-3.0-only"],
      joiner: "single",
      signals: [],
      evidenceSources: ["source: local", "package.json license: GPL-3.0-only"],
      confidence: "high" as const
    };

    expect(
      evaluateLicenseRisk({
        license,
        dependency: baseDependency,
        profile: "saas"
      }).severity
    ).toBe("review");

    expect(
      evaluateLicenseRisk({
        license,
        dependency: baseDependency,
        profile: "distributed-app"
      }).severity
    ).toBe("high");
  });

  test("recommends excluding dev-only risky packages from production scans", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "BUSL-1.1",
        expression: "BUSL-1.1",
        choices: ["BUSL-1.1"],
        joiner: "single",
        signals: [],
        evidenceSources: ["source: local", "package.json license: BUSL-1.1"],
        confidence: "high"
      },
      dependency: {
        ...baseDependency,
        dependencyType: "development"
      },
      profile: "saas"
    });

    expect(finding.severity).toBe("high");
    expect(finding.recommendation).toBe("exclude-dev-only");
  });
});
