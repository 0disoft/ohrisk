import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import { NOTICE_ACTION } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../policy/waivers";
import type { ProjectInput } from "../project/discover";
import { buildThresholdSummary, formatThresholdSummary } from "./threshold-summary";

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
  failOn?: RiskSeverity;
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
};

export function renderScanReport(input: ScanReportInput): string {
  const summary = buildScanSummary(input);
  const nextAction = nextActionFor(input.riskFindings);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);

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
        waivers: summary.waivers,
        nextAction,
        ...thresholdSummary,
        findings: input.riskFindings,
        waivedFindings: input.waivedFindings,
        expiredWaivers: input.expiredWaivers,
        unmatchedWaivers: input.unmatchedWaivers
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
    `License issues: ${summary.licenses.missing} missing, ${summary.licenses.malformed} malformed`,
    `Risks: ${summary.risks.high} high, ${summary.risks.review} review, ${summary.risks.unknown} unknown, ${summary.risks.low} low`,
    `Waived: ${summary.waivers.applied} applied, ${summary.waivers.expired} expired, ${summary.waivers.unmatched} unmatched`,
    ...renderThresholdLines(thresholdSummary),
    "Status: profile-aware risk evaluated",
    "",
    ...renderFindings(input.riskFindings),
    "",
    ...renderWaivedFindings(input.waivedFindings),
    "",
    ...renderExpiredWaivers(input.expiredWaivers),
    "",
    ...renderUnmatchedWaivers(input.unmatchedWaivers),
    "",
    `Next: ${nextAction}`
  ].join("\n");
}

function renderMarkdownReport(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): string {
  const nextAction = nextActionFor(input.riskFindings);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);

  return [
    "# Ohrisk scan",
    "",
    `- Project: \`${input.project.rootDir}\``,
    `- Lockfile: \`${path.basename(input.project.lockfile.path)}\` (\`${input.project.lockfile.kind}\`)`,
    `- Profile: \`${input.profile}\``,
    `- Production only: \`${input.prodOnly ? "yes" : "no"}\``,
    `- Dependencies: \`${summary.dependencyGraph.total} total\`, \`${summary.dependencyGraph.direct} direct\`, \`${summary.dependencyGraph.transitive} transitive\``,
    `- Evidence: \`${summary.evidence.files} files\`, \`${summary.evidence.warnings} warnings\``,
    `- Licenses: \`${summary.licenses.highConfidence} high-confidence\`, \`${summary.licenses.mediumConfidence} medium-confidence\`, \`${summary.licenses.lowConfidence} low-confidence\``,
    `- License issues: \`${summary.licenses.missing} missing\`, \`${summary.licenses.malformed} malformed\``,
    `- Risks: \`${summary.risks.high} high\`, \`${summary.risks.review} review\`, \`${summary.risks.unknown} unknown\`, \`${summary.risks.low} low\``,
    `- Waived: \`${summary.waivers.applied} applied\`, \`${summary.waivers.expired} expired\`, \`${summary.waivers.unmatched} unmatched\``,
    ...renderMarkdownThresholdLines(thresholdSummary),
    "",
    ...renderMarkdownFindings(input.riskFindings),
    "",
    ...renderMarkdownWaivedFindings(input.waivedFindings),
    "",
    ...renderMarkdownExpiredWaivers(input.expiredWaivers),
    "",
    ...renderMarkdownUnmatchedWaivers(input.unmatchedWaivers),
    "",
    "## Next",
    "",
    nextAction
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
  waivers: {
    applied: number;
    expired: number;
    unmatched: number;
  };
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
    risks: summarizeRiskFindings(input.riskFindings),
    waivers: {
      applied: input.waivedFindings.length,
      expired: input.expiredWaivers.length,
      unmatched: input.unmatchedWaivers.length
    }
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
      `  id: ${finding.id}`,
      `  ${finding.reason}`,
      `  recommendation: ${finding.recommendation}`,
      `  action: ${finding.action}`,
      `  dependency: ${formatDependencyContext(finding)}`,
      `  path: ${formatPath(finding.paths[0])}`,
      `  evidence: ${finding.evidence.join("; ")}`
    ])
  ];
}

function renderWaivedFindings(waivedFindings: WaivedRiskFinding[]): string[] {
  if (waivedFindings.length === 0) {
    return ["Waived findings: none"];
  }

  return [
    "Waived findings:",
    ...waivedFindings.flatMap((waived) => [
      `- [${waived.finding.severity}] ${waived.finding.packageId}`,
      `  id: ${waived.finding.id}`,
      `  matched by: ${waived.matchedBy}`,
      `  reason: ${waived.waiver.reason}`,
      `  action: ${waived.finding.action}`
    ])
  ];
}

