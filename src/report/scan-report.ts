import { omitUndefined } from "../shared/object";
import path from "node:path";

import type {
  EvidenceDiagnostic,
  EvidenceDiagnosticCode,
  EvidenceSourceCounts,
  LicenseEvidence,
  LicenseEvidenceSource
} from "../evidence/types";
import { packageUrl } from "../graph/package-url";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import { NOTICE_ACTION } from "../policy/evaluate";
import type {
  RiskDependencyScope,
  RiskFinding,
  RiskRecommendation,
  RiskSeverity
} from "../policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../policy/waivers";
import type { PolicyConfigSummary } from "../policy/config";
import type { UsageProfile } from "../policy/profiles";
import { projectLockfiles, type ProjectInput } from "../project/discover";
import {
  formatMarkdownInlineCode,
  formatMarkdownTableCell,
  formatMarkdownTableCode
} from "./markdown";
import {
  htmlReportText,
  type EvidenceRecoveryAdvice,
  type EvidenceRecoveryHint,
  type HtmlReportText
} from "./html-report-text";
import { HTML_REPORT_CONTENT_SECURITY_POLICY } from "./html-security";
import type { ReportLanguage } from "./language";
import { buildThresholdSummary, formatThresholdSummary } from "./threshold-summary";
import {
  OHRISK_REPORT_SCHEMA_VERSION,
  OHRISK_SCAN_REPORT_SCHEMA
} from "./schema";

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
};

