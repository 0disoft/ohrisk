import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { ProjectInput } from "../project/discover";

export type ScanReportInput = {
  project: ProjectInput;
  graph: DependencyGraph;
  evidence: LicenseEvidence[];
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  profile: string;
  prodOnly: boolean;
  json: boolean;
  markdown: boolean;
};

export function renderScanReport(input: ScanReportInput): string {
  const summary = buildScanSummary(input);

  if (input.json) {
    return JSON.stringify(
      {
        status: "profile_risk_evaluated",
        projectRoot: input.project.rootDir,
        lockfile: {
          kind: input.project.lockfile.kind,
          path: input.project.lockfile.path
        },
        profile: input.profile,
        prodOnly: input.prodOnly,
        dependencyGraph: summary.dependencyGraph,
        evidence: summary.evidence,
        licenses: summary.licenses,
        risks: summary.risks,
        findings: input.riskFindings
      },
      null,
      2
    );
  }

  if (input.markdown) {
    return renderMarkdownReport(input, summary);
  }

  return [
    "Ohrisk scan",
    `Project: ${input.project.rootDir}`,
    `Lockfile: ${path.basename(input.project.lockfile.path)} (${input.project.lockfile.kind})`,
    `Profile: ${input.profile}`,
    `Production only: ${input.prodOnly ? "yes" : "no"}`,
    `Dependencies: ${summary.dependencyGraph.total} total, ${summary.dependencyGraph.direct} direct, ${summary.dependencyGraph.transitive} transitive`,
    `Evidence: ${summary.evidence.files} files, ${summary.evidence.warnings} warnings`,
    `Licenses: ${summary.licenses.highConfidence} high-confidence, ${summary.licenses.mediumConfidence} medium-confidence, ${summary.licenses.lowConfidence} low-confidence`,
    `Risks: ${summary.risks.high} high, ${summary.risks.review} review, ${summary.risks.unknown} unknown, ${summary.risks.low} low`,
    "Status: profile-aware risk evaluated",
    "",
    ...renderFindings(input.riskFindings),
    "",
    "Next: collect missing evidence or replace high-risk production dependencies."
  ].join("\n");
}

function renderMarkdownReport(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): string {
  return [
    "# Ohrisk scan",
    "",
    `- Project: \`${input.project.rootDir}\``,
    `- Lockfile: \`${path.basename(input.project.lockfile.path)}\` (\`${input.project.lockfile.kind}\`)`,
    `- Profile: \`${input.profile}\``,
    `- Production only: \`${input.prodOnly ? "yes" : "no"}\``,
    `- Dependencies: \`${summary.dependencyGraph.total} total\`, \`${summary.dependencyGraph.direct} direct\`, \`${summary.dependencyGraph.transitive} transitive\``,
    `- Evidence: \`${summary.evidence.files} files\`, \`${summary.evidence.warnings} warnings\``,
    `- Risks: \`${summary.risks.high} high\`, \`${summary.risks.review} review\`, \`${summary.risks.unknown} unknown\`, \`${summary.risks.low} low\``,
    "",
    ...renderMarkdownFindings(input.riskFindings),
    "",
    "## Next",
    "",
    "Collect missing evidence or replace high-risk production dependencies."
  ].join("\n");
}

function buildScanSummary(input: ScanReportInput): {
  dependencyGraph: {
    total: number;
    direct: number;
    transitive: number;
  };
  evidence: {
    packages: number;
    files: number;
    warnings: number;
  };
  licenses: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    missing: number;
    malformed: number;
  };
  risks: Record<RiskSeverity, number>;
} {
  const directCount = input.graph.nodes.filter((node) => node.direct).length;
  const transitiveCount = input.graph.nodes.length - directCount;
  const evidenceFileCount = input.evidence.reduce((sum, item) => sum + item.files.length, 0);
  const evidenceWarningCount = input.evidence.reduce((sum, item) => sum + item.warnings.length, 0);
  const licenseSummary = summarizeLicenses(input.normalizedLicenses);

  return {
    dependencyGraph: {
      total: input.graph.nodes.length,
      direct: directCount,
      transitive: transitiveCount
    },
    evidence: {
      packages: input.evidence.length,
      files: evidenceFileCount,
      warnings: evidenceWarningCount
    },
    licenses: {
      highConfidence: licenseSummary.high,
      mediumConfidence: licenseSummary.medium,
      lowConfidence: licenseSummary.low,
      missing: licenseSummary.missing,
      malformed: licenseSummary.malformed
    },
    risks: summarizeRiskFindings(input.riskFindings)
  };
}

function renderFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["Findings: none"];
  }

  return [
    "Findings:",
    ...findings.flatMap((finding) => [
      `- [${finding.severity}] ${finding.packageId}`,
      `  ${finding.reason}`,
      `  recommendation: ${finding.recommendation}`,
      `  path: ${formatPath(finding.paths[0])}`,
      `  evidence: ${finding.evidence.join("; ")}`
    ])
  ];
}

function renderMarkdownFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["## Findings", "", "No findings."];
  }

  return [
    "## Findings",
    "",
    "| Severity | Package | Recommendation | Path |",
    "| --- | --- | --- | --- |",
    ...findings.map(
      (finding) =>
        `| ${finding.severity} | \`${escapeMarkdownTable(finding.packageId)}\` | ${finding.recommendation} | ${escapeMarkdownTable(formatPath(finding.paths[0]))} |`
    )
  ];
}

function summarizeLicenses(normalizedLicenses: NormalizedLicense[]): {
  high: number;
  medium: number;
  low: number;
  missing: number;
  malformed: number;
} {
  return normalizedLicenses.reduce(
    (summary, license) => {
      summary[license.confidence] += 1;

      if (license.signals.includes("missing")) {
        summary.missing += 1;
      }

      if (license.signals.includes("malformed")) {
        summary.malformed += 1;
      }

      return summary;
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      missing: 0,
      malformed: 0
    }
  );
}

function summarizeRiskFindings(riskFindings: RiskFinding[]): Record<RiskSeverity, number> {
  return riskFindings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    {
      high: 0,
      review: 0,
      unknown: 0,
      low: 0
    }
  );
}

function formatPath(pathItems: string[] | undefined): string {
  return pathItems?.join(" -> ") ?? "unknown";
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