function renderExpiredWaivers(expiredWaivers: RiskWaiver[]): string[] {
  if (expiredWaivers.length === 0) {
    return ["Expired waivers: none"];
  }

  return [
    "Expired waivers:",
    ...expiredWaivers.flatMap((waiver) => [
      `- ${formatWaiverTarget(waiver)}`,
      `  expires on: ${waiver.expiresOn ?? "unknown"}`,
      `  reason: ${waiver.reason}`
    ])
  ];
}

function renderUnmatchedWaivers(unmatchedWaivers: RiskWaiver[]): string[] {
  if (unmatchedWaivers.length === 0) {
    return ["Unmatched waivers: none"];
  }

  return [
    "Unmatched waivers:",
    ...unmatchedWaivers.flatMap((waiver) => [
      `- ${formatWaiverTarget(waiver)}`,
      `  reason: ${waiver.reason}`
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
    "| ID | Severity | Package | Dependency | Reason | Recommendation | Action | Path |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map(
      (finding) =>
        `| \`${escapeMarkdownTable(finding.id)}\` | ${finding.severity} | \`${escapeMarkdownTable(finding.packageId)}\` | ${escapeMarkdownTable(formatDependencyContext(finding))} | ${escapeMarkdownTable(finding.reason)} | ${finding.recommendation} | ${escapeMarkdownTable(finding.action)} | ${escapeMarkdownTable(formatPath(finding.paths[0]))} |`
    )
  ];
}

function renderMarkdownWaivedFindings(waivedFindings: WaivedRiskFinding[]): string[] {
  if (waivedFindings.length === 0) {
    return ["## Waived findings", "", "No waived findings."];
  }

  return [
    "## Waived findings",
    "",
    "| ID | Severity | Package | Matched by | Reason | Action |",
    "| --- | --- | --- | --- | --- | --- |",
    ...waivedFindings.map(
      (waived) =>
        `| \`${escapeMarkdownTable(waived.finding.id)}\` | ${waived.finding.severity} | \`${escapeMarkdownTable(waived.finding.packageId)}\` | ${waived.matchedBy} | ${escapeMarkdownTable(waived.waiver.reason)} | ${escapeMarkdownTable(waived.finding.action)} |`
    )
  ];
}

function renderMarkdownExpiredWaivers(expiredWaivers: RiskWaiver[]): string[] {
  if (expiredWaivers.length === 0) {
    return ["## Expired waivers", "", "No expired waivers."];
  }

  return [
    "## Expired waivers",
    "",
    "| Target | Expires on | Reason |",
    "| --- | --- | --- |",
    ...expiredWaivers.map(
      (waiver) =>
        `| ${escapeMarkdownTable(formatWaiverTarget(waiver))} | ${escapeMarkdownTable(waiver.expiresOn ?? "unknown")} | ${escapeMarkdownTable(waiver.reason)} |`
    )
  ];
}

function renderMarkdownUnmatchedWaivers(unmatchedWaivers: RiskWaiver[]): string[] {
  if (unmatchedWaivers.length === 0) {
    return ["## Unmatched waivers", "", "No unmatched waivers."];
  }

  return [
    "## Unmatched waivers",
    "",
    "| Target | Reason |",
    "| --- | --- |",
    ...unmatchedWaivers.map(
      (waiver) =>
        `| ${escapeMarkdownTable(formatWaiverTarget(waiver))} | ${escapeMarkdownTable(waiver.reason)} |`
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

function formatPath(pathItems: string[] | undefined): string {
  return pathItems?.join(" -> ") ?? "unknown";
}

function formatDependencyContext(finding: RiskFinding): string {
  return `${finding.dependencyType} ${finding.dependencyScope}`;
}

function formatWaiverTarget(waiver: RiskWaiver): string {
  if (waiver.id) {
    return `id: ${waiver.id}`;
  }

  return `fingerprint: ${waiver.fingerprint ?? "unknown"}`;
}

function nextActionFor(findings: RiskFinding[]): string {
  if (findings.some((finding) => finding.recommendation === "replace")) {
    return "Replace or escalate high-risk dependencies before shipping.";
  }

  if (findings.some((finding) => finding.recommendation === "collect-evidence")) {
    return "Collect missing license evidence before approving this project.";
  }

  if (findings.some((finding) => finding.recommendation === "review")) {
    return "Review flagged dependencies before shipping under this profile.";
  }

  if (findings.some((finding) => finding.recommendation === "exclude-dev-only")) {
    return "Run with --prod or keep dev-only risk out of production.";
  }

  if (findings.some((finding) => finding.action === NOTICE_ACTION)) {
    return "Preserve required NOTICE or attribution files when distributing this project.";
  }

  return "No action needed for this profile.";
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