export function renderScanReport(input: ScanReportInput): string {
  const summary = buildScanSummary(input);
  const nextAction = nextActionFor(input.riskFindings);
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);

  if (input.json) {
    return JSON.stringify(
      {
        $schema: OHRISK_SCAN_REPORT_SCHEMA,
        schemaVersion: OHRISK_REPORT_SCHEMA_VERSION,
        status: "profile_risk_evaluated",
        projectRoot: ".",
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
      },
      null,
      2
    );
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
    `Profile: ${input.profile}`,
    `Production only: ${input.prodOnly ? "yes" : "no"}`,
    `Dependencies: ${summary.dependencyGraph.total} total, ${summary.dependencyGraph.direct} direct, ${summary.dependencyGraph.transitive} transitive`,
    ...renderDependencyGraphDiagnostics(input.graph.diagnostics ?? []),
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

function renderHtmlReport(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): string {
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);
  const text = htmlReportText(input.reportLanguage);
  const title = text.title;

  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(text.htmlLang)}">`,
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(HTML_REPORT_CONTENT_SECURITY_POLICY)}">`,
    `  <title>${escapeHtml(title)}</title>`,
    "  <style>",
    ...renderHtmlStyles().map((line) => `    ${line}`),
    "  </style>",
    "</head>",
    "<body>",
    '  <main class="page">',
    "    <header>",
    `      <p class="eyebrow">${escapeHtml(input.project.lockfile.kind)}</p>`,
    `      <h1>${escapeHtml(title)}</h1>`,
    `      <p class="lead">${escapeHtml(text.messages.nextAction(input.riskFindings))}</p>`,
    "    </header>",
    '    <section aria-labelledby="review-summary-heading">',
    `      <h2 id="review-summary-heading">${escapeHtml(text.labels.reviewSummary)}</h2>`,
    '      <dl class="summary-grid review-summary-grid">',
    ...renderSummaryCards(buildReviewSummaryCards(input, summary, text, waiverDriftSummary)),
    "      </dl>",
    "    </section>",
    '    <section aria-labelledby="summary-heading">',
    `      <h2 id="summary-heading">${escapeHtml(text.labels.summary)}</h2>`,
    '      <dl class="summary-grid">',
    ...renderSummaryCards([
      [text.labels.project, markdownProjectLabel(input)],
      [text.labels.lockfile, displayLockfileSummary(input.project)],
      [text.labels.profile, input.profile],
      [text.labels.prodOnly, input.prodOnly ? "yes" : "no"],
      [
        text.labels.dependencies,
        text.messages.dependencies(
          summary.dependencyGraph.total,
          summary.dependencyGraph.direct,
          summary.dependencyGraph.transitive
        )
      ],
      [text.labels.evidence, text.messages.evidence(summary.evidence.files, summary.evidence.warnings)],
      [
        text.labels.licenseConfidence,
        text.messages.licenseConfidence(
          summary.licenses.highConfidence,
          summary.licenses.mediumConfidence,
          summary.licenses.lowConfidence
        )
      ],
      [
        text.labels.licenseIssues,
        text.messages.licenseIssues(summary.licenses.missing, summary.licenses.malformed)
      ],
      [text.labels.risks, text.messages.risks(summary.risks)],
      [text.labels.waiverMode, text.messages.waiverMode(input.waiverMode)],
      [
        text.labels.waived,
        text.messages.waived(
          summary.waivers.applied,
          summary.waivers.expired,
          summary.waivers.unmatched
        )
      ],
      ...(text.messages.threshold(thresholdSummary)
        ? [[text.labels.threshold, text.messages.threshold(thresholdSummary) as string] as const]
        : []),
      ...(text.messages.waiverDrift(waiverDriftSummary)
        ? [[text.labels.waiverDrift, text.messages.waiverDrift(waiverDriftSummary) as string] as const]
        : [])
    ]),
    "      </dl>",
    "    </section>",
    ...renderHtmlFindingsSection(input.riskFindings, input.profile, text),
    ...renderHtmlWaivedFindingsSection(input.waivedFindings, text),
    ...renderHtmlExpiredWaiversSection(input.expiredWaivers, text),
    ...renderHtmlUnmatchedWaiversSection(input.unmatchedWaivers, text),
    '    <section aria-labelledby="next-heading">',
    `      <h2 id="next-heading">${escapeHtml(text.labels.next)}</h2>`,
    `      <p>${escapeHtml(text.messages.nextAction(input.riskFindings))}</p>`,
    "    </section>",
    "  </main>",
    "  <script>",
    ...renderHtmlFilterScript(text).map((line) => `    ${line}`),
    "  </script>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderHtmlStyles(): string[] {
  return [
    ":root {",
    "  color-scheme: light;",
    "  --bg: #f6f8fb;",
    "  --surface: #ffffff;",
    "  --text: #16202a;",
    "  --muted: #5a6675;",
    "  --border: #d8dee8;",
    "  --accent: #2563eb;",
    "  --high: #b42318;",
    "  --review: #9a5b00;",
    "  --unknown: #475467;",
    "  --low: #067647;",
    "}",
    "* { box-sizing: border-box; }",
    "body {",
    "  margin: 0;",
    "  background: var(--bg);",
    "  color: var(--text);",
    "  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
    "  line-height: 1.5;",
    "}",
    ".page { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }",
    "header { margin-block-end: 28px; }",
    ".eyebrow { margin: 0 0 8px; color: var(--accent); font-weight: 700; text-transform: uppercase; }",
    "h1 { margin: 0; font-size: 2rem; line-height: 1.2; }",
    "h2 { margin: 0 0 14px; font-size: 1.15rem; }",
    ".lead { max-width: 760px; margin: 12px 0 0; color: var(--muted); }",
    "section { margin-block: 18px; }",
    ".summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin: 0; }",
    ".review-summary-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }",
    ".summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; min-width: 0; }",
    ".summary-card dt { color: var(--muted); font-size: 0.82rem; }",
    ".summary-card dd { margin: 6px 0 0; font-weight: 700; overflow-wrap: anywhere; }",
    ".section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-block-end: 14px; }",
    ".section-head h2 { margin: 0; }",
    ".filter-status { margin: 0; color: var(--muted); font-size: 0.9rem; }",
    ".finding-filter-panel { display: grid; gap: 12px; margin-block-end: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }",
    ".finding-filters { margin: 0; padding: 0; border: 0; min-width: 0; }",
    ".finding-filters legend { padding: 0; color: var(--muted); font-weight: 700; }",
    ".filter-options { display: flex; flex-wrap: wrap; gap: 8px; margin-block-start: 10px; }",
    ".filter-option { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: #f9fafb; color: var(--text); }",
    ".filter-option input { margin: 0; }",
    ".filter-fields { display: grid; grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(160px, 220px)); gap: 10px; align-items: end; }",
    ".filter-field { display: grid; gap: 6px; min-width: 0; color: var(--muted); font-weight: 700; font-size: 0.86rem; }",
    ".filter-field input, .filter-field select { width: 100%; min-width: 0; min-height: 38px; border: 1px solid var(--border); border-radius: 8px; background: #ffffff; color: var(--text); font: inherit; font-weight: 500; padding: 7px 10px; }",
    ".finding-list { display: grid; gap: 12px; }",
    ".finding-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }",
    ".finding-card[hidden] { display: none; }",
    ".finding-card-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px; }",
    ".finding-title { margin: 0; min-width: 0; font-size: 1rem; line-height: 1.35; }",
    ".finding-title code { font-weight: 700; }",
    ".finding-context { margin: 4px 0 0; color: var(--muted); font-size: 0.9rem; }",
    ".finding-details { display: grid; grid-template-columns: minmax(120px, 180px) minmax(0, 1fr); margin: 0; border-top: 1px solid var(--border); }",
    ".finding-details dt, .finding-details dd { min-width: 0; padding: 10px 14px; border-top: 1px solid var(--border); }",
    ".finding-details dt:first-of-type, .finding-details dd:first-of-type { border-top: 0; }",
    ".finding-details dt { color: var(--muted); font-weight: 700; background: #f9fafb; }",
    ".finding-details dd { margin: 0; overflow-wrap: anywhere; }",
    ".wrap-value { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }",
    ".finding-detail-value { display: grid; gap: 8px; }",
    ".collapsible-content { min-width: 0; overflow-wrap: anywhere; line-height: 1.5; }",
    ".collapsible-content.is-collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; max-height: calc(1.5em * 3); overflow: hidden; }",
    ".collapsible-toggle { width: 100%; min-height: 28px; border: 1px solid var(--border); border-radius: 8px; background: #f9fafb; color: var(--muted); cursor: pointer; font: inherit; font-weight: 700; line-height: 1; }",
    ".collapsible-toggle:hover { color: var(--text); border-color: #b8c2d2; }",
    ".collapsible-toggle:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }",
    ".collapsible-toggle[hidden] { display: none; }",
    ".table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }",
    "table { width: 100%; border-collapse: collapse; min-width: 860px; }",
    "caption { text-align: left; padding: 12px 14px; color: var(--muted); font-weight: 700; }",
    "th, td { padding: 10px 12px; border-top: 1px solid var(--border); text-align: left; vertical-align: top; }",
    "th { color: var(--muted); font-size: 0.82rem; }",
    "code { font-family: ui-monospace, SFMono-Regular, Consolas, \"Liberation Mono\", monospace; font-size: 0.92em; overflow-wrap: anywhere; }",
    ".empty { margin: 0; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--muted); }",
    ".severity { display: inline-block; font-weight: 700; }",
    ".severity-high { color: var(--high); }",
    ".severity-review { color: var(--review); }",
    ".severity-unknown { color: var(--unknown); }",
    ".severity-low { color: var(--low); }",
    "@media (max-width: 640px) {",
    "  .page { width: min(100% - 20px, 1180px); padding-block-start: 20px; }",
    "  h1 { font-size: 1.6rem; }",
    "  .filter-fields { grid-template-columns: 1fr; }",
    "  .finding-details { grid-template-columns: 1fr; }",
    "  .finding-details dt { padding-block-end: 4px; }",
    "  .finding-details dd { padding-block-start: 0; }",
    "}"
  ];
}

