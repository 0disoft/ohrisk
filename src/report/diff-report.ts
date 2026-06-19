import type { RiskDiff } from "../diff/compare";
import { NOTICE_ACTION } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { UsageProfile } from "../policy/profiles";
import {
  formatMarkdownInlineCode,
  formatMarkdownTableCell,
  formatMarkdownTableCode
} from "./markdown";
import { buildThresholdSummary, formatThresholdSummary } from "./threshold-summary";

export type DiffReportInput = {
  baselineRef: string;
  profile: UsageProfile;
  prodOnly: boolean;
  diff: RiskDiff;
  json: boolean;
  markdown: boolean;
  failOn?: RiskSeverity;
};

export function renderDiffReport(input: DiffReportInput): string {
  const summary = summarize(input.diff.newFindings);
  const nextAction = nextActionFor(input.diff.newFindings);
  const thresholdSummary = buildThresholdSummary(input.diff.newFindings, input.failOn);

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
        nextAction,
        ...thresholdSummary,
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
    `Findings: ${input.diff.currentFindings.length} current, ${input.diff.baselineFindings.length} baseline, ${input.diff.newFindings.length} new or changed`,
    `New or changed risks: ${summary.high} high, ${summary.review} review, ${summary.unknown} unknown, ${summary.low} low`,
    ...renderThresholdLines(thresholdSummary),
    "Status: profile-aware risk diff evaluated",
    "",
    ...renderNewFindings(input.diff.newFindings),
    "",
    `Next: ${nextAction}`
  ].join("\n");
}

function renderMarkdownReport(
  input: DiffReportInput,
  summary: Record<RiskSeverity, number>
): string {
  const nextAction = nextActionFor(input.diff.newFindings);
  const thresholdSummary = buildThresholdSummary(input.diff.newFindings, input.failOn);

  return [
    "# Ohrisk diff",
    "",
    `- Baseline: ${formatMarkdownInlineCode(input.baselineRef)}`,
    `- Profile: ${formatMarkdownInlineCode(input.profile)}`,
    `- Production only: ${formatMarkdownInlineCode(input.prodOnly ? "yes" : "no")}`,
    `- Findings: ${formatMarkdownInlineCode(`${input.diff.currentFindings.length} current`)}, ${formatMarkdownInlineCode(`${input.diff.baselineFindings.length} baseline`)}, ${formatMarkdownInlineCode(`${input.diff.newFindings.length} new or changed`)}`,
    `- New or changed risks: ${formatMarkdownInlineCode(`${summary.high} high`)}, ${formatMarkdownInlineCode(`${summary.review} review`)}, ${formatMarkdownInlineCode(`${summary.unknown} unknown`)}, ${formatMarkdownInlineCode(`${summary.low} low`)}`,
    ...renderMarkdownThresholdLines(thresholdSummary),
    "",
    ...renderMarkdownNewFindings(input.diff.newFindings),
    "",
    "## Next",
    "",
    nextAction
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

function renderThresholdLines(thresholdSummary: ReturnType<typeof buildThresholdSummary>): string[] {
  const thresholdLine = formatThresholdSummary(thresholdSummary);
  return thresholdLine ? [thresholdLine] : [];
}

function renderMarkdownThresholdLines(
  thresholdSummary: ReturnType<typeof buildThresholdSummary>
): string[] {
  const thresholdLine = formatThresholdSummary(thresholdSummary);
  return thresholdLine ? [`- ${thresholdLine}`] : [];
}

function renderNewFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["New or changed findings: none"];
  }

  return [
    "New or changed findings:",
    ...findings.flatMap((finding) => [
      `- [${finding.severity}] ${finding.packageId}`,
      `  id: ${finding.id}`,
      `  fingerprint: ${finding.fingerprint}`,
      `  ${finding.reason}`,
      `  recommendation: ${finding.recommendation}`,
      `  action: ${finding.action}`,
      `  dependency: ${formatDependencyContext(finding)}`,
      `  path: ${finding.paths[0]?.join(" -> ") ?? "unknown"}`,
      `  evidence: ${finding.evidence.join("; ")}`
    ])
  ];
}

function renderMarkdownNewFindings(findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return ["## New or changed findings", "", "No new or changed findings."];
  }

  return [
    "## New or changed findings",
    "",
    "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map(
      (finding) =>
        `| ${formatMarkdownTableCode(finding.id)} | ${formatMarkdownTableCode(finding.fingerprint)} | ${finding.severity} | ${formatMarkdownTableCode(finding.packageId)} | ${formatMarkdownTableCell(formatDependencyContext(finding))} | ${formatMarkdownTableCell(finding.reason)} | ${finding.recommendation} | ${formatMarkdownTableCell(finding.action)} | ${formatMarkdownTableCell(finding.paths[0]?.join(" -> ") ?? "unknown")} |`
    )
  ];
}

function formatDependencyContext(finding: RiskFinding): string {
  return `${finding.dependencyType} ${finding.dependencyScope}`;
}

function nextActionFor(findings: RiskFinding[]): string {
  if (findings.length === 0) {
    return "No new or changed license risk introduced by this diff.";
  }

  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Block or escalate new or changed high-risk dependencies before merging.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Collect evidence for new or changed unknown license findings before merging.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Review new or changed flagged dependencies before merging.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Confirm new or changed dev-only risk stays out of production before merging.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Preserve required NOTICE or attribution files for new or changed packages.";
  }

  return "No blocking action for new or changed low-risk findings.";
}
