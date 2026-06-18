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
        signals: [],
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
        signals: [],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "distributed-app"
    });

    expect(finding.severity).toBe("low");
  });

  test("marks AGPL as high risk for SaaS", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "AGPL-3.0-only",
        expression: "AGPL-3.0-only",
        choices: ["AGPL-3.0-only"],
        signals: [],
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
      signals: [],
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
        signals: [],
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