function renderSummaryCards(items: ReadonlyArray<readonly [string, string]>): string[] {
  return items.flatMap(([label, value]) => [
    '        <div class="summary-card">',
    `          <dt>${escapeHtml(label)}</dt>`,
    `          <dd>${escapeHtml(value)}</dd>`,
    "        </div>"
  ]);
}

function buildReviewSummaryCards(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>,
  text: HtmlReportText,
  waiverDriftSummary: ReturnType<typeof buildWaiverDriftSummary>
): ReadonlyArray<readonly [string, string]> {
  const evidenceRecoveryAdvice = buildEvidenceRecoveryAdvice(input, summary);

  return [
    [text.labels.status, text.messages.reviewStatus(summary.risks)],
    [text.labels.activeFindings, text.messages.activeFindings(summary.risks)],
    [text.labels.scope, text.messages.scope(input.profile, input.prodOnly)],
    [
      text.labels.waivers,
      text.messages.reviewWaivers(
        summary.waivers.applied,
        summary.waivers.expired + summary.waivers.unmatched
      )
    ],
    [text.labels.reviewFocus, text.messages.nextAction(input.riskFindings)],
    ...(evidenceRecoveryAdvice
      ? [[text.labels.evidenceRecovery, text.messages.evidenceRecovery(evidenceRecoveryAdvice)] as const]
      : []),
    [text.labels.waiverDrift, text.messages.reviewWaiverDrift(waiverDriftSummary)]
  ];
}

function buildEvidenceRecoveryAdvice(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): EvidenceRecoveryAdvice | undefined {
  const activeFindings = summary.risks.high + summary.risks.review + summary.risks.unknown + summary.risks.low;
  if (activeFindings === 0 || summary.risks.unknown / activeFindings < 0.5) {
    return undefined;
  }

  const unknownFindings = input.riskFindings.filter((finding) => finding.severity === "unknown");
  if (unknownFindings.length === 0) {
    return undefined;
  }

  const localEvidenceMissingFindings = unknownFindings.filter(hasLocalPackageEvidenceMissingSignal);
  if (
    localEvidenceMissingFindings.length === 0
    || localEvidenceMissingFindings.length / unknownFindings.length < 0.5
  ) {
    return undefined;
  }

  return omitUndefined({
    unknownFindings: unknownFindings.length,
    localEvidenceMissingFindings: localEvidenceMissingFindings.length,
    primaryHint: evidenceRecoveryHintFor(input, localEvidenceMissingFindings)
  });
}

function hasLocalPackageEvidenceMissingSignal(finding: RiskFinding): boolean {
  const evidenceText = finding.evidence.join("\n");
  return [
    /\bsource:\s*unavailable\b/i,
    /\bwas not found in (?:a )?local\b/i,
    /\bwas not found in [^\n.]*\blocal\b[^\n.]*\bcache\b/i,
    /\b(?:package|module|gem|provider|distribution) source was not found\b/i,
    /\bmetadata was not found in [^\n.]*\blocal\b/i,
    /\blocal\b[^\n.]*\b(?:cache|registry|install path|package source)\b[^\n.]*\bwas not found\b/i
  ].some((pattern) => pattern.test(evidenceText));
}

function evidenceRecoveryHintFor(
  input: ScanReportInput,
  findings: RiskFinding[]
): EvidenceRecoveryHint | undefined {
  const evidenceText = findings.map((finding) => finding.evidence.join("\n")).join("\n");
  if (
    input.project.lockfile.kind === "go-mod"
    || input.project.lockfile.kind === "go-work"
    || /\bGo module source was not found\b/i.test(evidenceText)
  ) {
    return {
      ecosystem: "go",
      command: "`go mod download all`",
      directoryLabel: displayLockfileDirectoryPath(input.project),
      directoryIsScanRoot: displayLockfileDirectoryPath(input.project) === ".",
      sourceFileLabel: input.project.lockfile.kind === "go-work" ? "go.work" : "go.mod"
    };
  }

  return undefined;
}

function renderHtmlFindingsSection(
  findings: RiskFinding[],
  profile: string,
  text: HtmlReportText
): string[] {
  if (findings.length === 0) {
    return [
      '    <section aria-labelledby="findings-heading">',
      `      <h2 id="findings-heading">${escapeHtml(text.labels.findings)}</h2>`,
      `      <p class="empty">${escapeHtml(text.messages.noActiveFindings)}</p>`,
      "    </section>"
    ];
  }

  const counts = summarizeRiskFindings(findings);
  const filterCounts = summarizeFindingFilters(findings);

  return [
    '    <section aria-labelledby="findings-heading">',
    '      <div class="section-head">',
    `        <h2 id="findings-heading">${escapeHtml(text.labels.findings)}</h2>`,
    '        <p class="filter-status" data-finding-filter-status></p>',
    "      </div>",
    '      <div class="finding-filter-panel">',
    '      <fieldset class="finding-filters">',
    `        <legend>${escapeHtml(text.labels.severity)}</legend>`,
    '        <div class="filter-options">',
    ...renderSeverityFilterControls(counts, text),
    "      </div>",
    "      </fieldset>",
    '        <div class="filter-fields">',
    `          <label class="filter-field" for="finding-search">${escapeHtml(text.labels.search)}<input id="finding-search" type="search" data-finding-search placeholder="${escapeHtml(text.messages.searchPlaceholder)}"></label>`,
    `          <label class="filter-field" for="finding-dependency-filter">${escapeHtml(text.labels.dependency)}<select id="finding-dependency-filter" data-finding-dependency-filter>`,
    `            <option value="all">${escapeHtml(text.messages.allDependencies)}</option>`,
    ...renderDependencyFilterOptions(filterCounts.dependencyScopes, text),
    "          </select></label>",
    `          <label class="filter-field" for="finding-action-filter">${escapeHtml(text.labels.action)}<select id="finding-action-filter" data-finding-action-filter>`,
    `            <option value="all">${escapeHtml(text.messages.allActions)}</option>`,
    ...renderRecommendationFilterOptions(filterCounts.recommendations, text),
    "          </select></label>",
    "        </div>",
    "      </div>",
    `      <p class="empty" data-finding-filter-empty hidden>${escapeHtml(text.messages.noMatchingFindings)}</p>`,
    '      <div class="finding-list">',
    ...findings.flatMap((finding, index) => renderHtmlFindingCard(finding, index, profile, text)),
    "      </div>",
    "    </section>"
  ];
}

