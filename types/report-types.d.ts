/**
 * Public TypeScript contracts for Ohrisk's machine-readable JSON reports.
 *
 * These types model report instances. The packaged JSON Schemas remain the
 * runtime validation source of truth.
 */

export type ReportSchemaVersion = "3.5.0";

export type CommonReportSchemaId =
  `urn:ohrisk:schema:common:${ReportSchemaVersion}`;
export type ScanReportSchemaId =
  `urn:ohrisk:schema:scan-report:${ReportSchemaVersion}`;
export type DiffReportSchemaId =
  `urn:ohrisk:schema:diff-report:${ReportSchemaVersion}`;
export type ExplainReportSchemaId =
  `urn:ohrisk:schema:explain-report:${ReportSchemaVersion}`;
export type WaiverFileSchemaVersion = "1.0.0";
export type WaiverFileSchemaId =
  `urn:ohrisk:schema:waiver-file:${WaiverFileSchemaVersion}`;

export type UsageProfile = "saas" | "distributed-app";
export type RiskSeverity = "low" | "review" | "high" | "unknown";
export type RiskRecommendation =
  | "allow"
  | "review"
  | "replace"
  | "exclude-dev-only"
  | "collect-evidence";
export type RiskDependencyType =
  | "production"
  | "development"
  | "optional"
  | "peer"
  | "unknown";
export type RiskDependencyScope = "direct" | "transitive";

export type Finding = {
  id: string;
  fingerprint: string;
  packageId: string;
  severity: RiskSeverity;
  reason: string;
  action: string;
  dependencyType: RiskDependencyType;
  dependencyScope: RiskDependencyScope;
  evidence: string[];
  paths: string[][];
  recommendation: RiskRecommendation;
};

export type RiskFinding = Finding;

export type RiskWaiver = {
  id?: string;
  fingerprint?: string;
  reason: string;
  expiresOn?: string;
};

export type WaivedRiskFinding = {
  finding: Finding;
  waiver: RiskWaiver;
  matchedBy: "id" | "fingerprint";
};

export type NormalizedLicenseSignal =
  | "missing"
  | "malformed"
  | "conflicting-evidence"
  | "custom-text"
  | "commercial-restriction"
  | "notice-required";
export type NormalizedLicenseConfidence = "high" | "medium" | "low";
export type NormalizedLicenseJoiner = "single" | "and" | "or" | "mixed";

export type NormalizedLicense = {
  packageId: string;
  original?: string;
  expression?: string;
  choices: string[];
  joiner: NormalizedLicenseJoiner;
  signals: NormalizedLicenseSignal[];
  evidenceSources: string[];
  confidence: NormalizedLicenseConfidence;
  exceptions?: string[];
};

export type PolicyConfigSummary = {
  digest: string;
  enabled: boolean;
  sourceFiles: string[];
  allowLicenseCount: number;
  denyLicenseCount: number;
  severityOverrideCount: number;
  packageRuleCount: number;
  profileCount: number;
  profileOverrideCount: number;
  allowedRegistryHostCount: number;
  registryAuthHostCount: number;
  npmRegistryUrl?: string;
};

export type RiskCounts = Record<RiskSeverity, number>;

export type DependencyGraphCounts = {
  total: number;
  direct: number;
  transitive: number;
};

export type DependencyGraphDiagnostic = {
  code: "dependency_paths_truncated" | "dependency_path_depth_summarized";
  affectedNodeCount: number;
  limit: number;
  message: string;
};

export type LicenseEvidenceSource =
  | "local"
  | "registry"
  | "sbom"
  | "tarball"
  | "unavailable";
export type EvidenceDiagnosticCode =
  | "collector_warning"
  | "license_evidence_missing"
  | "source_unavailable";

export type EvidenceSourceCounts = {
  packages: number;
  files: number;
  warnings: number;
};

export type EvidenceDiagnostic = {
  code: EvidenceDiagnosticCode;
  source: LicenseEvidenceSource;
  packageCount: number;
  occurrenceCount: number;
};

