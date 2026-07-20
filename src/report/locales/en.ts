import { NOTICE_ACTION } from "../../policy/evaluate";
import type { RiskFinding } from "../../policy/types";
import type { ThresholdSummary } from "../threshold-summary";
import type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText,
  WaiverDriftSummary
} from "./types";

export const ENGLISH_TEXT: HtmlReportText = {
  htmlLang: "en",
  title: "Ohrisk scan",
  labels: {
    action: "Action",
    activeFindings: "Active findings",
    dependency: "Dependency",
    dependencies: "Dependencies",
    evidence: "Evidence",
    evidenceDetail: "Evidence",
    evidenceRecovery: "Evidence recovery",
    expiresOn: "Expires on",
    expiredWaivers: "Expired waivers",
    findingPath: "Path",
    findings: "Findings",
    fingerprint: "Fingerprint",
    licenseConfidence: "License confidence",
    licenseIssues: "License issues",
    lockfile: "Lockfile",
    matchedBy: "Matched by",
    next: "Next",
    package: "Package",
    path: "Path",
    prodOnly: "Production only",
    profile: "Profile",
    project: "Project",
    reason: "Reason",
    reviewFocus: "Review focus",
    reviewSummary: "Review summary",
    risks: "Risks",
    scanCoverage: "Scan coverage",
    scope: "Scope",
    search: "Search",
    severity: "Severity",
    status: "Status",
    summary: "Summary",
    target: "Target",
    threshold: "Threshold",
    unmatchedWaivers: "Unmatched waivers",
    waiverDrift: "Waiver drift",
    waiverMode: "Waiver mode",
    waived: "Waived",
    waivedFindings: "Waived findings",
    waivers: "Waivers"
  },
  messages: {
    allActions: "All actions",
    allDependencies: "All dependencies",
    collapseText: "Less",
    defaultCollapseLabel: "Collapse value",
    defaultExpandLabel: "Show full value",
    searchPlaceholder: "Package, reason, evidence",
    noActiveFindings: "No active findings.",
    noExpiredWaivers: "No expired waivers.",
    noMatchingFindings: "No findings match the selected filters.",
    noUnmatchedWaivers: "No unmatched waivers.",
    noWaivedFindings: "No waived findings.",
    waiverMode: (mode) =>
      mode === "ignored" ? "ignored (--no-waivers)" : "local (.ohrisk-waivers.json)",
    dependencies: (total, direct, transitive) =>
      `${total} total, ${direct} direct, ${transitive} transitive`,
    evidence: (files, warnings) => `${files} files, ${warnings} warnings`,
    skippedSubmodules: (count, paths, pathsTruncated) =>
      `${count} Git submodule${count === 1 ? "" : "s"} skipped (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); coverage is incomplete.`,
    skippedSymbolicLinks: (count, paths, pathsTruncated) =>
      `${count} symbolic link${count === 1 ? "" : "s"} skipped without following targets (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); coverage is incomplete.`,
    skippedNonPortablePaths: (count, paths, pathsTruncated) =>
      `${count} non-portable path${count === 1 ? "" : "s"} skipped (${paths.join(", ")}${pathsTruncated ? ", …" : ""}); coverage is incomplete.`,
    incompleteRepositoryCoverageAction:
      "Review skipped repository entries and scan any omitted dependency inputs separately before treating this report as complete.",
    licenseConfidence: (high, medium, low) =>
      `${high} high-confidence, ${medium} medium-confidence, ${low} low-confidence`,
    licenseIssues: (missing, malformed) => `${missing} missing, ${malformed} malformed`,
    risks: (risks) =>
      `${risks.high} high, ${risks.review} review, ${risks.unknown} unknown, ${risks.low} low`,
    waived: (applied, expired, unmatched) =>
      `${applied} applied, ${expired} expired, ${unmatched} unmatched`,
    reviewStatus: (risks) => {
      if (risks.high > 0) return "High risk review needed";
      if (risks.unknown > 0) return "Evidence review needed";
      if (risks.review > 0) return "Policy review needed";
      if (risks.low > 0) return "Low risk findings only";
      return "No active findings";
    },
    activeFindings: (risks) => {
      const total = risks.high + risks.review + risks.unknown + risks.low;
      return `${total} active (${risks.high} high, ${risks.review} review, ${risks.unknown} unknown, ${risks.low} low)`;
    },
    scope: (profile, prodOnly) =>
      `${profile} profile, ${prodOnly ? "production only" : "all dependencies"}`,
    reviewWaivers: (applied, driftEntries) => `${applied} applied, ${driftEntries} drift entries`,
    reviewWaiverDrift: (summary) => {
      const line = englishWaiverDrift(summary);
      return line?.replace(/^Waiver drift: /, "") ?? "Not checked (--strict-waivers not set)";
    },
    evidenceRecovery: englishEvidenceRecovery,
    threshold: englishThreshold,
    waiverDrift: englishWaiverDrift,
    nextAction: englishNextAction,
    severity: (severity) => severity,
    recommendation: (recommendation) => recommendation,
    dependencyScope: (scope) => scope,
    dependencyType: (type) => type,
    dependencyContext: (finding) => `${finding.dependencyType} ${finding.dependencyScope}`,
    findingReason: (finding) => finding.reason,
    findingAction: (finding) => finding.action,
    waiverTarget: (waiver) =>
      waiver.id ? `id: ${waiver.id}` : `fingerprint: ${waiver.fingerprint ?? "unknown"}`,
    expandLabel: (label) => `Show full ${label}`,
    collapseLabel: (label) => `Collapse ${label}`,
    filterStatusTemplate: "{visible} of {total} findings shown"
  },
  captions: {
    waivedFindings: "Findings suppressed by local waivers",
    expiredWaivers: "Expired local waiver entries",
    unmatchedWaivers: "Active waiver entries that did not match current findings"
  }
};