function renderSeverityFilterControls(
  counts: Record<RiskSeverity, number>,
  text: HtmlReportText
): string[] {
  const severities: RiskSeverity[] = ["high", "review", "unknown", "low"];

  return severities.map((severity) => {
    const checked = severity === "low" ? "" : " checked";
    const label = `${text.messages.severity(severity)} (${counts[severity]})`;
    return `          <label class="filter-option"><input type="checkbox" value="${severity}" data-finding-filter${checked}> ${escapeHtml(label)}</label>`;
  });
}

function renderDependencyFilterOptions(
  counts: Record<RiskDependencyScope, number>,
  text: HtmlReportText
): string[] {
  const scopes: RiskDependencyScope[] = ["direct", "transitive"];
  return scopes
    .filter((scope) => counts[scope] > 0)
    .map(
      (scope) =>
        `            <option value="${scope}">${escapeHtml(`${text.messages.dependencyScope(scope)} (${counts[scope]})`)}</option>`
    );
}

function renderRecommendationFilterOptions(
  counts: Record<RiskRecommendation, number>,
  text: HtmlReportText
): string[] {
  const recommendations: RiskRecommendation[] = [
    "replace",
    "review",
    "collect-evidence",
    "exclude-dev-only",
    "allow"
  ];
  return recommendations
    .filter((recommendation) => counts[recommendation] > 0)
    .map(
      (recommendation) =>
        `            <option value="${recommendation}">${escapeHtml(`${text.messages.recommendation(recommendation)} (${counts[recommendation]})`)}</option>`
    );
}

function renderHtmlFindingCard(
  finding: RiskFinding,
  index: number,
  profile: string,
  text: HtmlReportText
): string[] {
  const titleId = `finding-${index + 1}-title`;
  const searchText = normalizeFindingSearchText(finding, profile, text);

  return [
    `        <article class="finding-card" data-finding-card data-severity="${escapeHtml(finding.severity)}" data-dependency-scope="${escapeHtml(finding.dependencyScope)}" data-recommendation="${escapeHtml(finding.recommendation)}" data-search-text="${escapeHtml(searchText)}" aria-labelledby="${titleId}">`,
    '          <div class="finding-card-header">',
    "            <div>",
    `              <h3 class="finding-title" id="${titleId}"><code>${escapeHtml(finding.packageId)}</code></h3>`,
    `              <p class="finding-context">${escapeHtml(text.messages.dependencyContext(finding))}</p>`,
    "            </div>",
    `            ${renderSeverity(finding.severity, text)}`,
    "          </div>",
    '          <dl class="finding-details">',
    ...renderFindingDetail(text.labels.severity, renderSeverity(finding.severity, text), text),
    ...renderFindingDetail(text.labels.package, `<code class="wrap-value">${escapeHtml(finding.packageId)}</code>`, text),
    ...renderFindingDetail(text.labels.dependency, escapeHtml(text.messages.dependencyContext(finding)), text),
    ...renderFindingDetail(text.labels.reason, escapeHtml(text.messages.findingReason(finding, profile)), text, true),
    ...renderFindingDetail(text.labels.action, escapeHtml(text.messages.findingAction(finding)), text, true),
    ...renderFindingDetail(text.labels.findingPath, `<code class="wrap-value">${escapeHtml(formatPath(finding.paths[0]))}</code>`, text, true),
    ...renderFindingDetail(text.labels.evidenceDetail, escapeHtml(finding.evidence.join("; ")), text, true),
    ...renderFindingDetail(text.labels.fingerprint, `<code class="wrap-value">${escapeHtml(finding.fingerprint)}</code>`, text, true),
    "          </dl>",
    "        </article>"
  ];
}

function renderFindingDetail(
  label: string,
  valueHtml: string,
  text: HtmlReportText,
  collapsible = false
): string[] {
  if (collapsible) {
    const expandLabel = text.messages.expandLabel(label);
    const collapseLabel = text.messages.collapseLabel(label);
    return [
      `            <dt>${escapeHtml(label)}</dt>`,
      '            <dd class="finding-detail-value" data-collapsible>',
      `              <div class="collapsible-content is-collapsed" data-collapsible-content>${valueHtml}</div>`,
      `              <button type="button" class="collapsible-toggle" data-collapsible-toggle data-expand-label="${escapeHtml(expandLabel)}" data-collapse-label="${escapeHtml(collapseLabel)}" aria-label="${escapeHtml(expandLabel)}" aria-expanded="false">...</button>`,
      "            </dd>"
    ];
  }

  return [
    `            <dt>${escapeHtml(label)}</dt>`,
    `            <dd>${valueHtml}</dd>`
  ];
}

