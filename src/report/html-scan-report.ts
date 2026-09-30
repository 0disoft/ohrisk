import { buildScanCompleteness, formatScanCompleteness } from "../policy/completeness";
import { omitUndefined } from "../shared/object";
import { buildFindingFingerprint, buildLegacyFindingId } from "../policy/finding-id";
import type { RiskDependencyScope, RiskFinding, RiskRecommendation, RiskSeverity } from "../policy/types";
import type { RiskWaiver, WaivedRiskFinding } from "../policy/waivers";
import { htmlReportText, type EvidenceRecoveryAdvice, type EvidenceRecoveryHint, type HtmlReportText } from "./html-report-text";
import { renderHtmlStyles } from "./html-report-ui";
import { HTML_REPORT_CONTENT_SECURITY_POLICY } from "./html-security";
import { buildThresholdSummary } from "./threshold-summary";
import type { ScanReportInput, RemoteRepositoryReportSource } from "./scan-report";
import { displayLockfileSummary, displayLockfileDirectoryPath, markdownProjectLabel, buildWaiverDriftSummary, buildScanSummary, summarizeRiskFindings, summarizeFindingFilters, formatPath, hasIncompleteRepositoryCoverage } from "./scan-model";
import { renderHtmlFilterScript } from "./html-scan-filter";

const HTML_DEFERRED_FINGERPRINT_MIN_CHARS = 512;
const HTML_FINGERPRINT_PREVIEW_CHARS = 240;

export function renderHtmlReport(
  input: ScanReportInput,
  summary: ReturnType<typeof buildScanSummary>
): string {
  const thresholdSummary = buildThresholdSummary(input.riskFindings, input.failOn);
  const waiverDriftSummary = buildWaiverDriftSummary(input);
  const text = htmlReportText(input.reportLanguage);
  const title = text.title;
  const deferredFingerprintData = buildHtmlDeferredFingerprintData(input.riskFindings);
  const decisionSeverity = highestRiskSeverity(summary.risks);
  const reviewSummaryCards = buildReviewSummaryCards(input, summary, text, waiverDriftSummary);

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
    '  <div class="report-shell">',
    `    <aside class="report-sidebar" aria-label="${escapeHtml(title)}">`,
    '      <p class="report-brand">Ohrisk</p>',
    '      <nav class="report-nav">',
    `        <a href="#review-summary-heading">${escapeHtml(text.labels.reviewSummary)}</a>`,
    `        <a href="#summary-heading">${escapeHtml(text.labels.summary)}</a>`,
    `        <a href="#findings-heading">${escapeHtml(text.labels.findings)}</a>`,
    `        <a href="#waived-findings-heading">${escapeHtml(text.labels.waivedFindings)}</a>`,
    "      </nav>",
    '      <p class="sidebar-meta">',
    `        <strong>${escapeHtml(markdownProjectLabel(input))}</strong>`,
    `        ${escapeHtml(input.project.lockfile.kind)} · ${escapeHtml(input.profile)}`,
    "      </p>",
    "    </aside>",
    '    <main class="page">',
    '      <header class="report-header">',
    '        <div class="report-topline">',
    `          <p class="eyebrow">${escapeHtml(input.project.lockfile.kind)}</p>`,
    `          <p class="project-pill">${escapeHtml(markdownProjectLabel(input))} · ${escapeHtml(input.profile)}</p>`,
    "        </div>",
    `        <div class="decision-banner decision-banner-${decisionSeverity}">`,
    "          <div>",
    `            <h1>${escapeHtml(title)}</h1>`,
    `            <p class="lead">${escapeHtml(localizedNextAction(input, text))}</p>`,
    "          </div>",
    `          <div class="decision-counts" aria-label="${escapeHtml(text.labels.risks)}">`,
    ...renderDecisionCounts(summary.risks, text),
    "          </div>",
    "        </div>",
    "      </header>",
    '    <section aria-labelledby="review-summary-heading">',
    `      <h2 id="review-summary-heading">${escapeHtml(text.labels.reviewSummary)}</h2>`,
    '      <dl class="summary-grid review-summary-grid">',
    ...renderSummaryCards(reviewSummaryCards.slice(0, 4)),
    "      </dl>",
    '      <details class="review-context">',
    `        <summary>${escapeHtml(text.labels.reviewFocus)}</summary>`,
    '        <dl class="summary-grid">',
    ...renderSummaryCards(reviewSummaryCards.slice(4)),
    "        </dl>",
    "      </details>",
    "    </section>",
    '    <details class="scan-summary">',
    `      <summary id="summary-heading">${escapeHtml(text.labels.summary)}</summary>`,
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
      ...renderHtmlRepositoryCoverageCard(input.repository, text),
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
    "    </details>",
    ...renderHtmlFindingsSection(
      input.riskFindings,
      input.profile,
      text,
      deferredFingerprintData.indexes
    ),
    ...renderHtmlWaivedFindingsSection(input.waivedFindings, text),
    ...renderHtmlExpiredWaiversSection(input.expiredWaivers, text),
    ...renderHtmlUnmatchedWaiversSection(input.unmatchedWaivers, text),
    '    <section aria-labelledby="next-heading">',
    `      <h2 id="next-heading">${escapeHtml(text.labels.next)}</h2>`,
    `      <p>${escapeHtml(localizedNextAction(input, text))}</p>`,
    "    </section>",
    "    </main>",
    "  </div>",
    ...renderHtmlDeferredFingerprintData(deferredFingerprintData.payload),
    "  <script>",
    ...renderHtmlFilterScript(text).map((line) => `    ${line}`),
    "  </script>",
    "</body>",
    "</html>"
  ].join("\n");
}