function englishThreshold(summary: ThresholdSummary): string | undefined {
  if (!summary.failOn || typeof summary.failed !== "boolean") {
    return undefined;
  }

  if (typeof summary.failingFindingCount !== "number") {
    return undefined;
  }

  const outcome = summary.failed ? "failed" : "passed";
  const findingLabel = summary.failingFindingCount === 1 ? "finding" : "findings";

  return `Threshold: ${outcome} on ${summary.failOn} (${summary.failingFindingCount} ${findingLabel} at or above threshold)`;
}

function englishWaiverDrift(summary: WaiverDriftSummary): string | undefined {
  if (!summary.strictWaivers || typeof summary.waiverDriftFailed !== "boolean") {
    return undefined;
  }

  if (typeof summary.waiverDriftCount !== "number") {
    return undefined;
  }

  const status = summary.waiverDriftFailed ? "failed" : "passed";
  return `Waiver drift: ${status} (${summary.waiverDriftCount} expired or unmatched waivers)`;
}

function englishNextAction(findings: RiskFinding[]): string {
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

function englishEvidenceRecovery(advice: EvidenceRecoveryAdvice): string {
  const ratio = `${advice.localEvidenceMissingFindings} of ${advice.unknownFindings} unknown`;
  const prefix = `Many unknown findings look caused by missing local package source/cache evidence (${ratio}).`;
  const primary = advice.primaryHint
    ? ` ${englishEvidenceRecoveryHint(advice.primaryHint)}`
    : "";
  return `${prefix}${primary} Restore dependencies without a full app build when possible, then rerun Ohrisk. Other ecosystem examples: npm/pnpm/Bun install, cargo fetch, dotnet restore, Maven/Gradle dependency resolution, Python virtualenv install, dart pub get, and swift package resolve.`;
}

function englishEvidenceRecoveryHint(hint: EvidenceRecoveryHint): string {
  const directory = hint.directoryIsScanRoot ? "scan root" : hint.directoryLabel;
  if (hint.ecosystem === "go") {
    const source = hint.sourceFileLabel ? ` containing ${hint.sourceFileLabel}` : "";
    return `Run ${hint.command} from the directory${source} (${directory}); for go.work, use a module listed by use if the Go toolchain asks for a module.`;
  }

  return `Run ${hint.command} from ${directory}.`;
}
