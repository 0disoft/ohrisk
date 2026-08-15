import { describe, expect, test } from "bun:test";

import type { LicenseEvidence } from "../src/evidence/types";
import type { DependencyNode } from "../src/graph/types";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import type {
  NormalizedLicenseConfidence,
  NormalizedLicenseSignal
} from "../src/license/types";
import { evaluateLicenseRisk } from "../src/policy/evaluate";
import type { UsageProfile } from "../src/policy/profiles";
import type { RiskSeverity } from "../src/policy/types";

type GoldCase = {
  id: string;
  evidence: Omit<LicenseEvidence, "packageId">;
  profile: UsageProfile;
  expected: {
    severity: RiskSeverity;
    confidence: NormalizedLicenseConfidence;
    signals?: NormalizedLicenseSignal[];
  };
};

const LICENSE_DECISION_GOLD_CORPUS: GoldCase[] = [
  {
    id: "permissive-metadata",
    evidence: evidence({ packageJsonLicense: "MIT" }),
    profile: "distributed-app",
    expected: { severity: "low", confidence: "high" }
  },
  {
    id: "metadata-file-conflict",
    evidence: evidence({
      packageJsonLicense: "MIT",
      files: [licenseFile("LICENSE", "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007")]
    }),
    profile: "distributed-app",
    expected: {
      severity: "unknown",
      confidence: "low",
      signals: ["conflicting-evidence"]
    }
  },
  {
    id: "dual-license-or",
    evidence: evidence({ packageJsonLicense: "MIT OR GPL-3.0-only" }),
    profile: "distributed-app",
    expected: { severity: "low", confidence: "high" }
  },
  {
    id: "combined-license-and",
    evidence: evidence({ packageJsonLicense: "MIT AND GPL-3.0-only" }),
    profile: "distributed-app",
    expected: { severity: "high", confidence: "high" }
  },
  {
    id: "copyleft-exception",
    evidence: evidence({
      packageJsonLicense: "GPL-2.0-only WITH Classpath-exception-2.0"
    }),
    profile: "distributed-app",
    expected: { severity: "review", confidence: "high" }
  },
  {
    id: "deprecated-spdx",
    evidence: evidence({ packageJsonLicense: "GPL-2.0" }),
    profile: "distributed-app",
    expected: { severity: "high", confidence: "medium" }
  },
  {
    id: "custom-license-ref",
    evidence: evidence({ packageJsonLicense: "LicenseRef-Proprietary-Terms" }),
    profile: "saas",
    expected: { severity: "unknown", confidence: "low", signals: ["custom-text"] }
  },
  {
    id: "bsd-four-clause",
    evidence: evidence({
      files: [licenseFile("COPYING", [
        "Redistribution and use in source and binary forms are permitted.",
        "All advertising materials mentioning features or use of this software must display the following acknowledgement.",
        "Neither the name of the organization nor the names of its contributors may be used to endorse products."
      ].join("\n"))]
    }),
    profile: "distributed-app",
    expected: { severity: "review", confidence: "medium" }
  },
  {
    id: "apache-notice",
    evidence: evidence({
      packageJsonLicense: "Apache-2.0",
      files: [{ path: "NOTICE", kind: "notice", text: "Copyright Example Authors" }]
    }),
    profile: "distributed-app",
    expected: { severity: "low", confidence: "high", signals: ["notice-required"] }
  },
  {
    id: "source-available-restriction",
    evidence: evidence({ packageJsonLicense: "BUSL-1.1" }),
    profile: "saas",
    expected: {
      severity: "high",
      confidence: "high",
      signals: ["commercial-restriction"]
    }
  },
  {
    id: "absent-license-assertion",
    evidence: evidence({ packageJsonLicense: "NOASSERTION" }),
    profile: "saas",
    expected: { severity: "unknown", confidence: "low", signals: ["missing"] }
  },
  {
    id: "unlisted-spdx-shaped-id",
    evidence: evidence({ packageJsonLicense: "Definitely-Not-SPDX-9.9" }),
    profile: "saas",
    expected: { severity: "unknown", confidence: "low", signals: ["malformed"] }
  }
];

describe("license decision gold corpus", () => {
  for (const item of LICENSE_DECISION_GOLD_CORPUS) {
    test(item.id, () => {
      const packageId = `${item.id}@1.0.0`;
      const normalized = normalizeLicenseEvidence({ packageId, ...item.evidence });
      const finding = evaluateLicenseRisk({
        license: normalized,
        dependency: dependency(packageId),
        profile: item.profile
      });

      expect(finding.severity).toBe(item.expected.severity);
      expect(normalized.confidence).toBe(item.expected.confidence);
      for (const signal of item.expected.signals ?? []) {
        expect(normalized.signals).toContain(signal);
      }
    });
  }

  test("has zero high-risk false negatives in the pinned corpus", () => {
    const falseNegatives = LICENSE_DECISION_GOLD_CORPUS
      .filter((item) => item.expected.severity === "high")
      .filter((item) => {
        const packageId = `${item.id}@1.0.0`;
        const normalized = normalizeLicenseEvidence({ packageId, ...item.evidence });
        return evaluateLicenseRisk({
          license: normalized,
          dependency: dependency(packageId),
          profile: item.profile
        }).severity !== "high";
      })
      .map((item) => item.id);

    expect(falseNegatives).toEqual([]);
  });
});

function evidence(overrides: Partial<Omit<LicenseEvidence, "packageId">>): Omit<LicenseEvidence, "packageId"> {
  return {
    files: [],
    source: "tarball",
    warnings: [],
    ...overrides
  };
}

function licenseFile(path: string, text: string): LicenseEvidence["files"][number] {
  return { path, kind: "license", text };
}

function dependency(packageId: string): DependencyNode {
  return {
    id: packageId,
    name: packageId.slice(0, packageId.lastIndexOf("@")),
    version: "1.0.0",
    ecosystem: "npm",
    dependencyType: "production",
    direct: true,
    paths: [["gold-corpus", packageId]]
  };
}