function renderHtmlFilterScript(text: HtmlReportText): string[] {
  const filterMessages = JSON.stringify({
    status: text.messages.filterStatusTemplate,
    expandFallback: text.messages.defaultExpandLabel,
    collapseFallback: text.messages.defaultCollapseLabel,
    collapseText: text.messages.collapseText
  });

  return [
    "(() => {",
    `  const messages = ${filterMessages};`,
    "  const severityFilters = Array.from(document.querySelectorAll('[data-finding-filter]'));",
    "  const cards = Array.from(document.querySelectorAll('[data-finding-card]'));",
    "  const searchInput = document.querySelector('[data-finding-search]');",
    "  const dependencyFilter = document.querySelector('[data-finding-dependency-filter]');",
    "  const actionFilter = document.querySelector('[data-finding-action-filter]');",
    "  const status = document.querySelector('[data-finding-filter-status]');",
    "  const empty = document.querySelector('[data-finding-filter-empty]');",
    "",
    "  const updateFindings = () => {",
    "    const selectedSeverities = new Set(severityFilters.filter((filter) => filter.checked).map((filter) => filter.value));",
    "    const searchText = (searchInput?.value || '').trim().toLowerCase();",
    "    const dependencyScope = dependencyFilter?.value || 'all';",
    "    const recommendation = actionFilter?.value || 'all';",
    "    let visibleCount = 0;",
    "",
    "    for (const card of cards) {",
    "      const severityMatches = selectedSeverities.has(card.dataset.severity || '');",
    "      const dependencyMatches = dependencyScope === 'all' || card.dataset.dependencyScope === dependencyScope;",
    "      const recommendationMatches = recommendation === 'all' || card.dataset.recommendation === recommendation;",
    "      const searchMatches = searchText === '' || (card.dataset.searchText || '').includes(searchText);",
    "      const visible = severityMatches && dependencyMatches && recommendationMatches && searchMatches;",
    "      card.hidden = !visible;",
    "      if (visible) {",
    "        visibleCount += 1;",
    "      }",
    "    }",
    "",
    "    if (status) {",
    "      status.textContent = messages.status.replace('{visible}', String(visibleCount)).replace('{total}', String(cards.length));",
    "    }",
    "",
    "    if (empty) {",
    "      empty.hidden = visibleCount !== 0;",
    "    }",
    "",
    "    refreshVisibleCollapsibles();",
    "  };",
    "",
    "  for (const filter of severityFilters) {",
    "    filter.addEventListener('change', updateFindings);",
    "  }",
    "  searchInput?.addEventListener('input', updateFindings);",
    "  dependencyFilter?.addEventListener('change', updateFindings);",
    "  actionFilter?.addEventListener('change', updateFindings);",
    "",
    "  const getCollapsedHeight = (content) => {",
    "    const styles = window.getComputedStyle(content);",
    "    const lineHeight = Number.parseFloat(styles.lineHeight);",
    "    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 3 : 0;",
    "  };",
    "",
    "  const isCollapsibleOverflowing = (content) => {",
    "    const width = content.getBoundingClientRect().width;",
    "    const collapsedHeight = getCollapsedHeight(content);",
    "    if (width <= 0 || collapsedHeight <= 0 || !content.parentElement) {",
    "      return null;",
    "    }",
    "    if (content.scrollHeight > content.clientHeight + 1) {",
    "      return true;",
    "    }",
    "",
    "    const clone = content.cloneNode(true);",
    "    clone.classList.remove('is-collapsed');",
    "    clone.removeAttribute('data-collapsible-content');",
    "    clone.setAttribute('aria-hidden', 'true');",
    "    clone.style.position = 'absolute';",
    "    clone.style.visibility = 'hidden';",
    "    clone.style.pointerEvents = 'none';",
    "    clone.style.width = `${width}px`;",
    "    clone.style.maxHeight = 'none';",
    "    clone.style.display = 'block';",
    "    clone.style.overflow = 'visible';",
    "    clone.style.webkitLineClamp = 'unset';",
    "    clone.style.webkitBoxOrient = 'unset';",
    "    content.parentElement.appendChild(clone);",
    "    const expandedHeight = clone.scrollHeight;",
    "    clone.remove();",
    "    return expandedHeight > collapsedHeight + 1;",
    "  };",
    "",
    "  const refreshCollapsible = (container) => {",
    "    const content = container.querySelector('[data-collapsible-content]');",
    "    const toggle = container.querySelector('[data-collapsible-toggle]');",
    "    if (!content || !toggle) {",
    "      return;",
    "    }",
    "    const overflowed = isCollapsibleOverflowing(content);",
    "    if (overflowed === null) {",
    "      return;",
    "    }",
    "    toggle.hidden = !overflowed;",
    "    if (!overflowed) {",
    "      toggle.setAttribute('aria-expanded', 'false');",
    "      toggle.setAttribute('aria-label', toggle.dataset.expandLabel || messages.expandFallback);",
    "      toggle.textContent = '...';",
    "      content.classList.add('is-collapsed');",
    "    }",
    "  };",
    "",
    "  let visibleCollapsibleRefreshScheduled = false;",
    "  const refreshVisibleCollapsibles = () => {",
    "    if (visibleCollapsibleRefreshScheduled) {",
    "      return;",
    "    }",
    "    visibleCollapsibleRefreshScheduled = true;",
    "    requestAnimationFrame(() => {",
    "      visibleCollapsibleRefreshScheduled = false;",
    "      for (const container of collapsibles) {",
    "        const card = container.closest('[data-finding-card]');",
    "        if (card && !card.hidden) {",
    "          refreshCollapsible(container);",
    "        }",
    "      }",
    "    });",
    "  };",
    "",
    "  const collapsibles = Array.from(document.querySelectorAll('[data-collapsible]'));",
    "  for (const container of collapsibles) {",
    "    const content = container.querySelector('[data-collapsible-content]');",
    "    const toggle = container.querySelector('[data-collapsible-toggle]');",
    "    if (!content || !toggle) {",
    "      continue;",
    "    }",
    "    toggle.addEventListener('click', () => {",
    "      const expanded = toggle.getAttribute('aria-expanded') === 'true';",
    "      const nextExpanded = !expanded;",
    "      toggle.setAttribute('aria-expanded', String(nextExpanded));",
    "      toggle.setAttribute('aria-label', nextExpanded ? toggle.dataset.collapseLabel || messages.collapseFallback : toggle.dataset.expandLabel || messages.expandFallback);",
    "      toggle.textContent = nextExpanded ? messages.collapseText : '...';",
    "      content.classList.toggle('is-collapsed', !nextExpanded);",
    "    });",
    "  }",
    "",
    "  refreshVisibleCollapsibles();",
    "  window.addEventListener('resize', () => {",
    "    refreshVisibleCollapsibles();",
    "  });",
    "",
    "  updateFindings();",
    "})();"
  ];
}

