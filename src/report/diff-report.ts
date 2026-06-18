import type { RiskDiff } from "../diff/compare";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { UsageProfile } from "../policy/profiles";

export type DiffReportInput = {
  baselineRef: string;
  profile: UsageProfile;
  prodOnly: boolean;
  diff: RiskDiff;
  json: boolean;
  markdown: boolean;
};

export function renderDiffReport(input: DiffReportInput): string {
  const summary = summarize(input.diff.newFindings);

  if (input.json) {
    return JSON.stringify(
      {
        status: "risk_diff_evaluated",
        baselineRef: input.baselineRef,
        profile: input.profile,
        prodOnly: input.prodOnly,
        baselineFindingCount: input.diff.baselineFindings.length,
        currentFindingCount: input.diff.currentFindings.length,
        newFindingCount: input.diff.newFindings.length,
        newRisks: summary,
        findings: input.diff.newFindings
      },
      null,
      2
    );
  }

  if (input.markdown) {
    return renderMarkdownReport(input, summary);
  }

  return [
    "Ohrisk diff",
    `Baseline: ${input.baselineRef}`,
    `Profile: ${input.profile}`,
    `Production only: ${input.prodOnly ? "yes" : "no"}`,
    `Findings: ${input.diff.currentFindings.length} current, ${input.diff.baselineFindings.length} baseline, ${input.diff.newFindings.length} new`,
    `New risks: ${summary.high} high, ${summary.review} review, ${summary.unknown} unknown, ${summary.low} low`,
    "Status: profile-aware risk diff evaluated",
    "",
    ...renderNewFindings(input.diff.newFindings),
    "",
    "Next: block or review new high-risk and unknown production findings before merging."
  ].join("\n");
}

function renderMarkdownReport(
  input: DiffReportInput,
  summary: Record<RiskSeverity, number>
): string {
  return [
    "# Ohrisk diff",
    "",
    `- Baseline: \`${input.baselineRef}\``,
    `- Profile: \`${input.profile}\``,
    `- Production only: \`${input.prodOnly ? "yes" : "no"}\``,
    `- Findings: \`${input.diff.currentFindings.length} current\`, \`${input.diff.baselineFindings.length} baseline\`, \`${input.diff.newFindings.length} new\``,
    `- New risks: \`${summary.high} high\`, \`${summary.review} review\`, \`${summary.unknown} unknown\`, \`${summary.low} low\``,
    "",
    ...renderMarkdownNewFindings(input.diff.newFindings),
    "",
    "## Next",
    "",
    "Block or review new high-risk and unknown production findings before merging."
  ].join("\n");
}

function summarize(findings: RiskFinding[]): Record<RiskSeverity, number> {
  return findings.reduce(
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

function renderNewFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["New findings: none"];
  }

  return [
    "New findings:",
    ...findings.flatMap((finding) => [
      `- [${finding.severity}] ${finding.packageId}`,
      `  ${finding.reason}`,
      `  recommendation: ${finding.recommendation}`,
      `  path: ${finding.paths[0]?.join(" -> ") ?? "unknown"}`,
      `  evidence: ${finding.evidence.join("; ")}`
    ])
  ];
}

function renderMarkdownNewFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["## New findings", "", "No new findings."];
  }

  return [
    "## New findings",
    "",
    "| Severity | Package | Recommendation | Path |",
    "| --- | --- | --- | --- |",
    ...findings.map(
      (finding) =>
        `| ${finding.severity} | \`${escapeMarkdownTable(finding.packageId)}\` | ${finding.recommendation} | ${escapeMarkdownTable(finding.paths[0]?.join(" -> ") ?? "unknown")} |`
    )
  ];
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