export type EvidenceCounts = {
  packages: number;
  files: number;
  warnings: number;
  sources: Record<LicenseEvidenceSource, EvidenceSourceCounts>;
  diagnostics: EvidenceDiagnostic[];
};

export type LicenseCounts = {
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  missing: number;
  malformed: number;
};

export type WaiverCounts = {
  applied: number;
  expired: number;
  unmatched: number;
};

export type Lockfile = {
  kind: string;
  path: string;
};

export type PackageProvenance = {
  packageId: string;
  purl: string;
  origins: Lockfile[];
};

export type LockfileChanges = {
  current: Lockfile[];
  baseline: Lockfile[];
  added: Lockfile[];
  removed: Lockfile[];
};

export type RepositorySkippedEntries = {
  skippedCount: number;
  skippedPaths: string[];
  pathsTruncated: boolean;
};

export type RemoteRepositoryReportSource = {
  owner: string;
  name: string;
  submodules: RepositorySkippedEntries & {
    mode: "ignore" | "reject";
  };
  symbolicLinks: RepositorySkippedEntries;
  nonPortablePaths: RepositorySkippedEntries;
};

export type ArchiveReportSource = {
  name: string;
  format: "zip" | "tar" | "tar.gz";
  sha256: string;
  root: string;
};

export type ScanCompleteness = {
  status: "complete" | "partial";
  unavailablePackageCount: number;
  skippedRepositoryEntryCount: number;
};

export type ThresholdOutcome = {
  failOn?: RiskSeverity;
  failed?: boolean;
  failingFindingCount?: number;
};

export type WaiverDriftOutcome = {
  strictWaivers?: boolean;
  waiverDriftFailed?: boolean;
  waiverDriftCount?: number;
};

export type ScanReport = ThresholdOutcome & WaiverDriftOutcome & {
  $schema: ScanReportSchemaId;
  schemaVersion: ReportSchemaVersion;
  status: "profile_risk_evaluated";
  projectRoot: ".";
  repository?: RemoteRepositoryReportSource;
  archive?: ArchiveReportSource;
  lockfile: Lockfile;
  lockfiles: Lockfile[];
  profile: UsageProfile;
  prodOnly: boolean;
  dependencyGraph: DependencyGraphCounts;
  dependencyGraphDiagnostics: DependencyGraphDiagnostic[];
  dependencyOrigins: PackageProvenance[];
  evidence: EvidenceCounts;
  completeness: ScanCompleteness;
  licenses: LicenseCounts;
  risks: RiskCounts;
  waiverMode: "local" | "ignored";
  waivers: WaiverCounts;
  policy: PolicyConfigSummary;
  nextAction: string;
  findings: Finding[];
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
};

export type DiffReport = ThresholdOutcome & {
  $schema: DiffReportSchemaId;
  schemaVersion: ReportSchemaVersion;
  status: "risk_diff_evaluated";
  baselineRef: string;
  profile: UsageProfile;
  prodOnly: boolean;
  baselineFindingCount: number;
  currentFindingCount: number;
  newFindingCount: number;
  changedFindingCount: number;
  resolvedFindingCount: number;
  introducedFindingCount: number;
  newRisks: RiskCounts;
  changedRisks: RiskCounts;
  resolvedRisks: RiskCounts;
  introducedRisks: RiskCounts;
  lockfileChanges: LockfileChanges;
  nextAction: string;
  policy?: PolicyConfigSummary;
  findings: Finding[];
  newFindings: Finding[];
  changedFindings: Finding[];
  resolvedFindings: Finding[];
};

export type ExplainReport = {
  $schema: ExplainReportSchemaId;
  schemaVersion: ReportSchemaVersion;
  status: "license_explained";
  expression: string;
  profile: UsageProfile;
  policyScope: "license-only";
  policy: PolicyConfigSummary;
  license: NormalizedLicense;
  finding: Finding;
};

export type WaiverFileEntry = RiskWaiver & (
  | { id: string }
  | { fingerprint: string }
);

export type WaiverFile = {
  waivers: WaiverFileEntry[];
};