function renderHtmlWaivedFindingsSection(
  waivedFindings: WaivedRiskFinding[],
  text: HtmlReportText
): string[] {
  if (waivedFindings.length === 0) {
    return [
      '    <section aria-labelledby="waived-heading">',
      `      <h2 id="waived-heading">${escapeHtml(text.labels.waivedFindings)}</h2>`,
      `      <p class="empty">${escapeHtml(text.messages.noWaivedFindings)}</p>`,
      "    </section>"
    ];
  }

  return [
    '    <section aria-labelledby="waived-heading">',
    `      <h2 id="waived-heading">${escapeHtml(text.labels.waivedFindings)}</h2>`,
    '      <div class="table-wrap">',
    '        <table>',
    `          <caption>${escapeHtml(text.captions.waivedFindings)}</caption>`,
    "          <thead>",
    `            <tr><th scope="col">${escapeHtml(text.labels.severity)}</th><th scope="col">${escapeHtml(text.labels.package)}</th><th scope="col">${escapeHtml(text.labels.matchedBy)}</th><th scope="col">${escapeHtml(text.labels.reason)}</th><th scope="col">${escapeHtml(text.labels.action)}</th><th scope="col">${escapeHtml(text.labels.fingerprint)}</th></tr>`,
    "          </thead>",
    "          <tbody>",
    ...waivedFindings.map((waived) => [
      "            <tr>",
      `              <td>${renderSeverity(waived.finding.severity, text)}</td>`,
      `              <td><code>${escapeHtml(waived.finding.packageId)}</code></td>`,
      `              <td>${escapeHtml(waived.matchedBy)}</td>`,
      `              <td>${escapeHtml(waived.waiver.reason)}</td>`,
      `              <td>${escapeHtml(text.messages.findingAction(waived.finding))}</td>`,
      `              <td><code>${escapeHtml(waived.finding.fingerprint)}</code></td>`,
      "            </tr>"
    ].join("\n")),
    "          </tbody>",
    "        </table>",
    "      </div>",
    "    </section>"
  ];
}

function renderHtmlExpiredWaiversSection(
  expiredWaivers: RiskWaiver[],
  text: HtmlReportText
): string[] {
  if (expiredWaivers.length === 0) {
    return [
      '    <section aria-labelledby="expired-waivers-heading">',
      `      <h2 id="expired-waivers-heading">${escapeHtml(text.labels.expiredWaivers)}</h2>`,
      `      <p class="empty">${escapeHtml(text.messages.noExpiredWaivers)}</p>`,
      "    </section>"
    ];
  }

  return [
    '    <section aria-labelledby="expired-waivers-heading">',
    `      <h2 id="expired-waivers-heading">${escapeHtml(text.labels.expiredWaivers)}</h2>`,
    '      <div class="table-wrap">',
    '        <table>',
    `          <caption>${escapeHtml(text.captions.expiredWaivers)}</caption>`,
    "          <thead>",
    `            <tr><th scope="col">${escapeHtml(text.labels.target)}</th><th scope="col">${escapeHtml(text.labels.expiresOn)}</th><th scope="col">${escapeHtml(text.labels.reason)}</th></tr>`,
    "          </thead>",
    "          <tbody>",
    ...expiredWaivers.map((waiver) => [
      "            <tr>",
      `              <td><code>${escapeHtml(text.messages.waiverTarget(waiver))}</code></td>`,
      `              <td>${escapeHtml(waiver.expiresOn ?? "unknown")}</td>`,
      `              <td>${escapeHtml(waiver.reason)}</td>`,
      "            </tr>"
    ].join("\n")),
    "          </tbody>",
    "        </table>",
    "      </div>",
    "    </section>"
  ];
}