function highestRiskSeverity(risks: Record<RiskSeverity, number>): RiskSeverity {
  for (const severity of ["high", "review", "unknown", "low"] as const) {
    if (risks[severity] > 0) {
      return severity;
    }
  }
  return "low";
}

function renderDecisionCounts(
  risks: Record<RiskSeverity, number>,
  text: HtmlReportText
): string[] {
  return (["high", "review", "unknown", "low"] as const).map(
    (severity) =>
      `            <span class="risk-pill risk-pill-${severity}"><strong>${risks[severity]}</strong> ${escapeHtml(text.messages.severity(severity))}</span>`
  );
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
    ...(input.graphGate ? [["Graph gate", input.graphGate.failed ? "failed: dependency relationships are not fully known" : "passed"] as const] : []),
    [text.labels.activeFindings, text.messages.activeFindings(summary.risks)],
    [text.labels.scope, text.messages.scope(input.profile, input.prodOnly)],
    [
      text.labels.scanCoverage,
      formatScanCompleteness(input.completeness ?? buildScanCompleteness(input))
    ],
    [
      text.labels.waivers,
      text.messages.reviewWaivers(
        summary.waivers.applied,
        summary.waivers.expired + summary.waivers.unmatched
      )
    ],
    [text.labels.reviewFocus, localizedNextAction(input, text)],
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
  text: HtmlReportText,
  deferredFingerprintIndexes: ReadonlySet<number>
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
    '      <div class="findings-workspace">',
    '      <div class="finding-list" role="list">',
    ...findings.flatMap((finding, index) => renderHtmlFindingCard(
      finding,
      index,
      profile,
      text,
      deferredFingerprintIndexes.has(index)
    )),
    "      </div>",
    `      <aside class="finding-inspector" data-finding-inspector id="finding-inspector" tabindex="-1" aria-label="${escapeHtml(text.labels.findings)}">`,
    `        <p class="empty">${escapeHtml(findings[0]?.packageId ?? text.messages.noActiveFindings)}</p>`,
    "      </aside>",
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
  text: HtmlReportText,
  deferFingerprint: boolean
): string[] {
  const titleId = `finding-${index + 1}-title`;
  const fingerprintHtml = renderHtmlFingerprintValue(
    finding.fingerprint,
    index,
    deferFingerprint
  );

  return [
    `        <article class="finding-card" data-finding-card data-severity="${escapeHtml(finding.severity)}" data-dependency-scope="${escapeHtml(finding.dependencyScope)}" data-recommendation="${escapeHtml(finding.recommendation)}" role="listitem" aria-labelledby="${titleId}">`,
    `          <button type="button" class="finding-select" data-finding-select aria-pressed="${index === 0 ? "true" : "false"}" aria-controls="finding-inspector">`,
    `            <span class="finding-title" id="${titleId}"><code>${escapeHtml(finding.packageId)}</code></span>`,
    "          </button>",
    '          <dl class="finding-details finding-details-source" data-finding-details>',
    ...renderFindingDetail(text.labels.severity, renderSeverity(finding.severity, text), text),
    ...renderFindingDetail(text.labels.package, `<code class="wrap-value">${escapeHtml(finding.packageId)}</code>`, text),
    ...renderFindingDetail(text.labels.dependency, escapeHtml(text.messages.dependencyContext(finding)), text),
    ...renderFindingDetail(text.labels.reason, escapeHtml(text.messages.findingReason(finding, profile)), text, true),
    ...renderFindingDetail(text.labels.action, escapeHtml(text.messages.findingAction(finding)), text, true),
    ...renderFindingDetail(text.labels.findingPath, `<code class="wrap-value">${escapeHtml(formatPath(finding.paths[0]))}</code>`, text, true),
    ...renderFindingDetail(text.labels.evidenceDetail, escapeHtml(finding.evidence.join("; ")), text, true),
    ...renderFindingDetail(text.labels.fingerprint, fingerprintHtml, text, true),
    "          </dl>",
    "        </article>"
  ];
}

