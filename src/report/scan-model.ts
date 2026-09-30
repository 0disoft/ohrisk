import path from "node:path";
import type { GraphGateOutcome } from "../../types/report-types";
import type { EvidenceDiagnostic, EvidenceDiagnosticCode, EvidenceSourceCounts, LicenseEvidence, LicenseEvidenceSource } from "../evidence/types";
import { packageUrl } from "../graph/package-url";
import { inputSupportForLockfile, formatProjectInputSupport } from "../ecosystems/registry";
import type { InputSupport } from "../ecosystems/input-support";
import type { DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import { NOTICE_ACTION } from "../policy/evaluate";
import type { RiskDependencyScope, RiskFinding, RiskRecommendation, RiskSeverity } from "../policy/types";
import type { RiskWaiver } from "../policy/waivers";
import { emptyPolicyConfig, summarizePolicyConfig, type PolicyConfigSummary } from "../policy/config";
import { projectLockfiles } from "../project/discover";
import { formatMarkdownInlineCode } from "./markdown";
import type { ScanReportInput, RemoteRepositoryReportSource } from "./scan-report";

export function dependencyProvenance(input: ScanReportInput): Array<{
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

export function displayDependencyOrigins(
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

export function displayLockfileSummary(project: ScanReportInput["project"]): string {
  return displayLockfiles(project)
    .map((lockfile) => `${lockfile.path} (${lockfile.kind})`)
    .join(", ") + `; input support: ${formatProjectInputSupport(project)}`;
}

export function renderAdditionalLockfileLines(project: ScanReportInput["project"]): string[] {
  const lockfiles = displayLockfiles(project);
  return lockfiles.length > 1
    ? [`Lockfiles: ${lockfiles.map((lockfile) => `${lockfile.path} (${lockfile.kind})`).join(", ")}`]
    : [];
}

export function renderAdditionalMarkdownLockfileLines(
  project: ScanReportInput["project"]
): string[] {
  const lockfiles = displayLockfiles(project);
  return lockfiles.length > 1
    ? [`- Lockfiles: ${lockfiles.map((lockfile) => `${formatMarkdownInlineCode(lockfile.path)} (${formatMarkdownInlineCode(lockfile.kind)})`).join(", ")}`]
    : [];
}

export function displayLockfiles(project: ScanReportInput["project"]): Array<{ kind: string; path: string; support?: InputSupport }> {
  return projectLockfiles(project).map((lockfile) => ({
    kind: lockfile.kind,
    ...(inputSupportForLockfile(lockfile.kind) ? { support: inputSupportForLockfile(lockfile.kind)! } : {}),
    path: displayProjectPath(project, lockfile.path)
  }));
}

export function disabledPolicySummary(): PolicyConfigSummary {
  return summarizePolicyConfig(emptyPolicyConfig());
}

export function displayProjectPath(project: ScanReportInput["project"], targetPath: string): string {
  const relativePath = path.relative(project.rootDir, targetPath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return project.source
      ? `${project.source.displayPath}!/${archiveEntryPath(project, normalizedPath)}`
      : normalizedPath;
  }
  return path.basename(targetPath);
}

export function displayLockfilePath(project: ScanReportInput["project"]): string {
  return displayProjectPath(project, project.lockfile.path);
}

export function displayLockfileDirectoryPath(project: ScanReportInput["project"]): string {
  const directoryPath = path.dirname(displayLockfilePath(project));
  return directoryPath === "" ? "." : directoryPath;
}

export function markdownProjectLabel(input: ScanReportInput): string {
  return input.project.source
    ? displayProjectLabel(input.project)
    : input.graph.rootName ?? ".";
}

export function displayProjectLabel(project: ScanReportInput["project"]): string {
  if (!project.source) {
    return project.rootDir;
  }

  return project.source.entryRoot === "." || project.source.entryRoot === ""
    ? project.source.displayPath
    : `${project.source.displayPath}!/${project.source.entryRoot}`;
}

export function archiveEntryPath(
  project: ScanReportInput["project"],
  relativePath: string
): string {
  const root = project.source?.entryRoot;
  if (!root || root === ".") {
    return relativePath;
  }
  return `${root}/${relativePath}`;
}

export function archiveReportSource(project: ScanReportInput["project"]): {
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

export function buildWaiverDriftSummary(input: ScanReportInput):
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

export function buildScanSummary(input: ScanReportInput): {
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

export function summarizeEvidence(evidence: LicenseEvidence[]): {
  sources: Record<LicenseEvidenceSource, EvidenceSourceCounts>;
  diagnostics: EvidenceDiagnostic[];
} {
  const sources: Record<LicenseEvidenceSource, EvidenceSourceCounts> = {
    local: { packages: 0, files: 0, warnings: 0 },
    registry: { packages: 0, files: 0, warnings: 0 },
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
    if (item.artifactIdentityConflict) {
      addEvidenceDiagnostic(diagnosticCounts, {
        code: "artifact_identity_conflict", source: item.source,
        packageId: item.packageId, occurrenceCount: 1
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

export function addEvidenceDiagnostic(
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

export function hasDeclaredLicenseEvidence(evidence: LicenseEvidence): boolean {
  return typeof evidence.packageJsonLicense === "string"
    || evidence.packageJsonLicenses !== undefined
    || typeof evidence.metadataLicense === "string"
    || evidence.metadataLicenses !== undefined;
}

export function summarizeLicenses(normalizedLicenses: NormalizedLicense[]): {
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

export function summarizeRiskFindings(riskFindings: RiskFinding[]): Record<RiskSeverity, number> {
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

export function summarizeFindingFilters(riskFindings: RiskFinding[]): {
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

export function formatWaiverMode(waiverMode: ScanReportInput["waiverMode"]): string {
  return waiverMode === "ignored" ? "ignored (--no-waivers)" : "local (.ohrisk-waivers.json)";
}

export function formatWaiverDriftSummary(
  waiverDriftSummary: ReturnType<typeof buildWaiverDriftSummary>
): string | undefined {
  if (!("strictWaivers" in waiverDriftSummary)) {
    return undefined;
  }

  const status = waiverDriftSummary.waiverDriftFailed ? "failed" : "passed";
  return `Waiver drift: ${status} (${waiverDriftSummary.waiverDriftCount} expired or unmatched waivers)`;
}

export function formatPath(pathItems: string[] | undefined): string {
  return pathItems?.join(" -> ") ?? "unknown";
}

export function formatDependencyContext(finding: RiskFinding): string {
  return `${finding.dependencyType} ${finding.dependencyScope}`;
}

export function formatWaiverTarget(waiver: RiskWaiver): string {
  if (waiver.decisionFingerprint) return `decisionFingerprint: ${waiver.decisionFingerprint}`;
  if (waiver.id) {
    return `id: ${waiver.id}`;
  }

  return `fingerprint: ${waiver.fingerprint ?? "unknown"}`;
}

export function nextActionFor(
  findings: RiskFinding[],
  repository?: RemoteRepositoryReportSource,
  graphGate?: GraphGateOutcome
): string {
  if (graphGate?.failed) {
    return "Provide dependency inputs with complete relationships before relying on this graph gate.";
  }
  if (repository && hasIncompleteRepositoryCoverage(repository)) {
    return "Review skipped repository entries and scan any omitted dependency inputs separately before treating this report as complete.";
  }

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

export function hasIncompleteRepositoryCoverage(repository: RemoteRepositoryReportSource): boolean {
  return repository.submodules.skippedCount > 0
    || repository.symbolicLinks.skippedCount > 0
    || repository.nonPortablePaths.skippedCount > 0;
}

export function formatSkippedRepositoryEntrySummary(repository: RemoteRepositoryReportSource): string {
  const summaries: string[] = [];
  if (repository.submodules.skippedCount > 0) {
    summaries.push(formatSkippedEntrySummary(
      repository.submodules,
      "Git submodule",
      "Git submodules"
    ));
  }
  if (repository.symbolicLinks.skippedCount > 0) {
    summaries.push(formatSkippedEntrySummary(
      repository.symbolicLinks,
      "symbolic link",
      "symbolic links"
    ));
  }
  if (repository.nonPortablePaths.skippedCount > 0) {
    summaries.push(formatSkippedEntrySummary(
      repository.nonPortablePaths,
      "non-portable path",
      "non-portable paths"
    ));
  }
  return `${summaries.join("; ")}; coverage is incomplete.`;
}

export function formatSkippedEntrySummary(
  summary: { skippedCount: number; skippedPaths: string[]; pathsTruncated: boolean },
  singular: string,
  plural: string
): string {
  const pathList = summary.skippedPaths.join(", ");
  const suffix = summary.pathsTruncated ? ", …" : "";
  const label = summary.skippedCount === 1 ? singular : plural;
  return `${summary.skippedCount} ${label} skipped (${pathList}${suffix})`;
}
