import { buildScanCompleteness, formatScanCompleteness, type ScanCompleteness } from "../policy/completeness";
import type { GraphGateOutcome, ScanReport } from "../../types/report-types";
import type { LicenseEvidence } from "../evidence/types";
import { formatProjectInputSupport } from "../ecosystems/registry";
import type { DependencyGraph } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../policy/waivers";
import { type PolicyConfigSummary } from "../policy/config";
import type { UsageProfile } from "../policy/profiles";
import { type ProjectInput } from "../project/discover";
import { formatMarkdownInlineCode, formatMarkdownTableCell, formatMarkdownTableCode } from "./markdown";
import type { ReportLanguage } from "./language";
import { buildThresholdSummary, formatThresholdSummary } from "./threshold-summary";
import { OHRISK_REPORT_SCHEMA_VERSION, OHRISK_SCAN_REPORT_SCHEMA } from "./schema";
import { dependencyProvenance, renderAdditionalLockfileLines, renderAdditionalMarkdownLockfileLines, displayLockfiles, disabledPolicySummary, displayLockfilePath, markdownProjectLabel, displayProjectLabel, archiveReportSource, buildWaiverDriftSummary, buildScanSummary, formatWaiverMode, formatWaiverDriftSummary, formatPath, formatDependencyContext, formatWaiverTarget, nextActionFor, hasIncompleteRepositoryCoverage, formatSkippedRepositoryEntrySummary } from "./scan-model";
import { renderHtmlReport } from "./html-scan-report";

export { buildScanCompleteness };
export type { ScanCompleteness };


export type ScanReportInput = {
  project: ProjectInput;
  graph: DependencyGraph;
  evidence: LicenseEvidence[];
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  profile: UsageProfile;
  prodOnly: boolean;
  json: boolean;
  markdown: boolean;
  html: boolean;
  reportLanguage?: ReportLanguage;
  waiverMode: "local" | "ignored";
  failOn?: RiskSeverity;
  strictWaivers?: boolean;
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
  policy?: PolicyConfigSummary;
  repository?: RemoteRepositoryReportSource;
  completeness?: ScanCompleteness;
  graphGate?: GraphGateOutcome;
};

export type RemoteRepositoryReportSource = {
  owner: string;
  name: string;
  submodules: {
    mode: "ignore" | "reject";
    skippedCount: number;
    skippedPaths: string[];
    pathsTruncated: boolean;
  };
  symbolicLinks: {
    skippedCount: number;
    skippedPaths: string[];
    pathsTruncated: boolean;
  };
  nonPortablePaths: {
    skippedCount: number;
    skippedPaths: string[];
    pathsTruncated: boolean;
  };
};

