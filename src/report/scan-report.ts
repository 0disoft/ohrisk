import path from "node:path";

import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import { NOTICE_ACTION } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../policy/waivers";
import type { ProjectInput } from "../project/discover";
import {
  formatMarkdownInlineCode,
  formatMarkdownTableCell,
  formatMarkdownTableCode
} from "./markdown";
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
  waiverMode: "local" | "ignored";
  failOn?: RiskSeverity;
  strictWaivers?: boolean;
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
};

export function renderScanReport(input: ScanReportInput): string {
  const summary = buildScanSummary(input);
  const nextAction = nextActionFor(input.riskFindings);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);

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
        waiverMode: input.waiverMode,
        waivers: summary.waivers,
        nextAction,
        ...thresholdSummary,
        ...waiverDriftSummary,
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
    `Waiver mode: ${formatWaiverMode(input.waiverMode)}`,
    `Waived: ${summary.waivers.applied} applied, ${summary.waivers.expired} expired, ${summary.waivers.unmatched} unmatched`,
    ...renderThresholdLines(thresholdSummary),
    ...renderWaiverDriftLines(waiverDriftSummary),
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
  const waiverDriftSummary = buildWaiverDriftSummary(input);

  return [
    "# Ohrisk scan",
    "",
    `- Project: ${formatMarkdownInlineCode(input.project.rootDir)}`,
    `- Lockfile: ${formatMarkdownInlineCode(path.basename(input.project.lockfile.path))} (${formatMarkdownInlineCode(input.project.lockfile.kind)})`,
    `- Profile: ${formatMarkdownInlineCode(input.profile)}`,
    `- Production only: ${formatMarkdownInlineCode(input.prodOnly ? "yes" : "no")}`,
    `- Dependencies: ${formatMarkdownInlineCode(`${summary.dependencyGraph.total} total`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.direct} direct`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.transitive} transitive`)}`,
    `- Evidence: ${formatMarkdownInlineCode(`${summary.evidence.files} files`)}, ${formatMarkdownInlineCode(`${summary.evidence.warnings} warnings`)}`,
    `- Licenses: ${formatMarkdownInlineCode(`${summary.licenses.highConfidence} high-confidence`)}, ${formatMarkdownInlineCode(`${summary.licenses.mediumConfidence} medium-confidence`)}, ${formatMarkdownInlineCode(`${summary.licenses.lowConfidence} low-confidence`)}`,
    `- License issues: ${formatMarkdownInlineCode(`${summary.licenses.missing} missing`)}, ${formatMarkdownInlineCode(`${summary.licenses.malformed} malformed`)}`,
    `- Risks: ${formatMarkdownInlineCode(`${summary.risks.high} high`)}, ${formatMarkdownInlineCode(`${summary.risks.review} review`)}, ${formatMarkdownInlineCode(`${summary.risks.unknown} unknown`)}, ${formatMarkdownInlineCode(`${summary.risks.low} low`)}`,
    `- Waiver mode: ${formatMarkdownInlineCode(formatWaiverMode(input.waiverMode))}`,
    `- Waived: ${formatMarkdownInlineCode(`${summary.waivers.applied} applied`)}, ${formatMarkdownInlineCode(`${summary.waivers.expired} expired`)}, ${formatMarkdownInlineCode(`${summary.waivers.unmatched} unmatched`)}`,
    ...renderMarkdownThresholdLines(thresholdSummary),
    ...renderMarkdownWaiverDriftLines(waiverDriftSummary),
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

function buildWaiverDriftSummary(input: ScanReportInput):
  | {
      strictWaivers: true;
      waiverDriftFailed: boolean;
      waiverDriftCount: number;
    }
  | Record<string, never> {
  if (!input.strictWaivers) {
    return {};
  }

  const waiverDriftCount = input.expiredWaivers.length + input.unmatchedWaivers.length;
  return {
    strictWaivers: true,
    waiverDriftFailed: waiverDriftCount > 0,
    waiverDriftCount
  };
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
      `  fingerprint: ${finding.fingerprint}`,
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
      `  fingerprint: ${waived.finding.fingerprint}`,
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
    "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map(
      (finding) =>
        `| ${formatMarkdownTableCode(finding.id)} | ${formatMarkdownTableCode(finding.fingerprint)} | ${finding.severity} | ${formatMarkdownTableCode(finding.packageId)} | ${formatMarkdownTableCell(formatDependencyContext(finding))} | ${formatMarkdownTableCell(finding.reason)} | ${finding.recommendation} | ${formatMarkdownTableCell(finding.action)} | ${formatMarkdownTableCell(formatPath(finding.paths[0]))} |`
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
    "| ID | Fingerprint | Severity | Package | Matched by | Reason | Action |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...waivedFindings.map(
      (waived) =>
        `| ${formatMarkdownTableCode(waived.finding.id)} | ${formatMarkdownTableCode(waived.finding.fingerprint)} | ${waived.finding.severity} | ${formatMarkdownTableCode(waived.finding.packageId)} | ${waived.matchedBy} | ${formatMarkdownTableCell(waived.waiver.reason)} | ${formatMarkdownTableCell(waived.finding.action)} |`
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
        `| ${formatMarkdownTableCell(formatWaiverTarget(waiver))} | ${formatMarkdownTableCell(waiver.expiresOn ?? "unknown")} | ${formatMarkdownTableCell(waiver.reason)} |`
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
        `| ${formatMarkdownTableCell(formatWaiverTarget(waiver))} | ${formatMarkdownTableCell(waiver.reason)} |`
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

function renderWaiverDriftLines(
  waiverDriftSummary: ReturnType<typeof buildWaiverDriftSummary>
): string[] {
  const waiverDriftLine = formatWaiverDriftSummary(waiverDriftSummary);
  return waiverDriftLine ? [waiverDriftLine] : [];
}

function renderMarkdownThresholdLines(
  thresholdSummary: ReturnType<typeof buildThresholdSummary>
): string[] {
  const thresholdLine = formatThresholdSummary(thresholdSummary);
  return thresholdLine ? [`- ${thresholdLine}`] : [];
}

function renderMarkdownWaiverDriftLines(
  waiverDriftSummary: ReturnType<typeof buildWaiverDriftSummary>
): string[] {
  const waiverDriftLine = formatWaiverDriftSummary(waiverDriftSummary);
  return waiverDriftLine ? [`- ${waiverDriftLine}`] : [];
}

function formatWaiverMode(waiverMode: ScanReportInput["waiverMode"]): string {
  return waiverMode === "ignored" ? "ignored (--no-waivers)" : "local (.ohrisk-waivers.json)";
}

function formatWaiverDriftSummary(
  waiverDriftSummary: ReturnType<typeof buildWaiverDriftSummary>
): string | undefined {
  if (!("strictWaivers" in waiverDriftSummary)) {
    return undefined;
  }

  const status = waiverDriftSummary.waiverDriftFailed ? "failed" : "passed";
  return `Waiver drift: ${status} (${waiverDriftSummary.waiverDriftCount} expired or unmatched waivers)`;
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
