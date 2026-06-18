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
    expect(finding.action).toBe("No action needed for this profile.");
    expect(finding.dependencyType).toBe("production");
    expect(finding.dependencyScope).toBe("direct");
  });

  test("treats common public-domain-style permissive licenses as low risk", () => {
    for (const expression of ["0BSD", "CC0-1.0", "Unlicense"]) {
      const finding = evaluateLicenseRisk({
        license: {
          packageId: "package@1.0.0",
          original: expression,
          expression,
          choices: [expression],
          joiner: "single",
          signals: [],
          evidenceSources: [`source: local`, `package.json license: ${expression}`],
          confidence: "high"
        },
        dependency: baseDependency,
        profile: "distributed-app"
      });

      expect(finding.severity).toBe("low");
      expect(finding.recommendation).toBe("allow");
      expect(finding.action).toBe("No action needed for this profile.");
    }
  });

  test("treats Zlib as a permissive low-risk license", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "Zlib",
        expression: "Zlib",
        choices: ["Zlib"],
        joiner: "single",
        signals: [],
        evidenceSources: ["source: local", "package.json license: Zlib"],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "distributed-app"
    });

    expect(finding.severity).toBe("low");
    expect(finding.recommendation).toBe("allow");
    expect(finding.action).toBe("No action needed for this profile.");
  });

  test("surfaces notice obligations without raising severity", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "Apache-2.0",
        expression: "Apache-2.0",
        choices: ["Apache-2.0"],
        joiner: "single",
        signals: ["notice-required"],
        evidenceSources: [
          "source: local",
          "package.json license: Apache-2.0",
          "file: NOTICE (notice)"
        ],
        confidence: "high"
      },
      dependency: baseDependency,
      profile: "distributed-app"
    });

    expect(finding.severity).toBe("low");
    expect(finding.recommendation).toBe("allow");
    expect(finding.action).toBe(
      "Preserve required NOTICE or attribution files when distributing this package."
    );
    expect(finding.evidence).toContain("signals: notice-required");
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
    expect(finding.action).toBe("Replace this package or escalate before shipping.");
    expect(finding.dependencyType).toBe("production");
    expect(finding.dependencyScope).toBe("direct");
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

  test("marks source-available restriction licenses as high risk", () => {
    for (const expression of [
      "Elastic-2.0",
      "PolyForm-Noncommercial-1.0.0",
      "PolyForm-Free-Trial-1.0.0"
    ]) {
      const finding = evaluateLicenseRisk({
        license: {
          packageId: "package@1.0.0",
          original: expression,
          expression,
          choices: [expression],
          joiner: "single",
          signals: [],
          evidenceSources: [`source: local`, `package.json license: ${expression}`],
          confidence: "high"
        },
        dependency: baseDependency,
        profile: "saas"
      });

      expect(finding.severity).toBe("high");
      expect(finding.recommendation).toBe("replace");
      expect(finding.action).toBe("Replace this package or escalate before shipping.");
    }
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
    expect(finding.action).toBe("Keep this package out of production or scan with --prod.");
    expect(finding.dependencyType).toBe("development");
    expect(finding.dependencyScope).toBe("direct");
  });

  test("explains missing license metadata as a specific unknown risk", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        choices: [],
        joiner: "single",
        signals: ["missing"],
        evidenceSources: ["source: local"],
        confidence: "low"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("unknown");
    expect(finding.reason).toBe("Package metadata does not declare a license expression.");
    expect(finding.recommendation).toBe("collect-evidence");
    expect(finding.action).toBe(
      "Add or verify package license metadata before approving this package."
    );
  });

  test("explains malformed license metadata as a specific unknown risk", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "SEE LICENSE IN LICENSE",
        choices: ["SEE LICENSE IN LICENSE"],
        joiner: "single",
        signals: ["malformed", "custom-text"],
        evidenceSources: ["source: local", "package.json license: SEE LICENSE IN LICENSE"],
        confidence: "low"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("unknown");
    expect(finding.reason).toBe("Package metadata declares a malformed license expression.");
    expect(finding.recommendation).toBe("collect-evidence");
    expect(finding.action).toBe(
      "Fix or manually review the declared license expression before approving this package."
    );
  });

  test("treats explicit commercial restriction signals as high risk", () => {
    const finding = evaluateLicenseRisk({
      license: {
        packageId: "package@1.0.0",
        original: "SEE LICENSE IN LICENSE",
        choices: ["SEE LICENSE IN LICENSE"],
        joiner: "single",
        signals: ["commercial-restriction", "malformed", "custom-text"],
        evidenceSources: ["source: local", "file: LICENSE (license)"],
        confidence: "low"
      },
      dependency: baseDependency,
      profile: "saas"
    });

    expect(finding.severity).toBe("high");
    expect(finding.reason).toBe(
      "License evidence contains an explicit commercial-use restriction for saas."
    );
    expect(finding.recommendation).toBe("replace");
    expect(finding.action).toBe("Replace this package or escalate before shipping.");
    expect(finding.evidence).toContain("signals: commercial-restriction, malformed, custom-text");
  });
});