export function renderScanReport(input: ScanReportInput): string {
  const summary = buildScanSummary(input);
  const completeness = input.completeness ?? buildScanCompleteness(input);
  const nextAction = nextActionFor(input.riskFindings, input.repository, input.graphGate);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);

  if (input.json) {
    const report = {
        $schema: OHRISK_SCAN_REPORT_SCHEMA,
        schemaVersion: OHRISK_REPORT_SCHEMA_VERSION,
        status: "profile_risk_evaluated",
        projectRoot: ".",
        ...(input.repository ? { repository: input.repository } : {}),
        ...(input.project.source ? { archive: archiveReportSource(input.project) } : {}),
        lockfile: {
          kind: input.project.lockfile.kind,
          path: displayLockfilePath(input.project)
        },
        lockfiles: displayLockfiles(input.project),
        profile: input.profile,
        prodOnly: input.prodOnly,
        dependencyGraph: summary.dependencyGraph,
        dependencyGraphDiagnostics: input.graph.diagnostics ?? [],
        dependencyOrigins: dependencyProvenance(input),
        evidence: summary.evidence,
        completeness,
        ...(input.graphGate ? { graphGate: input.graphGate } : {}),
        licenses: summary.licenses,
        risks: summary.risks,
        waiverMode: input.waiverMode,
        waivers: summary.waivers,
        policy: input.policy ?? disabledPolicySummary(),
        nextAction,
        ...thresholdSummary,
        ...waiverDriftSummary,
        findings: input.riskFindings,
        waivedFindings: input.waivedFindings,
        expiredWaivers: input.expiredWaivers,
        unmatchedWaivers: input.unmatchedWaivers
    } satisfies ScanReport;
    return JSON.stringify(report, null, 2);
  }

  if (input.markdown) {
    return renderMarkdownReport(input, summary);
  }

  if (input.html) {
    return renderHtmlReport(input, summary);
  }

  return [
    "Ohrisk scan",
    `Project: ${displayProjectLabel(input.project)}`,
    `Lockfile: ${displayLockfilePath(input.project)} (${input.project.lockfile.kind})`,
    ...renderAdditionalLockfileLines(input.project),
    ...renderRepositoryCoverageLines(input.repository),
    `Profile: ${input.profile}`,
    `Production only: ${input.prodOnly ? "yes" : "no"}`,
    `Dependencies: ${summary.dependencyGraph.total} total, ${summary.dependencyGraph.direct} direct, ${summary.dependencyGraph.transitive} transitive`,
    ...renderDependencyGraphDiagnostics(input.graph.diagnostics ?? []),
    ...(input.graph.unresolvedDependencies ?? []).map((item) =>
      `Unresolved dependency [${item.reason}]: ${JSON.stringify(item.from ?? "<root>")} -> ${JSON.stringify(item.name)} (${item.dependencyType})`),
    `Evidence: ${summary.evidence.files} files, ${summary.evidence.warnings} warnings`,
    `Completeness: ${formatScanCompleteness(completeness)}`,
    ...graphGateLines(input),
    `Input support: ${formatProjectInputSupport(input.project)}`,
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

function graphGateLines(input: ScanReportInput): string[] {
  return input.graphGate ? [
    `Complete graph required: ${input.graphGate.required}`,
    `Graph gate failed: ${input.graphGate.failed}`
  ] : [];
}

function renderMarkdownReport(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): string {
  const nextAction = nextActionFor(input.riskFindings, input.repository, input.graphGate);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);

  return [
    "# Ohrisk scan",
    "",
    `- Project: ${formatMarkdownInlineCode(markdownProjectLabel(input))}`,
    `- Lockfile: ${formatMarkdownInlineCode(displayLockfilePath(input.project))} (${formatMarkdownInlineCode(input.project.lockfile.kind)})`,
    ...renderAdditionalMarkdownLockfileLines(input.project),
    ...renderMarkdownRepositoryCoverageLines(input.repository),
    `- Profile: ${formatMarkdownInlineCode(input.profile)}`,
    `- Production only: ${formatMarkdownInlineCode(input.prodOnly ? "yes" : "no")}`,
    `- Dependencies: ${formatMarkdownInlineCode(`${summary.dependencyGraph.total} total`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.direct} direct`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.transitive} transitive`)}`,
    ...renderMarkdownDependencyGraphDiagnostics(input.graph.diagnostics ?? []),
    ...(input.graph.unresolvedDependencies ?? []).map((item) =>
      `- Unresolved dependency ${formatMarkdownInlineCode(item.reason)}: ${formatMarkdownInlineCode(item.from ?? "<root>")} → ${formatMarkdownInlineCode(item.name)} (${item.dependencyType})`),
    `- Evidence: ${formatMarkdownInlineCode(`${summary.evidence.files} files`)}, ${formatMarkdownInlineCode(`${summary.evidence.warnings} warnings`)}`,
    `- Completeness: ${formatMarkdownInlineCode(formatScanCompleteness(input.completeness ?? buildScanCompleteness(input)))}`,
    ...graphGateLines(input).map((line) => `- ${line}`),
    `- Input support: ${formatMarkdownInlineCode(formatProjectInputSupport(input.project))}`,
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


function renderDependencyGraphDiagnostics(
  diagnostics: NonNullable<DependencyGraph["diagnostics"]>
): string[] {
  return diagnostics.map((diagnostic) =>
    `Graph diagnostic [${diagnostic.code}]: ${diagnostic.message} (${diagnostic.affectedNodeCount} affected)`
  );
}

function renderMarkdownDependencyGraphDiagnostics(
  diagnostics: NonNullable<DependencyGraph["diagnostics"]>
): string[] {
  return diagnostics.map((diagnostic) =>
    `- Graph diagnostic ${formatMarkdownInlineCode(diagnostic.code)}: ${formatMarkdownTableCell(diagnostic.message)} (${formatMarkdownInlineCode(`${diagnostic.affectedNodeCount} affected`)})`
  );
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
      ...(finding.decision ? [`  decisionFingerprint: ${finding.decision.fingerprint}`] : []),
      ...(finding.evidenceFingerprint ? [`  evidenceFingerprint: ${finding.evidenceFingerprint}`] : []),
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

function renderRepositoryCoverageLines(
  repository?: RemoteRepositoryReportSource
): string[] {
  if (!repository || !hasIncompleteRepositoryCoverage(repository)) {
    return [];
  }
  return [`Scan coverage: ${formatSkippedRepositoryEntrySummary(repository)}`];
}

function renderMarkdownRepositoryCoverageLines(
  repository?: RemoteRepositoryReportSource
): string[] {
  if (!repository || !hasIncompleteRepositoryCoverage(repository)) {
    return [];
  }
  return [`- Scan coverage: ${formatMarkdownTableCell(formatSkippedRepositoryEntrySummary(repository))}`];
}