function renderHtmlFingerprintValue(
  fingerprint: string,
  index: number,
  deferred: boolean
): string {
  if (!deferred) {
    return `<code class="wrap-value">${escapeHtml(fingerprint)}</code>`;
  }
  const preview = `${fingerprint.slice(0, HTML_FINGERPRINT_PREVIEW_CHARS)}…`;
  return `<code class="wrap-value" data-fingerprint-index="${index}">${escapeHtml(preview)}</code>`;
}

type HtmlDeferredFingerprintRecord = null | string | [
  packageId: number,
  dependencyType: string,
  dependencyScope: string,
  paths: number[][],
  severity: string,
  recommendation: string,
  reason: number,
  evidence: number[]
] | [
  packageId: number,
  dependencyType: string,
  dependencyScope: string,
  paths: number[][],
  suffix: number
];

type HtmlDeferredFingerprintPayload = {
  v: 2;
  s: string[];
  f: HtmlDeferredFingerprintRecord[];
};

function buildHtmlDeferredFingerprintData(findings: RiskFinding[]): {
  indexes: ReadonlySet<number>;
  payload: HtmlDeferredFingerprintPayload | undefined;
} {
  const indexes = new Set<number>();
  const strings: string[] = [];
  const stringIndexes = new Map<string, number>();
  const records: HtmlDeferredFingerprintRecord[] = [];

  const addString = (value: string): number => {
    const existing = stringIndexes.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const index = strings.length;
    strings.push(value);
    stringIndexes.set(value, index);
    return index;
  };
  const addPaths = (dependencyPaths: readonly string[][]): number[][] => {
    let previous: readonly string[] = [];
    return dependencyPaths.map((segments) => {
      let shared = 0;
      while (
        shared < previous.length
        && shared < segments.length
        && previous[shared] === segments[shared]
      ) {
        shared += 1;
      }
      previous = segments;
      return [shared, ...segments.slice(shared).map(addString)];
    });
  };
  const addCanonicalIdentityPaths = (id: string): number[][] => {
    const encodedPaths: number[][] = [];
    const identitySeparator = id.lastIndexOf("::");
    let segmentStart = identitySeparator < 0 ? 0 : identitySeparator + 2;
    let segments: string[] = [];
    let previous: readonly string[] = [];
    for (let index = segmentStart; index <= id.length; index += 1) {
      const character = id[index];
      if (character !== ">" && character !== "|" && index !== id.length) {
        continue;
      }
      segments.push(decodeFindingComponent(id.slice(segmentStart, index)));
      segmentStart = index + 1;
      if (character === "|" || index === id.length) {
        let shared = 0;
        while (
          shared < previous.length
          && shared < segments.length
          && previous[shared] === segments[shared]
        ) {
          shared += 1;
        }
        encodedPaths.push([shared, ...segments.slice(shared).map(addString)]);
        previous = segments;
        segments = [];
      }
    }
    return encodedPaths;
  };

  for (const [index, finding] of findings.entries()) {
    if (finding.fingerprint.length < HTML_DEFERRED_FINGERPRINT_MIN_CHARS) {
      records.push(null);
      continue;
    }
    indexes.add(index);
    const canonicalId = finding.id;
    const canonicalPrefix = `${canonicalId}::`;
    const canonicalIdentity = finding.fingerprint.startsWith(canonicalPrefix);
    const structuredIdentity = canonicalIdentity
      ? { id: canonicalId, encodedPaths: addCanonicalIdentityPaths(canonicalId) }
      : legacyHtmlFingerprintIdentity(finding);
    if (structuredIdentity) {
      records.push([
        addString(finding.packageId),
        finding.dependencyType,
        finding.dependencyScope,
        "encodedPaths" in structuredIdentity
          ? structuredIdentity.encodedPaths
          : addPaths(structuredIdentity.paths),
        addString(finding.fingerprint.slice(structuredIdentity.id.length + 2))
      ]);
      continue;
    }
    const canonicalFingerprint = buildFindingFingerprint({
      id: canonicalId,
      severity: finding.severity,
      recommendation: finding.recommendation,
      reason: finding.reason,
      evidence: finding.evidence
    });
    records.push(canonicalFingerprint === finding.fingerprint
      ? [
          addString(finding.packageId),
          finding.dependencyType,
          finding.dependencyScope,
          addCanonicalIdentityPaths(canonicalId),
          finding.severity,
          finding.recommendation,
          addString(finding.reason),
          finding.evidence.map(addString)
        ]
      : finding.fingerprint);
  }

  return {
    indexes,
    payload: indexes.size === 0 ? undefined : { v: 2, s: strings, f: records }
  };
}