function renderHtmlUnmatchedWaiversSection(
  unmatchedWaivers: RiskWaiver[],
  text: HtmlReportText
): string[] {
  if (unmatchedWaivers.length === 0) {
    return [
      '    <section aria-labelledby="unmatched-waivers-heading">',
      `      <h2 id="unmatched-waivers-heading">${escapeHtml(text.labels.unmatchedWaivers)}</h2>`,
      `      <p class="empty">${escapeHtml(text.messages.noUnmatchedWaivers)}</p>`,
      "    </section>"
    ];
  }

  return [
    '    <section aria-labelledby="unmatched-waivers-heading">',
    `      <h2 id="unmatched-waivers-heading">${escapeHtml(text.labels.unmatchedWaivers)}</h2>`,
    '      <div class="table-wrap">',
    '        <table>',
    `          <caption>${escapeHtml(text.captions.unmatchedWaivers)}</caption>`,
    "          <thead>",
    `            <tr><th scope="col">${escapeHtml(text.labels.target)}</th><th scope="col">${escapeHtml(text.labels.reason)}</th></tr>`,
    "          </thead>",
    "          <tbody>",
    ...unmatchedWaivers.map((waiver) => [
      "            <tr>",
      `              <td><code>${escapeHtml(text.messages.waiverTarget(waiver))}</code></td>`,
      `              <td>${escapeHtml(waiver.reason)}</td>`,
      "            </tr>"
    ].join("\n")),
    "          </tbody>",
    "        </table>",
    "      </div>",
    "    </section>"
  ];
}

