import type { RiskDiff } from "../diff/compare";
import { NOTICE_ACTION } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { UsageProfile } from "../policy/profiles";
import type { PolicyConfigSummary } from "../policy/config";
import {
  formatMarkdownInlineCode,
  formatMarkdownTableCell,
  formatMarkdownTableCode
} from "./markdown";
import { buildThresholdSummary, formatThresholdSummary } from "./threshold-summary";
import {
  OHRISK_DIFF_REPORT_SCHEMA,
  OHRISK_REPORT_SCHEMA_VERSION
} from "./schema";

export type DiffLockfile = {
  kind: string;
  path: string;
};

export type DiffLockfileChanges = {
  current: DiffLockfile[];
  baseline: DiffLockfile[];
  added: DiffLockfile[];
  removed: DiffLockfile[];
};

export type DiffReportInput = {
  baselineRef: string;
  profile: UsageProfile;
  prodOnly: boolean;
  diff: RiskDiff;
  json: boolean;
  markdown: boolean;
  lockfileChanges: DiffLockfileChanges;
  failOn?: RiskSeverity;
  policy?: PolicyConfigSummary;
};

export function renderDiffReport(input: DiffReportInput): string {
  const summary = summarize(input.diff.newFindings);
  const changedSummary = summarize(input.diff.changedFindings);
  const resolvedSummary = summarize(input.diff.resolvedFindings);
  const introducedSummary = summarize(input.diff.introducedFindings);
  const nextAction = nextActionFor(input.diff.introducedFindings);
  const thresholdSummary = buildThresholdSummary(input.diff.introducedFindings, input.failOn);

  if (input.json) {
    return JSON.stringify(
      {
        $schema: OHRISK_DIFF_REPORT_SCHEMA,
        schemaVersion: OHRISK_REPORT_SCHEMA_VERSION,
        status: "risk_diff_evaluated",
        baselineRef: input.baselineRef,
        profile: input.profile,
        prodOnly: input.prodOnly,
        baselineFindingCount: input.diff.baselineFindings.length,
        currentFindingCount: input.diff.currentFindings.length,
        newFindingCount: input.diff.newFindings.length,
        changedFindingCount: input.diff.changedFindings.length,
        resolvedFindingCount: input.diff.resolvedFindings.length,
        introducedFindingCount: input.diff.introducedFindings.length,
        newRisks: summary,
        changedRisks: changedSummary,
        resolvedRisks: resolvedSummary,
        introducedRisks: introducedSummary,
        lockfileChanges: input.lockfileChanges,
        nextAction,
        ...(input.policy ? { policy: input.policy } : {}),
        ...thresholdSummary,
        findings: input.diff.introducedFindings,
        newFindings: input.diff.newFindings,
        changedFindings: input.diff.changedFindings,
        resolvedFindings: input.diff.resolvedFindings
      },
      null,
      2
    );
  }

  if (input.markdown) {
    return renderMarkdownReport(input);
  }

  return [
    "Ohrisk diff",
    `Baseline: ${input.baselineRef}`,
    `Profile: ${input.profile}`,
    `Production only: ${input.prodOnly ? "yes" : "no"}`,
    `Findings: ${input.diff.currentFindings.length} current, ${input.diff.baselineFindings.length} baseline, ${input.diff.newFindings.length} new, ${input.diff.changedFindings.length} changed, ${input.diff.resolvedFindings.length} resolved`,
    ...renderLockfileChangeLines(input.lockfileChanges),
    `Introduced risks: ${introducedSummary.high} high, ${introducedSummary.review} review, ${introducedSummary.unknown} unknown, ${introducedSummary.low} low`,
    ...renderThresholdLines(thresholdSummary),
    "Status: profile-aware risk diff evaluated",
    "",
    ...renderFindings("New findings", input.diff.newFindings),
    "",
    ...renderFindings("Changed findings", input.diff.changedFindings),
    "",
    ...renderFindings("Resolved findings", input.diff.resolvedFindings),
    "",
    `Next: ${nextAction}`
  ].join("\n");
}