function legacyHtmlFingerprintIdentity(
  finding: RiskFinding
): { id: string; paths: string[][] } | undefined {
  const legacyId = buildLegacyFindingId({
    packageId: finding.packageId,
    dependencyType: finding.dependencyType,
    dependencyScope: finding.dependencyScope,
    paths: finding.paths
  });
  return finding.fingerprint.startsWith(`${legacyId}::`)
    ? { id: legacyId, paths: finding.paths }
    : undefined;
}

function decodeFindingComponent(value: string): string {
  return value
    .replace(/%7C/gu, "|")
    .replace(/%3E/gu, ">")
    .replace(/%3A/gu, ":")
    .replace(/%25/gu, "%");
}

function renderHtmlDeferredFingerprintData(
  payload: HtmlDeferredFingerprintPayload | undefined
): string[] {
  if (!payload) {
    return [];
  }
  const serialized = JSON.stringify(payload)
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  return [
    '  <script type="application/json" id="ohrisk-fingerprint-data">',
    `    ${serialized}`,
    "  </script>"
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

function localizedNextAction(input: ScanReportInput, text: HtmlReportText): string {
  if (input.graphGate?.failed) {
    return "Provide dependency inputs with complete relationships before relying on this graph gate.";
  }
  return input.repository && hasIncompleteRepositoryCoverage(input.repository)
    ? text.messages.incompleteRepositoryCoverageAction
    : text.messages.nextAction(input.riskFindings);
}

function renderHtmlRepositoryCoverageCard(
  repository: RemoteRepositoryReportSource | undefined,
  text: HtmlReportText
): Array<readonly [string, string]> {
  if (!repository || !hasIncompleteRepositoryCoverage(repository)) {
    return [];
  }
  const summaries: string[] = [];
  if (repository.submodules.skippedCount > 0) {
    summaries.push(text.messages.skippedSubmodules(
      repository.submodules.skippedCount,
      repository.submodules.skippedPaths,
      repository.submodules.pathsTruncated
    ));
  }
  if (repository.symbolicLinks.skippedCount > 0) {
    summaries.push(text.messages.skippedSymbolicLinks(
      repository.symbolicLinks.skippedCount,
      repository.symbolicLinks.skippedPaths,
      repository.symbolicLinks.pathsTruncated
    ));
  }
  if (repository.nonPortablePaths.skippedCount > 0) {
    summaries.push(text.messages.skippedNonPortablePaths(
      repository.nonPortablePaths.skippedCount,
      repository.nonPortablePaths.skippedPaths,
      repository.nonPortablePaths.pathsTruncated
    ));
  }
  return [[
    text.labels.scanCoverage,
    summaries.join(" ")
  ]];
}
