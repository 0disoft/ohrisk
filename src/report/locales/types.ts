import type {
  RiskDependencyScope,
  RiskDependencyType,
  RiskFinding,
  RiskRecommendation,
  RiskSeverity
} from "../../policy/types";
import type { RiskWaiver } from "../../policy/waivers";
import type { ThresholdSummary } from "../threshold-summary";

export type RiskCounts = Record<RiskSeverity, number>;
export type WaiverMode = "local" | "ignored";
export type WaiverDriftSummary = {
  strictWaivers?: true;
  waiverDriftFailed?: boolean;
  waiverDriftCount?: number;
};
export type EvidenceRecoveryAdvice = {
  unknownFindings: number;
  localEvidenceMissingFindings: number;
  primaryHint?: EvidenceRecoveryHint;
};
export type EvidenceRecoveryHint = {
  ecosystem: "go" | "generic";
  command: string;
  directoryLabel: string;
  directoryIsScanRoot: boolean;
  sourceFileLabel?: string;
};
export type HtmlReportText = {
  htmlLang: string;
  title: string;
  labels: {
    action: string;
    activeFindings: string;
    dependency: string;
    dependencies: string;
    evidence: string;
    evidenceDetail: string;
    evidenceRecovery: string;
    expiresOn: string;
    expiredWaivers: string;
    findingPath: string;
    findings: string;
    fingerprint: string;
    licenseConfidence: string;
    licenseIssues: string;
    lockfile: string;
    matchedBy: string;
    next: string;
    package: string;
    path: string;
    prodOnly: string;
    profile: string;
    project: string;
    reason: string;
    reviewFocus: string;
    reviewSummary: string;
    risks: string;
    scanCoverage: string;
    scope: string;
    search: string;
    severity: string;
    status: string;
    summary: string;
    target: string;
    threshold: string;
    unmatchedWaivers: string;
    waiverDrift: string;
    waiverMode: string;
    waived: string;
    waivedFindings: string;
    waivers: string;
  };
  messages: {
    allActions: string;
    allDependencies: string;
    collapseText: string;
    defaultCollapseLabel: string;
    defaultExpandLabel: string;
    searchPlaceholder: string;
    noActiveFindings: string;
    noExpiredWaivers: string;
    noMatchingFindings: string;
    noUnmatchedWaivers: string;
    noWaivedFindings: string;
    waiverMode: (mode: WaiverMode) => string;
    dependencies: (total: number, direct: number, transitive: number) => string;
    evidence: (files: number, warnings: number) => string;
    skippedSubmodules: (count: number, paths: string[], pathsTruncated: boolean) => string;
    skippedSubmoduleAction: string;
    licenseConfidence: (high: number, medium: number, low: number) => string;
    licenseIssues: (missing: number, malformed: number) => string;
    risks: (risks: RiskCounts) => string;
    waived: (applied: number, expired: number, unmatched: number) => string;
    reviewStatus: (risks: RiskCounts) => string;
    activeFindings: (risks: RiskCounts) => string;
    scope: (profile: string, prodOnly: boolean) => string;
    reviewWaivers: (applied: number, driftEntries: number) => string;
    reviewWaiverDrift: (summary: WaiverDriftSummary) => string;
    evidenceRecovery: (advice: EvidenceRecoveryAdvice) => string;
    threshold: (summary: ThresholdSummary) => string | undefined;
    waiverDrift: (summary: WaiverDriftSummary) => string | undefined;
    nextAction: (findings: RiskFinding[]) => string;
    severity: (severity: RiskSeverity) => string;
    recommendation: (recommendation: RiskRecommendation) => string;
    dependencyScope: (scope: RiskDependencyScope) => string;
    dependencyType: (type: RiskDependencyType) => string;
    dependencyContext: (finding: RiskFinding) => string;
    findingReason: (finding: RiskFinding, profile: string) => string;
    findingAction: (finding: RiskFinding) => string;
    waiverTarget: (waiver: RiskWaiver) => string;
    expandLabel: (label: string) => string;
    collapseLabel: (label: string) => string;
    filterStatusTemplate: string;
  };
  captions: {
    waivedFindings: string;
    expiredWaivers: string;
    unmatchedWaivers: string;
  };
};