function renderMarkdownReport(input: DiffReportInput): string {
  const introducedSummary = summarize(input.diff.introducedFindings);
  const nextAction = nextActionFor(input.diff.introducedFindings);
  const thresholdSummary = buildThresholdSummary(input.diff.introducedFindings, input.failOn);

  return [
    "# Ohrisk diff",
    "",
    `- Baseline: ${formatMarkdownInlineCode(input.baselineRef)}`,
    `- Profile: ${formatMarkdownInlineCode(input.profile)}`,
    `- Production only: ${formatMarkdownInlineCode(input.prodOnly ? "yes" : "no")}`,
    `- Findings: ${formatMarkdownInlineCode(`${input.diff.currentFindings.length} current`)}, ${formatMarkdownInlineCode(`${input.diff.baselineFindings.length} baseline`)}, ${formatMarkdownInlineCode(`${input.diff.newFindings.length} new`)}, ${formatMarkdownInlineCode(`${input.diff.changedFindings.length} changed`)}, ${formatMarkdownInlineCode(`${input.diff.resolvedFindings.length} resolved`)}`,
    ...renderMarkdownLockfileChangeLines(input.lockfileChanges),
    `- Introduced risks: ${formatMarkdownInlineCode(`${introducedSummary.high} high`)}, ${formatMarkdownInlineCode(`${introducedSummary.review} review`)}, ${formatMarkdownInlineCode(`${introducedSummary.unknown} unknown`)}, ${formatMarkdownInlineCode(`${introducedSummary.low} low`)}`,
    ...renderMarkdownThresholdLines(thresholdSummary),
    "",
    ...renderMarkdownFindings("New findings", input.diff.newFindings),
    "",
    ...renderMarkdownFindings("Changed findings", input.diff.changedFindings),
    "",
    ...renderMarkdownFindings("Resolved findings", input.diff.resolvedFindings),
    "",
    "## Next",
    "",
    nextAction
  ].join("\n");
}

function renderLockfileChangeLines(changes: DiffLockfileChanges): string[] {
  return [
    `Lockfiles: ${changes.current.length} current, ${changes.baseline.length} baseline, ${changes.added.length} added, ${changes.removed.length} removed`,
    ...(changes.added.length > 0
      ? [`Added lockfiles: ${changes.added.map(formatLockfile).join(", ")}`]
      : []),
    ...(changes.removed.length > 0
      ? [`Removed lockfiles: ${changes.removed.map(formatLockfile).join(", ")}`]
      : [])
  ];
}

function renderMarkdownLockfileChangeLines(changes: DiffLockfileChanges): string[] {
  return [
    `- Lockfiles: ${formatMarkdownInlineCode(`${changes.current.length} current`)}, ${formatMarkdownInlineCode(`${changes.baseline.length} baseline`)}, ${formatMarkdownInlineCode(`${changes.added.length} added`)}, ${formatMarkdownInlineCode(`${changes.removed.length} removed`)}`,
    ...(changes.added.length > 0
      ? [`- Added lockfiles: ${changes.added.map((lockfile) => formatMarkdownInlineCode(formatLockfile(lockfile))).join(", ")}`]
      : []),
    ...(changes.removed.length > 0
      ? [`- Removed lockfiles: ${changes.removed.map((lockfile) => formatMarkdownInlineCode(formatLockfile(lockfile))).join(", ")}`]
      : [])
  ];
}

function formatLockfile(lockfile: DiffLockfile): string {
  return `${lockfile.path} (${lockfile.kind})`;
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

function renderFindings(label: string, findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return [`${label}: none`];
  }

  return [
    `${label}:`,
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

function renderMarkdownFindings(label: string, findings: RiskFinding[]): string[] {
  if (findings.length === 0) {
    return [`## ${label}`, "", `No ${label.toLowerCase()}.`];
  }

  return [
    `## ${label}`,
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
