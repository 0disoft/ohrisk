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
  reason: "License text contains <script>alert(1)</script> & 'quotes'.",
  action: "Replace this package before shipping.",
  dependencyType: "production",
  dependencyScope: "direct",
  evidence: ["package.json license: Custom <unsafe> and 'quoted'"],
  paths: [["fixture-app", "risk<script>@1.0.0"]],
  recommendation: "replace"
};

const waiver: RiskWaiver = {
  fingerprint: finding.fingerprint,
  reason: "Temporary review waiver <not trusted> with 'quote'.",
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
    expect(output).toContain('<h2 id="review-summary-heading">Review summary</h2>');
    expect(output).toContain("<dt>Status</dt>");
    expect(output).toContain("<dd>High risk review needed</dd>");
    expect(output).toContain("<dt>Active findings</dt>");
    expect(output).toContain("<dd>1 active (1 high, 0 review, 0 unknown, 0 low)</dd>");
    expect(output).toContain("<dt>Scope</dt>");
    expect(output).toContain("<dd>saas profile, all dependencies</dd>");
    expect(output).toContain("<dt>Review focus</dt>");
    expect(output).toContain("<dd>Replace or escalate high-risk dependencies before shipping.</dd>");
    expect(output).toContain('<fieldset class="finding-filters">');
    expect(output).toContain('data-finding-filter');
    expect(output).toContain('data-finding-search');
    expect(output).toContain('data-finding-dependency-filter');
    expect(output).toContain('data-finding-action-filter');
    expect(output).toContain('value="low" data-finding-filter>');
    expect(output).toContain('<option value="direct">direct (1)</option>');
    expect(output).toContain('<option value="replace">replace (1)</option>');
    expect(output).toContain('<article class="finding-card" data-finding-card data-severity="high" data-dependency-scope="direct" data-recommendation="replace"');
    expect(output).toContain('data-search-text="risk&lt;script&gt;@1.0.0::production::direct::fixture&gt;risk&lt;script&gt;@1.0.0');
    expect(output).toContain("<dt>Severity</dt>");
    expect(output).toContain("<dt>Package</dt>");
    expect(output).toContain("<dt>Dependency</dt>");
    expect(output).toContain("<dt>Reason</dt>");
    expect(output).toContain("<dt>Action</dt>");
    expect(output).toContain("<dt>Path</dt>");
    expect(output).toContain("<dt>Evidence</dt>");
    expect(output).toContain("<dt>Fingerprint</dt>");
    expect(output).toContain('class="finding-detail-value" data-collapsible');
    expect(output).toContain('class="collapsible-content is-collapsed" data-collapsible-content');
    expect(output).toContain('data-collapsible-toggle');
    expect(output).toContain('aria-expanded="false">...</button>');
    expect(output).toContain("max-height: calc(1.5em * 3)");
    expect(output).toContain("const clone = content.cloneNode(true)");
    expect(output).toContain("clone.classList.remove('is-collapsed')");
    expect(output).toContain("return null;");
    expect(output).toContain("refreshVisibleCollapsibles();");
    expect(output).toContain("if (card && !card.hidden)");
    expect(output).not.toContain("if (!card || !card.hidden)");
    expect(output).toContain("toggle.hidden = !overflowed;");
    expect(output).not.toContain("textContent || '').trim().length");
    expect(output).not.toContain("const overflowed = content.scrollHeight > content.clientHeight + 1");
    expect(output).not.toContain("content.classList.remove('is-collapsed')");
    expect(output).not.toContain("toggle.hidden = !overflowed && !expanded");
    expect(output).not.toContain("<caption>Active license-risk findings</caption>");
    expect(output).not.toContain('<th scope="col">Severity</th><th scope="col">Package</th><th scope="col">Dependency</th><th scope="col">Reason</th><th scope="col">Action</th><th scope="col">Path</th><th scope="col">Evidence</th><th scope="col">Fingerprint</th>');
    expect(output).toContain("fixture-app");
    expect(output).toContain("risk&lt;script&gt;@1.0.0");
    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#x27;quotes&#x27;.");
    expect(output).toContain("package.json license: Custom &lt;unsafe&gt; and &#x27;quoted&#x27;");
    expect(output).toContain("Temporary review waiver &lt;not trusted&gt; with &#x27;quote&#x27;.");
    expect(output).not.toContain("<script>alert(1)</script>");
    expect(output).not.toContain("'quotes'");
  });

  test("renders empty states when no findings or waivers exist", () => {
    const output = renderScanReport(scanInput({
      riskFindings: [],
      waivedFindings: [],
      expiredWaivers: [],
      unmatchedWaivers: []
    }));

    expect(output).toContain("No active findings.");
    expect(output).toContain("<dd>No active findings</dd>");
    expect(output).toContain("<dd>0 active (0 high, 0 review, 0 unknown, 0 low)</dd>");
    expect(output).toContain("No waived findings.");
    expect(output).toContain("No expired waivers.");
    expect(output).toContain("No unmatched waivers.");
  });
});