function renderSeverity(severity: RiskSeverity, text?: HtmlReportText): string {
  return `<span class="severity severity-${severity}">${escapeHtml(text?.messages.severity(severity) ?? severity)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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
    `- Project: ${formatMarkdownInlineCode(markdownProjectLabel(input))}`,
    `- Lockfile: ${formatMarkdownInlineCode(displayLockfilePath(input.project))} (${formatMarkdownInlineCode(input.project.lockfile.kind)})`,
    ...renderAdditionalMarkdownLockfileLines(input.project),
    `- Profile: ${formatMarkdownInlineCode(input.profile)}`,
    `- Production only: ${formatMarkdownInlineCode(input.prodOnly ? "yes" : "no")}`,
    `- Dependencies: ${formatMarkdownInlineCode(`${summary.dependencyGraph.total} total`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.direct} direct`)}, ${formatMarkdownInlineCode(`${summary.dependencyGraph.transitive} transitive`)}`,
    ...renderMarkdownDependencyGraphDiagnostics(input.graph.diagnostics ?? []),
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


function dependencyProvenance(input: ScanReportInput): Array<{
  packageId: string;
  purl: string;
  origins: Array<{ kind: string; path: string }>;
}> {
  return input.graph.nodes
    .map((node) => ({
      packageId: node.id,
      purl: packageUrl(node),
      origins: displayDependencyOrigins(input.project, node)
    }))
    .sort((left, right) => left.purl.localeCompare(right.purl));
}

function displayDependencyOrigins(
  project: ScanReportInput["project"],
  node: DependencyNode
): Array<{ kind: string; path: string }> {
  const origins = node.origins && node.origins.length > 0
    ? node.origins.map((origin) => ({
        kind: origin.lockfileKind,
        path: displayProjectPath(project, origin.lockfilePath)
      }))
    : [{
        kind: project.lockfile.kind,
        path: displayLockfilePath(project)
      }];

  const uniqueOrigins = new Map<string, { kind: string; path: string }>();
  for (const origin of origins) {
    uniqueOrigins.set(`${origin.kind}\0${origin.path}`, origin);
  }
  return [...uniqueOrigins.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
  );
}

function displayLockfileSummary(project: ScanReportInput["project"]): string {
  return displayLockfiles(project)
    .map((lockfile) => `${lockfile.path} (${lockfile.kind})`)
    .join(", ");
}

function renderAdditionalLockfileLines(project: ScanReportInput["project"]): string[] {
  const lockfiles = displayLockfiles(project);
  return lockfiles.length > 1
    ? [`Lockfiles: ${lockfiles.map((lockfile) => `${lockfile.path} (${lockfile.kind})`).join(", ")}`]
    : [];
}

function renderAdditionalMarkdownLockfileLines(
  project: ScanReportInput["project"]
): string[] {
  const lockfiles = displayLockfiles(project);
  return lockfiles.length > 1
    ? [`- Lockfiles: ${lockfiles.map((lockfile) => `${formatMarkdownInlineCode(lockfile.path)} (${formatMarkdownInlineCode(lockfile.kind)})`).join(", ")}`]
    : [];
}

function displayLockfiles(project: ScanReportInput["project"]): Array<{ kind: string; path: string }> {
  return projectLockfiles(project).map((lockfile) => ({
    kind: lockfile.kind,
    path: displayProjectPath(project, lockfile.path)
  }));
}

function disabledPolicySummary(): PolicyConfigSummary {
  return {
    enabled: false,
    sourceFiles: [],
    allowLicenseCount: 0,
    denyLicenseCount: 0,
    severityOverrideCount: 0,
    packageRuleCount: 0,
    profileCount: 0,
    profileOverrideCount: 0,
    allowedRegistryHostCount: 0,
    registryAuthHostCount: 0
  };
}

function displayProjectPath(project: ScanReportInput["project"], targetPath: string): string {
  const relativePath = path.relative(project.rootDir, targetPath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return project.source
      ? `${project.source.displayPath}!/${archiveEntryPath(project, normalizedPath)}`
      : normalizedPath;
  }
  return path.basename(targetPath);
}

function displayLockfilePath(project: ScanReportInput["project"]): string {
  return displayProjectPath(project, project.lockfile.path);
}

function displayLockfileDirectoryPath(project: ScanReportInput["project"]): string {
  const directoryPath = path.dirname(displayLockfilePath(project));
  return directoryPath === "" ? "." : directoryPath;
}

function markdownProjectLabel(input: ScanReportInput): string {
  return input.project.source
    ? displayProjectLabel(input.project)
    : input.graph.rootName ?? ".";
}

function displayProjectLabel(project: ScanReportInput["project"]): string {
  if (!project.source) {
    return project.rootDir;
  }

  return project.source.entryRoot === "." || project.source.entryRoot === ""
    ? project.source.displayPath
    : `${project.source.displayPath}!/${project.source.entryRoot}`;
}

function archiveEntryPath(
  project: ScanReportInput["project"],
  relativePath: string
): string {
  const root = project.source?.entryRoot;
  if (!root || root === ".") {
    return relativePath;
  }
  return `${root}/${relativePath}`;
}

function archiveReportSource(project: ScanReportInput["project"]): {
  name: string;
  format: "zip" | "tar" | "tar.gz";
  sha256: string;
  root: string;
} {
  const source = project.source;
  if (!source) {
    throw new Error("Archive report source is unavailable.");
  }

  return {
    name: source.displayPath,
    format: source.format,
    sha256: source.sha256,
    root: source.entryRoot
  };
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
    sources: Record<LicenseEvidenceSource, EvidenceSourceCounts>;
    diagnostics: EvidenceDiagnostic[];
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
  const evidenceDetails = summarizeEvidence(input.evidence);
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
      warnings: evidenceWarningCount,
      sources: evidenceDetails.sources,
      diagnostics: evidenceDetails.diagnostics
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

function summarizeEvidence(evidence: LicenseEvidence[]): {
  sources: Record<LicenseEvidenceSource, EvidenceSourceCounts>;
  diagnostics: EvidenceDiagnostic[];
} {
  const sources: Record<LicenseEvidenceSource, EvidenceSourceCounts> = {
    local: { packages: 0, files: 0, warnings: 0 },
    sbom: { packages: 0, files: 0, warnings: 0 },
    tarball: { packages: 0, files: 0, warnings: 0 },
    unavailable: { packages: 0, files: 0, warnings: 0 }
  };
  const diagnosticCounts = new Map<string, {
    code: EvidenceDiagnosticCode;
    source: LicenseEvidenceSource;
    packageIds: Set<string>;
    occurrenceCount: number;
  }>();

  for (const item of evidence) {
    const source = sources[item.source];
    source.packages += 1;
    source.files += item.files.length;
    source.warnings += item.warnings.length;

    if (item.warnings.length > 0) {
      addEvidenceDiagnostic(diagnosticCounts, {
        code: "collector_warning",
        source: item.source,
        packageId: item.packageId,
        occurrenceCount: item.warnings.length
      });
    }
    if (item.source === "unavailable") {
      addEvidenceDiagnostic(diagnosticCounts, {
        code: "source_unavailable",
        source: item.source,
        packageId: item.packageId,
        occurrenceCount: 1
      });
    }
    if (item.files.length === 0 && !hasDeclaredLicenseEvidence(item)) {
      addEvidenceDiagnostic(diagnosticCounts, {
        code: "license_evidence_missing",
        source: item.source,
        packageId: item.packageId,
        occurrenceCount: 1
      });
    }
  }

  return {
    sources,
    diagnostics: [...diagnosticCounts.values()]
      .map((item) => ({
        code: item.code,
        source: item.source,
        packageCount: item.packageIds.size,
        occurrenceCount: item.occurrenceCount
      }))
      .sort((left, right) =>
        left.code.localeCompare(right.code) || left.source.localeCompare(right.source)
      )
  };
}

function addEvidenceDiagnostic(
  diagnostics: Map<string, {
    code: EvidenceDiagnosticCode;
    source: LicenseEvidenceSource;
    packageIds: Set<string>;
    occurrenceCount: number;
  }>,
  input: {
    code: EvidenceDiagnosticCode;
    source: LicenseEvidenceSource;
    packageId: string;
    occurrenceCount: number;
  }
): void {
  const key = `${input.code}\u0000${input.source}`;
  const current = diagnostics.get(key) ?? {
    code: input.code,
    source: input.source,
    packageIds: new Set<string>(),
    occurrenceCount: 0
  };
  current.packageIds.add(input.packageId);
  current.occurrenceCount += input.occurrenceCount;
  diagnostics.set(key, current);
}

function hasDeclaredLicenseEvidence(evidence: LicenseEvidence): boolean {
  return typeof evidence.packageJsonLicense === "string"
    || evidence.packageJsonLicenses !== undefined
    || typeof evidence.metadataLicense === "string"
    || evidence.metadataLicenses !== undefined;
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

function summarizeFindingFilters(riskFindings: RiskFinding[]): {
  dependencyScopes: Record<RiskDependencyScope, number>;
  recommendations: Record<RiskRecommendation, number>;
} {
  return riskFindings.reduce(
    (summary, finding) => {
      summary.dependencyScopes[finding.dependencyScope] += 1;
      summary.recommendations[finding.recommendation] += 1;
      return summary;
    },
    {
      dependencyScopes: {
        direct: 0,
        transitive: 0
      },
      recommendations: {
        allow: 0,
        review: 0,
        replace: 0,
        "exclude-dev-only": 0,
        "collect-evidence": 0
      }
    }
  );
}

function normalizeFindingSearchText(
  finding: RiskFinding,
  profile: string,
  text: HtmlReportText
): string {
  return [
    finding.id,
    finding.fingerprint,
    finding.packageId,
    finding.severity,
    text.messages.severity(finding.severity),
    finding.reason,
    text.messages.findingReason(finding, profile),
    finding.action,
    text.messages.findingAction(finding),
    finding.dependencyType,
    text.messages.dependencyType(finding.dependencyType),
    finding.dependencyScope,
    text.messages.dependencyScope(finding.dependencyScope),
    finding.recommendation,
    text.messages.recommendation(finding.recommendation),
    finding.evidence.join(" "),
    formatPath(finding.paths[0])
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
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
