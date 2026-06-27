import { describe, expect, test } from "bun:test";

import type { LicenseEvidence } from "../src/evidence/types";
import type { DependencyGraph } from "../src/graph/types";
import type { NormalizedLicense } from "../src/license/types";
import type { RiskFinding } from "../src/policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../src/policy/waivers";
import type { ProjectInput } from "../src/project/discover";
import { renderScanReport, type ScanReportInput } from "../src/report/scan-report";

const finding: RiskFinding = {
  id: "risk<script>@1.0.0::production::direct::fixture>risk<script>@1.0.0",
  fingerprint: "risk<script>@1.0.0::high::replace::unsafe & risky",
  packageId: "risk<script>@1.0.0",
  severity: "high",
  reason: "License text contains <script>alert(1)</script> & quotes.",
  action: "Replace this package before shipping.",
  dependencyType: "production",
  dependencyScope: "direct",
  evidence: ["package.json license: Custom <unsafe>"],
  paths: [["fixture-app", "risk<script>@1.0.0"]],
  recommendation: "replace"
};

const waiver: RiskWaiver = {
  fingerprint: finding.fingerprint,
  reason: "Temporary review waiver <not trusted>.",
  expiresOn: "2026-12-31"
};

function scanInput(overrides: Partial<ScanReportInput> = {}): ScanReportInput {
  const project: ProjectInput = {
    rootDir: "/tmp/fixture-app",
    lockfile: {
      kind: "bun",
      path: "/tmp/fixture-app/bun.lock"
    }
  };
  const graph: DependencyGraph = {
    rootName: "fixture-app",
    lockfilePath: "/tmp/fixture-app/bun.lock",
    nodes: [
      {
        id: finding.packageId,
        name: "risk<script>",
        version: "1.0.0",
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: finding.paths
      }
    ]
  };
  const evidence: LicenseEvidence[] = [
    {
      packageId: finding.packageId,
      packageJsonLicense: "Custom",
      files: [],
      source: "local",
      warnings: ["No LICENSE file found."]
    }
  ];
  const normalizedLicenses: NormalizedLicense[] = [
    {
      packageId: finding.packageId,
      original: "Custom",
      choices: [],
      joiner: "single",
      signals: ["custom-text"],
      evidenceSources: ["package.json"],
      confidence: "low"
    }
  ];
  const waivedFindings: WaivedRiskFinding[] = [
    {
      finding,
      waiver,
      matchedBy: "fingerprint"
    }
  ];

  return {
    project,
    graph,
    evidence,
    normalizedLicenses,
    riskFindings: [finding],
    profile: "saas",
    prodOnly: false,
    json: false,
    markdown: false,
    html: true,
    waiverMode: "local",
    waivedFindings,
    expiredWaivers: [waiver],
    unmatchedWaivers: [waiver],
    ...overrides
  };
}

describe("HTML scan report", () => {
  test("renders a browser-friendly report with escaped dynamic content", () => {
    const output = renderScanReport(scanInput());

    expect(output).toStartWith("<!doctype html>");
    expect(output).toContain('<main class="page">');
    expect(output).toContain("<h1>Ohrisk scan</h1>");
    expect(output).toContain("<caption>Active license-risk findings</caption>");
    expect(output).toContain("fixture-app");
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; quotes.");
    expect(output).toContain("Temporary review waiver &lt;not trusted&gt;.");
    expect(output).not.toContain("<script>alert(1)</script>");
  });

  test("renders empty states when no findings or waivers exist", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [],
      waivedFindings: [],
      expiredWaivers: [],
      unmatchedWaivers: []
    }));

    expect(output).toContain("No active findings.");
    expect(output).toContain("No waived findings.");
    expect(output).toContain("No expired waivers.");
    expect(output).toContain("No unmatched waivers.");
  });
});
