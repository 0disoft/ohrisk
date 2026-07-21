#!/usr/bin/env node
import { isIP } from "node:net";
import {
  createProgressRuntime,
  type ProgressRuntime,
  type StreamTarget,
  type TaskHandle
} from "@0disoft/laqu";
import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, type CliCommand, type HelpTarget } from "./args";
import { OHRISK_VERSION } from "./version";
import { loadArchiveProject } from "../archive/archive-project";
import { readArchiveFile } from "../archive/archive-reader";
import { diffRiskFindings } from "../diff/compare";
import {
  defaultArtifactCacheDirectory,
  openArtifactCacheForManagement,
  type ArtifactCacheStatus
} from "../evidence/cache";
import {
  collectGraphEvidence,
  fetchMavenCentralModelPoms,
  type EvidenceCollectionProgress
} from "../evidence/collect";
import {
  parseProjectDependencyGraph,
  parseProjectDependencyGraphWithRemoteMavenPoms
} from "../ecosystems/registry";
import type { LicenseEvidence } from "../evidence/types";
import {
  listGitRefFiles,
  readGitRefFile,
  type GitRefFileLister,
  type GitRefFileReader
} from "../git/ref-file";
import {
  findNearestDirectoryPackagesPropsPath
} from "../graph/dotnet-nuget-lock";
import {
  findGoWorkModulePaths,
  type GoWorkModuleInput
} from "../graph/go-work";
import {
  findYarnWorkspacePackageJsonPaths,
  findYarnWorkspacePackageJsonPathsFromRelativePaths,
  type YarnWorkspacePackageJsonInput
} from "../graph/npm-yarn-lock";
import { parseLockfileTextForKind } from "../graph/project-lockfile";
import {
  type RequirementsIncludedFileReader
} from "../graph/python-requirements";
import type { PythonLocalSourceFileReader } from "../graph/python-local-source";
import {
  findCargoWorkspaceMemberManifestPaths,
  findCargoWorkspaceMemberManifestPathsFromRelativePaths
} from "../graph/rust-cargo-lock";
import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../graph/merge";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { normalizeAllLicenseEvidence, normalizeLicenseEvidence } from "../license/normalize";
import type { NormalizedLicense } from "../license/types";
import { evaluateLicenseRisk, evaluateLicenseRisks } from "../policy/evaluate";
import {
  readPolicyConfig,
  summarizePolicyConfig,
  type PolicyConfigSummary,
  type ResolvedPolicyConfig
} from "../policy/config";
import { hasFindingAtOrAbove } from "../policy/severity";
import type { RiskFinding } from "../policy/types";
import {
  applyRiskWaivers,
  readRiskWaivers,
  type RiskWaiver,
  type WaivedRiskFinding
} from "../policy/waivers";
import { renderCycloneDxReport } from "../report/cyclonedx-report";
import { renderDiffReport, type DiffLockfileChanges } from "../report/diff-report";
import { renderExplainReport } from "../report/explain-report";
import { renderSarifReport } from "../report/sarif-report";
import {
  renderScanReport,
  type RemoteRepositoryReportSource,
  type ScanReportInput
} from "../report/scan-report";
import { openReportFile, type ReportOpener } from "../report/open-report";
import { writeReportFile, type ReportWriter } from "../report/write-output";
import {
  cloneGitHubRepository,
  type RepositoryCloner
} from "../repository/github-repository";
import {
  discoverProject,
  projectLockfiles,
  projectLockfilesFromRelativePaths,
  type ProjectInput,
  type ProjectLockfile
} from "../project/discover";
import { createError, exitCodeForError, formatError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";

export type CliIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stderrStream?: StreamTarget;
  env?: Record<string, string | undefined>;
  now?: () => number;
  readRefFile?: GitRefFileReader;
  listRefFiles?: GitRefFileLister;
  writeReport?: ReportWriter;
  openReport?: ReportOpener;
  cloneRepository?: RepositoryCloner;
};

type ScanClock = () => number;
type ScanProgressCloseStatus = "success" | "failure";
type ScanProgressReporter = ((percent: number, message: string) => void) & {
  close?: (status?: ScanProgressCloseStatus) => Promise<void>;
};
type ScanResult = {
  project: ProjectInput;
  graph: DependencyGraph;
  evidence: LicenseEvidence[];
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
  policy: PolicyConfigSummary;
};

type EvidenceRuntimeOptions = {
  offline: boolean;
  cacheDir: string;
  jobs?: number;
  timeoutMs?: number;
  npmRegistryUrl?: string;
  registryAuthTokens: ReadonlyMap<string, string>;
  allowedArtifactHosts: ReadonlySet<string>;
};

const SCAN_PROGRESS_DISCOVER_PERCENT = 5;
const SCAN_PROGRESS_READ_LOCKFILE_PERCENT = 10;
const SCAN_PROGRESS_EVIDENCE_START_PERCENT = 10;
const SCAN_PROGRESS_EVIDENCE_END_PERCENT = 95;
const SCAN_PROGRESS_EVALUATE_PERCENT = 96;
const SCAN_PROGRESS_RENDER_PERCENT = 98;
const SCAN_PROGRESS_WRITE_PERCENT = 99;
const SCAN_PROGRESS_READY_PERCENT = 100;
const SCAN_PROGRESS_BAR_WIDTH = 20;
const SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE = 5;

export async function main(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIO()
): Promise<number> {
  const parsed = parseArgs(argv);

  if (isErr(parsed)) {
    io.stderr(formatError(parsed.error));
    return exitCodeForError(parsed.error);
  }

  const command = parsed.value;

  switch (command.kind) {
    case "help":
      io.stdout(renderHelp(command.target));
      return 0;
    case "version":
      io.stdout(renderVersion());
      return 0;
    case "cache":
      return runCache(command, io);
    case "scan":
      return runScan(command, io);
    case "ci":
      return runScan(command, io);
    case "diff":
      return runDiff(command, io);
    case "explain":
      return runExplain(command, io);
  }
}

function runCache(
  command: Extract<CliCommand, { kind: "cache" }>,
  io: CliIO
): number {
  const env = io.env ?? process.env;
  const configuredCacheDir = command.cacheDir ?? env.OHRISK_CACHE_DIR;
  const cacheDir = configuredCacheDir
    ? path.resolve(io.cwd, configuredCacheDir)
    : defaultArtifactCacheDirectory(env);
  const cache = openArtifactCacheForManagement(cacheDir);
  const location = configuredCacheDir
    ? path.relative(io.cwd, cacheDir) || "."
    : cacheDir;

  if (command.action === "status") {
    const status = cache.status();
    if (!status.ok) {
      io.stderr(formatError(status.error));
      return exitCodeForError(status.error);
    }
    io.stdout(command.json
      ? renderCacheJson("status", configuredCacheDir !== undefined, status.value)
      : renderCacheStatus(status.value, location));
    return 0;
  }

  if (command.action === "prune") {
    const pruned = cache.prune({
      ...(command.maxSizeBytes !== undefined
        ? { maxSizeBytes: command.maxSizeBytes }
        : {}),
      ...(command.maxAgeMs !== undefined ? { maxAgeMs: command.maxAgeMs } : {})
    });
    if (!pruned.ok) {
      io.stderr(formatError(pruned.error));
      return exitCodeForError(pruned.error);
    }
    io.stdout(command.json
      ? renderCacheJson("prune", configuredCacheDir !== undefined, pruned.value)
      : [
          "Artifact cache pruned",
          `Location: ${location}`,
          `Entries removed: ${pruned.value.removedEntryCount}`,
          `Objects removed: ${pruned.value.removedObjectCount}`,
          `Bytes removed: ${formatByteCount(pruned.value.removedBytes)}`,
          `Remaining entries: ${pruned.value.after.entryCount}`,
          `Remaining size: ${formatByteCount(pruned.value.after.totalBytes)}`
        ].join("\n"));
    return 0;
  }

  const cleared = cache.clear();
  if (!cleared.ok) {
    io.stderr(formatError(cleared.error));
    return exitCodeForError(cleared.error);
  }
  io.stdout(command.json
    ? renderCacheJson("clear", configuredCacheDir !== undefined, cleared.value)
    : [
        "Artifact cache cleared",
        `Location: ${location}`,
        `Entries removed: ${cleared.value.removedEntryCount}`,
        `Objects removed: ${cleared.value.removedObjectCount}`,
        `Bytes removed: ${formatByteCount(cleared.value.removedBytes)}`
      ].join("\n"));
  return 0;
}

function renderCacheJson(
  action: "status" | "prune" | "clear",
  configured: boolean,
  result: unknown
): string {
  return `${JSON.stringify({
    action,
    cacheLocation: configured ? "configured" : "default",
    result
  }, null, 2)}\n`;
}

function renderCacheStatus(status: ArtifactCacheStatus, location: string): string {
  return [
    "Artifact cache status",
    `Location: ${location}`,
    `Entries: ${status.entryCount}`,
    `Objects: ${status.objectCount}`,
    `Size: ${formatByteCount(status.totalBytes)}`,
    `Orphan objects: ${status.orphanObjectCount}`,
    `Orphan bytes: ${formatByteCount(status.orphanBytes)}`,
    `Stale entries: ${status.staleEntryCount}`,
    `Corrupt entries: ${status.corruptEntryCount}`,
    `Oldest access: ${formatCacheTimestamp(status.oldestAccessedAt)}`,
    `Newest access: ${formatCacheTimestamp(status.newestAccessedAt)}`
  ].join("\n");
}

function formatByteCount(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2);
  return `${formatted} ${units[unitIndex]}`;
}

function formatCacheTimestamp(value: number | undefined): string {
  return value === undefined ? "none" : new Date(value).toISOString();
}

async function runDiff(
  command: Extract<CliCommand, { kind: "diff" }>,
  io: CliIO
): Promise<number> {
  const workspaceRoot = resolveWorkspaceRootPath({
    cwd: io.cwd,
    workspaceRootPath: command.workspaceRootPath
  });
  if (isErr(workspaceRoot)) {
    io.stderr(formatError(workspaceRoot.error));
    return exitCodeForError(workspaceRoot.error);
  }

  const currentProject = loadProjectGraph({
    cwd: io.cwd,
    ...(command.lockfilePath ? { lockfilePath: command.lockfilePath } : {}),
    ...(command.allLockfiles ? { allLockfiles: true } : {}),
    prodOnly: command.prodOnly
  });

  if (isErr(currentProject)) {
    io.stderr(formatError(currentProject.error));
    return exitCodeForError(currentProject.error);
  }

  const policy = readPolicyConfig({
    projectRoot: currentProject.value.project.rootDir,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
    ...(command.policyPath ? { policyPath: command.policyPath } : {})
  });
  if (isErr(policy)) {
    io.stderr(formatError(policy.error));
    return exitCodeForError(policy.error);
  }

  const evidenceRuntime = resolveEvidenceRuntimeOptions({
    cwd: io.cwd,
    projectRoot: currentProject.value.project.rootDir,
    policy: policy.value,
    offline: command.offline ?? false,
    ...(command.cacheDir ? { cacheDir: command.cacheDir } : {}),
    ...(command.jobs !== undefined ? { jobs: command.jobs } : {}),
    ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
    ...(command.registryUrl ? { registryUrl: command.registryUrl } : {}),
    ...(command.registryTokenEnv ? { registryTokenEnv: command.registryTokenEnv } : {}),
    allowedHosts: command.allowedHosts ?? [],
    env: io.env ?? process.env
  });
  if (isErr(evidenceRuntime)) {
    io.stderr(formatError(evidenceRuntime.error));
    return exitCodeForError(evidenceRuntime.error);
  }

  const readRefFile = io.readRefFile ?? readGitRefFile;
  const listRefFiles = io.listRefFiles ?? listGitRefFiles;
  const baselineProject = loadBaselineProjectGraph({
    currentProject: currentProject.value,
    baselineRef: command.baselineRef,
    allLockfiles: command.allLockfiles ?? false,
    readRefFile,
    listRefFiles
  });

  if (isErr(baselineProject)) {
    io.stderr(formatError(baselineProject.error));
    return exitCodeForError(baselineProject.error);
  }

  const baselineScanGraph = filterGraphForProdOnly(
    baselineProject.value.graph,
    command.prodOnly
  );
  const baselineEvidence = await collectEvidenceForGraph({
    graph: baselineScanGraph,
    projectRoot: currentProject.value.project.rootDir,
    evidenceRuntime: evidenceRuntime.value,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {})
  });

  if (isErr(baselineEvidence)) {
    io.stderr(formatError(baselineEvidence.error));
    return exitCodeForError(baselineEvidence.error);
  }

  const baselineLicenses = normalizeAllLicenseEvidence(baselineEvidence.value);
  const baselineFindings = evaluateLicenseRisks({
    licenses: baselineLicenses,
    dependencies: baselineScanGraph.nodes,
    profile: command.profile,
    policy: policy.value
  });
  const current = await evaluateProjectScan({
    ...currentProject.value,
    profile: command.profile,
    policy: policy.value,
    evidenceRuntime: evidenceRuntime.value,
    applyWaivers: false,
    now: io.now ?? Date.now,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {})
  });

  if (isErr(current)) {
    io.stderr(formatError(current.error));
    return exitCodeForError(current.error);
  }

  const diff = diffRiskFindings({
    baselineFindings,
    currentFindings: current.value.riskFindings
  });

  const output = renderDiffReport({
    baselineRef: command.baselineRef,
    profile: command.profile,
    prodOnly: command.prodOnly,
    diff,
    json: command.json,
    markdown: command.markdown,
    lockfileChanges: buildDiffLockfileChanges({
      projectRoot: currentProject.value.project.rootDir,
      currentLockfiles: projectLockfiles(currentProject.value.project),
      baselineLockfiles: baselineProject.value.lockfiles
    }),
    ...(command.failOn ? { failOn: command.failOn } : {}),
    policy: summarizePolicyConfig(policy.value)
  });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (command.failOn && hasFindingAtOrAbove(diff.introducedFindings, command.failOn)) {
    return 1;
  }

  return 0;
}

async function runExplain(
  command: Extract<CliCommand, { kind: "explain" }>,
  io: CliIO
): Promise<number> {
  const workspaceRoot = resolveWorkspaceRootPath({
    cwd: io.cwd,
    workspaceRootPath: command.workspaceRootPath
  });
  if (isErr(workspaceRoot)) {
    io.stderr(formatError(workspaceRoot.error));
    return exitCodeForError(workspaceRoot.error);
  }

  const policy = readPolicyConfig({
    projectRoot: io.cwd,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
    ...(command.policyPath ? { policyPath: command.policyPath } : {})
  });
  if (isErr(policy)) {
    io.stderr(formatError(policy.error));
    return exitCodeForError(policy.error);
  }

  const normalizedLicense = normalizeLicenseEvidence({
    packageId: "input",
    packageJsonLicense: command.expression,
    files: [],
    source: "unavailable",
    warnings: []
  });
  const finding = evaluateLicenseRisk({
    license: normalizedLicense,
    dependency: {
      id: "input",
      name: "input",
      version: "0.0.0",
      ecosystem: "npm",
      dependencyType: "production",
      direct: true,
      paths: [["input"]]
    },
    profile: command.profile,
    policy: policy.value,
    includePackagePolicy: false
  });

  const output = renderExplainReport({
    expression: command.expression,
    profile: command.profile,
    normalizedLicense,
    finding,
    json: command.json,
    policy: summarizePolicyConfig(policy.value)
  });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  return 0;
}

async function runScan(
  command: Extract<CliCommand, { kind: "scan" | "ci" }>,
  io: CliIO
): Promise<number> {
  const repository = command.kind === "scan" ? command.repository : undefined;
  const reportProgress = command.outputPath ? createScanProgressReporter(io) : undefined;
  reportProgress?.(0, command.kind === "ci" ? "Starting CI scan..." : "Starting scan...");

  if (!repository) {
    return runScanAt({ command, io, scanCwd: io.cwd, reportProgress });
  }

  reportProgress?.(0, `Cloning ${repository.owner}/${repository.name}...`);
  const cloner = io.cloneRepository ?? cloneGitHubRepository;
  const submoduleMode = command.kind === "scan" ? command.submoduleMode ?? "ignore" : "ignore";
  const cloned = await cloner(repository, { submodules: submoduleMode });
  if (isErr(cloned)) {
    await closeScanProgressReporter(reportProgress, "failure");
    io.stderr(formatError(cloned.error));
    return exitCodeForError(cloned.error);
  }

  try {
    return await runScanAt({
      command,
      io,
      scanCwd: cloned.value.rootDir,
      configurationRoot: io.cwd,
      runtimeRoot: io.cwd,
      allowLocalProjectEvidence: false,
      reportProgress,
      temporaryRoot: cloned.value.rootDir,
      repository: {
        owner: repository.owner,
        name: repository.name,
        submodules: {
          mode: submoduleMode,
          skippedCount: cloned.value.submodules.total,
          skippedPaths: cloned.value.submodules.paths,
          pathsTruncated: cloned.value.submodules.pathsTruncated
        },
        symbolicLinks: {
          skippedCount: cloned.value.symbolicLinks.total,
          skippedPaths: cloned.value.symbolicLinks.paths,
          pathsTruncated: cloned.value.symbolicLinks.pathsTruncated
        },
        nonPortablePaths: {
          skippedCount: cloned.value.nonPortablePaths.total,
          skippedPaths: cloned.value.nonPortablePaths.paths,
          pathsTruncated: cloned.value.nonPortablePaths.pathsTruncated
        }
      }
    });
  } finally {
    cloned.value.cleanup();
  }
}

async function runScanAt(input: {
  command: Extract<CliCommand, { kind: "scan" | "ci" }>;
  io: CliIO;
  scanCwd: string;
  configurationRoot?: string;
  runtimeRoot?: string;
  allowLocalProjectEvidence?: boolean;
  reportProgress?: ScanProgressReporter;
  temporaryRoot?: string;
  repository?: RemoteRepositoryReportSource;
}): Promise<number> {
  const { command, io, reportProgress } = input;
  const now = io.now ?? Date.now;
  const workspaceRoot = resolveWorkspaceRootPath({
    cwd: io.cwd,
    workspaceRootPath: command.workspaceRootPath
  });
  if (isErr(workspaceRoot)) {
    io.stderr(formatError(workspaceRoot.error));
    return exitCodeForError(workspaceRoot.error);
  }

  const scanned = await scanProject({
    cwd: input.scanCwd,
    ...(input.configurationRoot ? { configurationRoot: input.configurationRoot } : {}),
    ...(input.runtimeRoot ? { runtimeRoot: input.runtimeRoot } : {}),
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : {}),
    ...(command.lockfilePath ? { lockfilePath: command.lockfilePath } : {}),
    ...(command.archivePath ? { archivePath: command.archivePath } : {}),
    ...(input.repository ? { projectSearchMode: "tree" as const } : {}),
    ...(input.repository ? { autoMergeSameRoot: true } : {}),
    ...(input.repository ? { autoMergeDescendantProjects: true } : {}),
    allLockfiles: command.allLockfiles ?? false,
    ...(command.policyPath ? { policyPath: command.policyPath } : {}),
    offline: command.offline ?? false,
    ...(command.cacheDir ? { cacheDir: command.cacheDir } : {}),
    ...(command.jobs !== undefined ? { jobs: command.jobs } : {}),
    ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
    ...(command.registryUrl ? { registryUrl: command.registryUrl } : {}),
    ...(command.registryTokenEnv ? { registryTokenEnv: command.registryTokenEnv } : {}),
    allowedHosts: command.allowedHosts ?? [],
    env: io.env ?? process.env,
    profile: command.profile,
    prodOnly: command.prodOnly,
    applyWaivers: !command.noWaivers,
    now,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
    ...(reportProgress ? { progress: reportProgress } : {})
  });

  if (isErr(scanned)) {
    await closeScanProgressReporter(reportProgress, "failure");
    const scanError = input.temporaryRoot
      ? redactTemporaryPath(scanned.error, input.temporaryRoot)
      : scanned.error;
    io.stderr(formatError(scanError));
    return exitCodeForError(scanError);
  }

  const reportInput: ScanReportInput = {
    project: scanned.value.project,
    graph: scanned.value.graph,
    evidence: scanned.value.evidence,
    normalizedLicenses: scanned.value.normalizedLicenses,
    riskFindings: scanned.value.riskFindings,
    profile: command.profile,
    prodOnly: command.prodOnly,
    json: command.json,
    markdown: command.markdown,
    html: command.html,
    ...(command.reportLanguage ? { reportLanguage: command.reportLanguage } : {}),
    waiverMode: command.noWaivers ? "ignored" : "local",
    ...(command.kind === "ci" && command.failOn ? { failOn: command.failOn } : {}),
    ...(command.kind === "ci" ? { strictWaivers: command.strictWaivers } : {}),
    waivedFindings: scanned.value.waivedFindings,
    expiredWaivers: scanned.value.expiredWaivers,
    unmatchedWaivers: scanned.value.unmatchedWaivers,
    policy: scanned.value.policy,
    ...(input.repository ? { repository: input.repository } : {})
  };

  reportProgress?.(SCAN_PROGRESS_RENDER_PERCENT, `Rendering ${reportFormatLabel(command)} report...`);
  const output = command.cyclonedx
    ? renderCycloneDxReport(reportInput)
    : command.sarif
      ? renderSarifReport(reportInput)
      : renderScanReport(reportInput);
  reportProgress?.(SCAN_PROGRESS_WRITE_PERCENT, "Writing report file...");
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io,
    suppressSuccessMessage: Boolean(reportProgress)
  });

  if (isErr(emitted)) {
    await closeScanProgressReporter(reportProgress, "failure");
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  reportProgress?.(SCAN_PROGRESS_READY_PERCENT, "Report ready.");
  await closeScanProgressReporter(reportProgress, "success");
  if (reportProgress && emitted.value) {
    io.stderr(`Wrote report to ${emitted.value}`);
  }

  if (command.openReport && emitted.value) {
    const opener = io.openReport ?? openReportFile;
    const opened = await opener({ reportPath: emitted.value });
    if (isErr(opened)) {
      io.stderr(formatReportOpenWarning(opened.error));
    } else {
      io.stderr(`Opened report: ${opened.value.target}`);
    }
  }

  if (command.kind === "ci" && hasFindingAtOrAbove(scanned.value.riskFindings, command.failOn)) {
    return 1;
  }

  if (command.kind === "ci" && command.strictWaivers && hasWaiverDrift(scanned.value)) {
    return 1;
  }

  return 0;
}

function hasWaiverDrift(input: {
  expiredWaivers: unknown[];
  unmatchedWaivers: unknown[];
}): boolean {
  return input.expiredWaivers.length > 0 || input.unmatchedWaivers.length > 0;
}

async function scanProject(input: {
  cwd: string;
  configurationRoot?: string;
  runtimeRoot?: string;
  allowLocalProjectEvidence?: boolean;
  lockfilePath?: string;
  archivePath?: string;
  projectSearchMode?: "ancestors" | "tree";
  autoMergeSameRoot?: boolean;
  autoMergeDescendantProjects?: boolean;
  allLockfiles: boolean;
  policyPath?: string;
  offline: boolean;
  cacheDir?: string;
  jobs?: number;
  timeoutMs?: number;
  registryUrl?: string;
  registryTokenEnv?: string;
  allowedHosts: string[];
  env: Record<string, string | undefined>;
  profile: Extract<CliCommand, { kind: "scan" | "ci" | "diff" }>["profile"];
  prodOnly: boolean;
  applyWaivers: boolean;
  now: ScanClock;
  workspaceRoot?: string;
  progress?: ScanProgressReporter;
}): Promise<Result<ScanResult, OhriskError>> {
  let project: ProjectInput;
  let scanGraph: DependencyGraph | undefined;
  if (input.archivePath) {
    const loaded = loadArchiveProjectGraph({
      cwd: input.cwd,
      archivePath: input.archivePath,
      allLockfiles: input.allLockfiles,
      prodOnly: input.prodOnly,
      now: input.now,
      ...(input.progress ? { progress: input.progress } : {})
    });
    if (isErr(loaded)) {
      return loaded;
    }
    project = loaded.value.project;
    scanGraph = loaded.value.scanGraph;
  } else {
    const discovered = discoverFilesystemProject({
      cwd: input.cwd,
      ...(input.lockfilePath ? { lockfilePath: input.lockfilePath } : {}),
      ...(input.projectSearchMode ? { projectSearchMode: input.projectSearchMode } : {}),
      ...(input.autoMergeSameRoot ? { autoMergeSameRoot: true } : {}),
      ...(input.autoMergeDescendantProjects ? { autoMergeDescendantProjects: true } : {}),
      allLockfiles: input.allLockfiles,
      ...(input.progress ? { progress: input.progress } : {})
    });
    if (isErr(discovered)) {
      return discovered;
    }
    project = discovered.value;
  }

  const policy = readPolicyConfig({
    projectRoot: input.configurationRoot
      ?? (project.source ? input.cwd : project.rootDir),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.policyPath ? { policyPath: input.policyPath } : {})
  });
  if (isErr(policy)) {
    return policy;
  }

  const evidenceRuntime = resolveEvidenceRuntimeOptions({
    cwd: input.runtimeRoot ?? input.cwd,
    projectRoot: project.rootDir,
    policy: policy.value,
    offline: input.offline,
    ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
    ...(input.jobs !== undefined ? { jobs: input.jobs } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.registryUrl ? { registryUrl: input.registryUrl } : {}),
    ...(input.registryTokenEnv ? { registryTokenEnv: input.registryTokenEnv } : {}),
    allowedHosts: input.allowedHosts,
    env: input.env
  });
  if (isErr(evidenceRuntime)) {
    return evidenceRuntime;
  }

  if (!scanGraph) {
    const graph = await parseProjectDependencyGraphWithRemoteMavenPoms({
      project,
      fetchRemotePoms: (requests) => fetchMavenCentralModelPoms({
        requests,
        offline: evidenceRuntime.value.offline,
        ...(evidenceRuntime.value.timeoutMs === undefined
          ? {}
          : { fetchTimeoutMs: evidenceRuntime.value.timeoutMs }),
        ...(evidenceRuntime.value.cacheDir === undefined
          ? {}
          : { cacheDir: evidenceRuntime.value.cacheDir })
      }),
      ...(input.progress
        ? {
            onFetch: (requests) => input.progress?.(
              SCAN_PROGRESS_READ_LOCKFILE_PERCENT,
              `Resolving ${requests.length} Maven parent/BOM POM${requests.length === 1 ? "" : "s"}...`
            )
          }
        : {})
    });
    if (isErr(graph)) {
      return graph;
    }
    scanGraph = filterGraphForProdOnly(graph.value, input.prodOnly);
  }

  return evaluateProjectScan({
    project,
    scanGraph,
    profile: input.profile,
    policy: policy.value,
    evidenceRuntime: evidenceRuntime.value,
    applyWaivers: input.applyWaivers,
    now: input.now,
    ...(input.configurationRoot
      ? { configurationRoot: input.configurationRoot }
      : project.source
        ? { configurationRoot: input.cwd }
        : {}),
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.progress ? { progress: input.progress } : {})
  });
}

function loadArchiveProjectGraph(input: {
  cwd: string;
  archivePath: string;
  allLockfiles: boolean;
  prodOnly: boolean;
  now: ScanClock;
  progress?: ScanProgressReporter;
}): Result<{
  project: ProjectInput;
  scanGraph: DependencyGraph;
}, OhriskError> {
  input.progress?.(SCAN_PROGRESS_DISCOVER_PERCENT, "Reading archive index...");
  const archive = readArchiveFile({
    cwd: input.cwd,
    archivePath: input.archivePath,
    now: input.now
  });
  if (isErr(archive)) {
    return archive;
  }

  input.progress?.(SCAN_PROGRESS_READ_LOCKFILE_PERCENT, "Reading archived lockfiles...");
  const loaded = loadArchiveProject({
    source: archive.value,
    allLockfiles: input.allLockfiles
  });
  if (isErr(loaded)) {
    return loaded;
  }

  return ok({
    project: loaded.value.project,
    scanGraph: filterGraphForProdOnly(loaded.value.graph, input.prodOnly)
  });
}

function loadProjectGraph(input: {
  cwd: string;
  lockfilePath?: string;
  projectSearchMode?: "ancestors" | "tree";
  autoMergeSameRoot?: boolean;
  autoMergeDescendantProjects?: boolean;
  allLockfiles?: boolean;
  prodOnly: boolean;
  progress?: ScanProgressReporter;
}): Result<{
  project: ProjectInput;
  scanGraph: DependencyGraph;
}, OhriskError> {
  const discovered = discoverFilesystemProject(input);
  if (isErr(discovered)) {
    return discovered;
  }
  const graph = parseProjectDependencyGraph(discovered.value);

  if (isErr(graph)) {
    return graph;
  }

  const scanGraph = filterGraphForProdOnly(graph.value, input.prodOnly);

  return ok({
    project: discovered.value,
    scanGraph
  });
}

function discoverFilesystemProject(input: {
  cwd: string;
  lockfilePath?: string;
  projectSearchMode?: "ancestors" | "tree";
  autoMergeSameRoot?: boolean;
  autoMergeDescendantProjects?: boolean;
  allLockfiles?: boolean;
  progress?: ScanProgressReporter;
}): Result<ProjectInput, OhriskError> {
  input.progress?.(SCAN_PROGRESS_DISCOVER_PERCENT, "Discovering project...");
  const discovered = discoverProject({
    cwd: input.cwd,
    ...(input.lockfilePath ? { lockfilePath: input.lockfilePath } : {}),
    ...(input.projectSearchMode ? { searchMode: input.projectSearchMode } : {}),
    ...(input.autoMergeSameRoot ? { autoMergeSameRoot: true } : {}),
    ...(input.autoMergeDescendantProjects ? { autoMergeDescendantProjects: true } : {}),
    ...(input.allLockfiles ? { allLockfiles: true } : {})
  });

  if (isErr(discovered)) {
    return discovered;
  }

  const lockfileCount = discovered.value.lockfiles?.length ?? 1;
  input.progress?.(
    SCAN_PROGRESS_READ_LOCKFILE_PERCENT,
    lockfileCount > 1
      ? `Reading ${lockfileCount} lockfiles...`
      : `Reading ${path.basename(discovered.value.lockfile.path)}...`
  );
  return discovered;
}

async function evaluateProjectScan(input: {
  project: ProjectInput;
  scanGraph: DependencyGraph;
  configurationRoot?: string;
  allowLocalProjectEvidence?: boolean;
  profile: Extract<CliCommand, { kind: "scan" | "ci" | "diff" }>["profile"];
  policy: ResolvedPolicyConfig;
  evidenceRuntime: EvidenceRuntimeOptions;
  applyWaivers: boolean;
  now: ScanClock;
  workspaceRoot?: string;
  progress?: ScanProgressReporter;
}): Promise<Result<ScanResult, OhriskError>> {
  const evidenceProgress = input.progress
    ? createEvidenceProgressReporter({
        progress: input.progress,
        now: input.now
      })
    : undefined;

  input.progress?.(
    SCAN_PROGRESS_EVIDENCE_START_PERCENT,
    `Collecting license evidence for ${input.scanGraph.nodes.length} packages...`
  );
  const evidence = await collectEvidenceForGraph({
    graph: input.scanGraph,
    projectRoot: input.project.rootDir,
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : input.project.source
        ? { allowLocalProjectEvidence: false }
        : {}),
    evidenceRuntime: input.evidenceRuntime,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(evidenceProgress ? { progress: evidenceProgress } : {})
  });

  if (isErr(evidence)) {
    return evidence;
  }

  input.progress?.(SCAN_PROGRESS_EVALUATE_PERCENT, "Evaluating license risk...");
  const normalizedLicenses = normalizeAllLicenseEvidence(evidence.value);
  const riskFindings = evaluateLicenseRisks({
    licenses: normalizedLicenses,
    dependencies: input.scanGraph.nodes,
    profile: input.profile,
    policy: input.policy
  });
  if (!input.applyWaivers) {
    return ok({
      project: input.project,
      graph: input.scanGraph,
      evidence: evidence.value,
      normalizedLicenses,
      riskFindings,
      waivedFindings: [],
      expiredWaivers: [],
      unmatchedWaivers: [],
      policy: summarizePolicyConfig(input.policy)
    });
  }

  const waivers = readRiskWaivers(input.configurationRoot ?? input.project.rootDir);

  if (isErr(waivers)) {
    return waivers;
  }

  const appliedWaivers = applyRiskWaivers({
    findings: riskFindings,
    waivers: waivers.value
  });

  return ok({
    project: input.project,
    graph: input.scanGraph,
    evidence: evidence.value,
    normalizedLicenses,
    riskFindings: appliedWaivers.activeFindings,
    waivedFindings: appliedWaivers.waivedFindings,
    expiredWaivers: appliedWaivers.expiredWaivers,
    unmatchedWaivers: appliedWaivers.unmatchedWaivers,
    policy: summarizePolicyConfig(input.policy)
  });
}

function filterGraphForProdOnly(graph: DependencyGraph, prodOnly: boolean): DependencyGraph {
  if (!prodOnly) {
    return graph;
  }

  const productionNodeIds = new Set(
    graph.nodes
      .filter(isProductionRelevantDependency)
      .map((node) => node.id)
  );
  const dependencyPathSegments = dependencyPathSegmentSets(graph.nodes, productionNodeIds);
  const nodes = graph.nodes
    .filter((node) => productionNodeIds.has(node.id))
    .map((node) => {
      const paths = node.paths.filter((dependencyPath) =>
        isProductionRelevantPath(dependencyPath, dependencyPathSegments)
      );

      return {
        ...node,
        direct: paths.some((dependencyPath) =>
          isDirectDependencyPath(dependencyPath, dependencyPathSegments.all)
        ),
        paths
      };
    })
    .filter((node) => node.paths.length > 0);
  const nodeIds = new Set(nodes.map((node) => node.id));

  const embeddedEvidence = graph.embeddedEvidence?.filter((evidence) =>
    nodeIds.has(evidence.packageId)
  );
  return {
    ...graph,
    nodes,
    ...(embeddedEvidence ? { embeddedEvidence } : {})
  };
}

async function collectEvidenceForGraph(input: {
  graph: DependencyGraph;
  projectRoot: string;
  allowLocalProjectEvidence?: boolean;
  workspaceRoot?: string;
  evidenceRuntime: EvidenceRuntimeOptions;
  progress?: (progress: EvidenceCollectionProgress) => void;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const embeddedEvidence = input.graph.embeddedEvidence ?? [];
  const embeddedEvidenceIds = new Set(embeddedEvidence.map((evidence) => evidence.packageId));
  const graphNodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const relevantEmbeddedEvidence = embeddedEvidence.filter((evidence) =>
    graphNodeIds.has(evidence.packageId)
  );
  const totalEvidenceCount = input.graph.nodes.length;
  let completedEvidenceCount = 0;
  const collectionGraph = embeddedEvidenceIds.size === 0
    ? input.graph
    : {
        ...input.graph,
        nodes: input.graph.nodes.filter((node) => !embeddedEvidenceIds.has(node.id)),
        embeddedEvidence: []
      };

  for (const evidence of relevantEmbeddedEvidence) {
    completedEvidenceCount += 1;
    input.progress?.({
      completed: completedEvidenceCount,
      total: totalEvidenceCount,
      packageId: evidence.packageId,
      concurrency: 1
    });
  }

  const collected = await collectGraphEvidence({
    graph: collectionGraph,
    projectRoot: input.projectRoot,
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : {}),
    offline: input.evidenceRuntime.offline,
    cacheDir: input.evidenceRuntime.cacheDir,
    ...(input.evidenceRuntime.jobs !== undefined
      ? { evidenceConcurrency: input.evidenceRuntime.jobs }
      : {}),
    ...(input.evidenceRuntime.timeoutMs !== undefined
      ? { fetchTimeoutMs: input.evidenceRuntime.timeoutMs }
      : {}),
    ...(input.evidenceRuntime.npmRegistryUrl
      ? { npmRegistryUrl: input.evidenceRuntime.npmRegistryUrl }
      : {}),
    registryAuthTokens: input.evidenceRuntime.registryAuthTokens,
    allowedArtifactHosts: input.evidenceRuntime.allowedArtifactHosts,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.progress
      ? {
          progress: (progress) => {
            input.progress?.({
              completed: completedEvidenceCount + progress.completed,
              total: totalEvidenceCount,
              packageId: progress.packageId,
              concurrency: progress.concurrency
            });
          }
        }
      : {})
  });

  if (isErr(collected)) {
    return collected;
  }

  return ok([...relevantEmbeddedEvidence, ...collected.value]);
}

function resolveEvidenceRuntimeOptions(input: {
  cwd: string;
  projectRoot: string;
  policy: ResolvedPolicyConfig;
  offline: boolean;
  cacheDir?: string;
  jobs?: number;
  timeoutMs?: number;
  registryUrl?: string;
  registryTokenEnv?: string;
  allowedHosts: string[];
  env: Record<string, string | undefined>;
}): Result<EvidenceRuntimeOptions, OhriskError> {
  const npmRegistryUrl = input.registryUrl ?? input.policy.npmRegistryUrl;
  const allowedArtifactHosts = new Set<string>(input.policy.allowedRegistryHosts);

  for (const host of input.allowedHosts) {
    const normalizedHost = normalizeRegistryHostname(host);
    if (!normalizedHost) {
      return err(invalidRuntimeOption("Allowed artifact host is invalid.", {
        host
      }));
    }
    allowedArtifactHosts.add(normalizedHost);
  }

  const registryHost = npmRegistryUrl
    ? registryHostname(npmRegistryUrl)
    : "registry.npmjs.org";
  if (!registryHost) {
    return err(invalidRuntimeOption("npm registry URL is invalid.", {
      registryUrl: safeRegistryUrl(npmRegistryUrl)
    }));
  }
  if (npmRegistryUrl) {
    allowedArtifactHosts.add(registryHost);
  }

  const registryAuthTokens = new Map<string, string>();
  if (!input.offline) {
    for (const [host, auth] of input.policy.registryAuth) {
      const token = input.env[auth.tokenEnv]?.trim();
      if (!token) {
        return err(invalidRuntimeOption(
          "A registry authentication environment variable required by the policy is missing or empty.",
          { host, tokenEnv: auth.tokenEnv }
        ));
      }
      registryAuthTokens.set(host, token);
    }

    if (input.registryTokenEnv) {
      const token = input.env[input.registryTokenEnv]?.trim();
      if (!token) {
        return err(invalidRuntimeOption(
          "The registry authentication environment variable is missing or empty.",
          { host: registryHost, tokenEnv: input.registryTokenEnv }
        ));
      }
      registryAuthTokens.set(registryHost, token);
    }
  }

  const configuredCacheDir = input.cacheDir ?? input.env.OHRISK_CACHE_DIR;
  const cacheDir = configuredCacheDir
    ? path.resolve(input.cwd, configuredCacheDir)
    : defaultArtifactCacheDirectory(input.env);

  return ok({
    offline: input.offline,
    cacheDir,
    registryAuthTokens,
    allowedArtifactHosts,
    ...(input.jobs !== undefined ? { jobs: input.jobs } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(npmRegistryUrl ? { npmRegistryUrl } : {})
  });
}

function normalizeRegistryHostname(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.includes("/") || trimmed.includes("@")) {
    return undefined;
  }

  try {
    const url = new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase() === trimmed
      && isIP(trimmed) === 0
      && trimmed !== "localhost"
      && !trimmed.endsWith(".localhost")
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
}

function registryHostname(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && isIP(host) === 0
      && host !== "localhost"
      && !host.endsWith(".localhost")
      ? host
      : undefined;
  } catch {
    return undefined;
  }
}

function safeRegistryUrl(value: string | undefined): string {
  if (!value) {
    return "<default>";
  }
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<invalid>";
  }
}

function invalidRuntimeOption(
  message: string,
  details: Record<string, unknown>
): OhriskError {
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message,
    details
  });
}

function createEvidenceProgressReporter(input: {
  progress: ScanProgressReporter;
  now: ScanClock;
}): (progress: EvidenceCollectionProgress) => void {
  const startedAtMs = input.now();

  return (progress) => {
    const completed = clampCount(progress.completed, progress.total);
    const total = Math.max(0, progress.total);
    const elapsedMs = Math.max(0, input.now() - startedAtMs);
    const averageMs = completed > 0 ? elapsedMs / completed : 0;
    const concurrency = Math.max(1, Math.trunc(progress.concurrency));
    const etaMs = (averageMs * Math.max(0, total - completed)) / concurrency;
    const eta = formatEvidenceProgressEta({
      completed,
      total,
      etaMs
    });

    input.progress(
      evidenceCollectionPercent({
        completed,
        total
      }),
      [
        `Collecting license evidence ${completed}/${total}: ${formatProgressPackageId(progress.packageId)}`,
        `(elapsed ${formatDuration(elapsedMs)}, eta ${eta}, avg ${formatDuration(averageMs)}/pkg)`
      ].join(" ")
    );
  };
}

function evidenceCollectionPercent(
  progress: Pick<EvidenceCollectionProgress, "completed" | "total">
): number {
  const fraction = progress.total <= 0
    ? 1
    : Math.min(1, Math.max(0, progress.completed / progress.total));

  return SCAN_PROGRESS_EVIDENCE_START_PERCENT
    + ((SCAN_PROGRESS_EVIDENCE_END_PERCENT - SCAN_PROGRESS_EVIDENCE_START_PERCENT) * fraction);
}

function clampCount(value: number, total: number): number {
  return Math.min(Math.max(0, total), Math.max(0, value));
}

function formatProgressPackageId(packageId: string): string {
  return packageId.replace(/[\r\n]+/g, " ").trim() || "(unknown package)";
}

function formatEvidenceProgressEta(input: {
  completed: number;
  total: number;
  etaMs: number;
}): string {
  if (input.completed >= input.total || input.total <= SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE) {
    return formatDuration(input.etaMs);
  }

  return input.completed >= SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE
    ? formatDuration(input.etaMs)
    : "calculating";
}

function formatDuration(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  if (safeMilliseconds < 1_000) {
    return `${safeMilliseconds}ms`;
  }

  const seconds = Math.round(safeMilliseconds / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function isProductionRelevantDependency(node: DependencyNode): boolean {
  return node.dependencyType !== "development";
}

function dependencyPathSegmentSets(
  nodes: DependencyNode[],
  productionNodeIds: Set<string>
): {
  all: Set<string>;
  production: Set<string>;
} {
  const all = new Set<string>();
  const production = new Set<string>();

  for (const node of nodes) {
    all.add(node.id);
    if (productionNodeIds.has(node.id)) {
      production.add(node.id);
    }
    for (const installName of node.installNames ?? []) {
      const segment = `${installName} -> ${node.id}`;
      all.add(segment);
      if (productionNodeIds.has(node.id)) {
        production.add(segment);
      }
    }
  }

  return { all, production };
}

function isProductionRelevantPath(
  pathSegments: string[],
  dependencyPathSegments: { all: Set<string>; production: Set<string> }
): boolean {
  return pathSegments.slice(1).every((segment) =>
    !dependencyPathSegments.all.has(segment)
    || dependencyPathSegments.production.has(segment)
  );
}

function isDirectDependencyPath(pathSegments: string[], dependencyPathSegments: Set<string>): boolean {
  return pathSegments.slice(1).filter((segment) => dependencyPathSegments.has(segment)).length <= 1;
}

function readBaselineGoWorkModuleInputs(input: {
  project: ProjectInput;
  baselineRef: string;
  goWorkText: string;
  readRefFile: GitRefFileReader;
}): Result<GoWorkModuleInput[] | undefined, OhriskError> {
  const modulePaths = findGoWorkModulePaths({
    goWorkText: input.goWorkText,
    goWorkPath: input.project.lockfile.path,
    projectRoot: input.project.rootDir
  });
  if (isErr(modulePaths)) {
    return modulePaths;
  }

  const modules: GoWorkModuleInput[] = [];
  for (const modulePath of modulePaths.value) {
    const goModText = input.readRefFile({
      projectRoot: input.project.rootDir,
      ref: input.baselineRef,
      relativePath: modulePath.goModRelativePath
    });
    if (isErr(goModText)) {
      return goModText;
    }

    const goSumText = readOptionalBaselineFile({
      projectRoot: input.project.rootDir,
      baselineRef: input.baselineRef,
      relativePath: modulePath.goSumRelativePath,
      readRefFile: input.readRefFile
    });
    if (isErr(goSumText)) {
      return goSumText;
    }

    modules.push({
      usePath: modulePath.usePath,
      moduleRootDir: modulePath.moduleRootDir,
      goModPath: `${input.baselineRef}:${modulePath.goModRelativePath}`,
      goModText: goModText.value,
      ...(goSumText.value ? { goSumText: goSumText.value } : {})
    });
  }

  return ok(modules);
}

type BaselineProjectGraph = {
  graph: DependencyGraph;
  lockfiles: ProjectLockfile[];
};

function loadBaselineProjectGraph(input: {
  currentProject: {
    project: ProjectInput;
    scanGraph: DependencyGraph;
  };
  baselineRef: string;
  allLockfiles: boolean;
  readRefFile: GitRefFileReader;
  listRefFiles: GitRefFileLister;
}): Result<BaselineProjectGraph, OhriskError> {
  const projectRoot = input.currentProject.project.rootDir;
  let baselineRelativePaths: string[] | undefined;
  let baselineLockfiles: ProjectLockfile[];

  if (input.allLockfiles) {
    const listed = input.listRefFiles({
      projectRoot,
      ref: input.baselineRef
    });
    if (isErr(listed)) {
      return listed;
    }

    baselineRelativePaths = listed.value;
    baselineLockfiles = projectLockfilesFromRelativePaths({
      rootDir: projectRoot,
      relativePaths: listed.value
    });

    if (baselineLockfiles.length === 0 && listed.value.includes("package.json")) {
      baselineLockfiles = [{
        kind: "package-json",
        path: path.join(projectRoot, "package.json")
      }];
    }
  } else {
    baselineLockfiles = [input.currentProject.project.lockfile];
  }

  if (baselineLockfiles.length === 0) {
    return ok({
      graph: {
        rootName: path.basename(projectRoot),
        lockfilePath: `${input.baselineRef}:<none>`,
        lockfilePaths: [],
        nodes: []
      },
      lockfiles: []
    });
  }

  const baselineFiles = baselineRelativePaths
    ? new Set(baselineRelativePaths.map((value) => value.replace(/\\/g, "/")))
    : undefined;
  const graphs: SourcedDependencyGraph[] = [];

  for (const lockfile of baselineLockfiles) {
    const parsed = parseBaselineLockfileGraph({
      projectRoot,
      lockfile,
      baselineRef: input.baselineRef,
      readRefFile: input.readRefFile,
      rootNameHint: input.currentProject.scanGraph.rootName ?? path.basename(projectRoot),
      ...(baselineFiles ? { baselineFiles } : {})
    });
    if (isErr(parsed)) {
      return parsed;
    }

    graphs.push({
      graph: parsed.value,
      source: {
        lockfileKind: lockfile.kind,
        lockfilePath: projectRelativeLockfilePath(projectRoot, lockfile.path)
      }
    });
  }

  return ok({
    graph: graphs.length === 1
      ? graphs[0]!.graph
      : mergeDependencyGraphs(graphs),
    lockfiles: baselineLockfiles
  });
}

function parseBaselineLockfileGraph(input: {
  projectRoot: string;
  lockfile: ProjectLockfile;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  rootNameHint: string;
  baselineFiles?: ReadonlySet<string>;
}): Result<DependencyGraph, OhriskError> {
  const relativeLockfilePath = projectRelativeLockfilePath(
    input.projectRoot,
    input.lockfile.path
  );
  const project: ProjectInput = {
    rootDir: input.projectRoot,
    lockfile: input.lockfile
  };
  const baselineLockfile = readBaselinePrimaryLockfile({
    projectRoot: input.projectRoot,
    lockfilePath: input.lockfile.path,
    ref: input.baselineRef,
    relativePath: relativeLockfilePath,
    readRefFile: input.readRefFile,
    ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
  });
  if (isErr(baselineLockfile)) {
    return baselineLockfile;
  }

  const lockfileDirectory = path.posix.dirname(relativeLockfilePath);
  const relativeCompanionPath = (filename: string): string =>
    lockfileDirectory === "." ? filename : `${lockfileDirectory}/${filename}`;
  const packageJsonRelativePath = relativeCompanionPath("package.json");
  const baselinePackageJson = input.lockfile.kind === "yarn-lock"
    ? input.readRefFile({
        projectRoot: input.projectRoot,
        ref: input.baselineRef,
        relativePath: packageJsonRelativePath
      })
    : undefined;
  if (baselinePackageJson && isErr(baselinePackageJson)) {
    return baselinePackageJson;
  }

  const baselineWorkspacePackageJsons = baselinePackageJson && !isErr(baselinePackageJson)
    ? readBaselineYarnWorkspacePackageJsons({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        rootPackageJsonText: baselinePackageJson.value,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok([]);
  if (isErr(baselineWorkspacePackageJsons)) {
    return baselineWorkspacePackageJsons;
  }

  const pnpmWorkspaceRelativePath = relativeCompanionPath("pnpm-workspace.yaml");
  const baselinePnpmWorkspace = input.lockfile.kind === "pnpm-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: pnpmWorkspaceRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselinePnpmWorkspace)) {
    return baselinePnpmWorkspace;
  }

  const pyprojectRelativePath = relativeCompanionPath("pyproject.toml");
  const baselinePyproject = (
    input.lockfile.kind === "pdm-lock"
    || input.lockfile.kind === "poetry-lock"
  )
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: pyprojectRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselinePyproject)) {
    return baselinePyproject;
  }

  const cargoManifestRelativePath = relativeCompanionPath("Cargo.toml");
  const baselineCargoManifest = input.lockfile.kind === "cargo-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: cargoManifestRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineCargoManifest)) {
    return baselineCargoManifest;
  }

  const baselineCargoMemberManifests = input.lockfile.kind === "cargo-lock"
    && baselineCargoManifest.value
    ? readBaselineCargoMemberManifests({
        project,
        baselineRef: input.baselineRef,
        rootManifestText: baselineCargoManifest.value,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok(undefined);
  if (isErr(baselineCargoMemberManifests)) {
    return baselineCargoMemberManifests;
  }

  const goSumRelativePath = relativeCompanionPath("go.sum");
  const baselineGoSum = input.lockfile.kind === "go-mod"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: goSumRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineGoSum)) {
    return baselineGoSum;
  }

  const baselineGoWorkModules = input.lockfile.kind === "go-work"
    ? readBaselineGoWorkModuleInputs({
        project,
        baselineRef: input.baselineRef,
        goWorkText: baselineLockfile.value,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineGoWorkModules)) {
    return baselineGoWorkModules;
  }

  const composerJsonRelativePath = relativeCompanionPath("composer.json");
  const baselineComposerJson = input.lockfile.kind === "composer-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: composerJsonRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineComposerJson)) {
    return baselineComposerJson;
  }

  const baselineDirectoryPackagesProps = input.lockfile.kind === "dotnet-project"
    ? readBaselineDirectoryPackagesProps({
        project,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok(undefined);
  if (isErr(baselineDirectoryPackagesProps)) {
    return baselineDirectoryPackagesProps;
  }

  const baselinePythonLocalSourceErrors = baselinePythonLocalSourceErrorsForKind(
    input.lockfile.kind
  );
  const baselineRequirementsReader = input.lockfile.kind === "requirements-txt"
    ? createBaselineRequirementsIncludedFileReader({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile
      })
    : undefined;
  const baselinePythonSourceReader = baselinePythonLocalSourceErrors
    ? createBaselinePythonLocalSourceFileReader({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile,
        errors: baselinePythonLocalSourceErrors
      })
    : undefined;

  return parseLockfileTextForKind({
    kind: input.lockfile.kind,
    text: baselineLockfile.value,
    lockfilePath: baselineLockfilePathForKind({
      kind: input.lockfile.kind,
      rootName: input.rootNameHint,
      relativeLockfilePath,
      baselineRef: input.baselineRef
    }),
    ...(baselinePackageJson?.value ? { packageJsonText: baselinePackageJson.value } : {}),
    packageJsonPath: `${input.baselineRef}:${packageJsonRelativePath}`,
    ...(baselineWorkspacePackageJsons.value.length > 0
      ? { workspacePackageJsonTexts: baselineWorkspacePackageJsons.value }
      : {}),
    ...(baselinePnpmWorkspace.value ? { pnpmWorkspaceText: baselinePnpmWorkspace.value } : {}),
    pnpmWorkspacePath: `${input.baselineRef}:${pnpmWorkspaceRelativePath}`,
    ...(baselinePyproject.value ? { pyprojectText: baselinePyproject.value } : {}),
    ...(baselineCargoManifest.value ? { cargoManifestText: baselineCargoManifest.value } : {}),
    ...(baselineCargoMemberManifests.value?.length
      ? { cargoMemberManifestTexts: baselineCargoMemberManifests.value }
      : {}),
    ...(input.lockfile.kind === "cargo-lock"
      ? { cargoRootName: input.rootNameHint }
      : {}),
    ...(baselineGoSum.value ? { goSumText: baselineGoSum.value } : {}),
    ...(baselineGoWorkModules.value?.length
      ? { goWorkModuleInputs: baselineGoWorkModules.value }
      : {}),
    goWorkDir: path.dirname(input.lockfile.path),
    ...(baselineComposerJson.value ? { composerJsonText: baselineComposerJson.value } : {}),
    ...(baselineDirectoryPackagesProps.value?.text
      ? { directoryPackagesPropsText: baselineDirectoryPackagesProps.value.text }
      : {}),
    ...(baselineDirectoryPackagesProps.value?.path
      ? { directoryPackagesPropsPath: baselineDirectoryPackagesProps.value.path }
      : {}),
    ...(input.lockfile.kind === "dotnet-project"
      ? { dotnetProjectRootName: input.rootNameHint }
      : {}),
    projectRoot: input.projectRoot,
    requirementsRootName: input.rootNameHint,
    ...(baselineRequirementsReader
      ? { requirementsIncludedFileReader: baselineRequirementsReader }
      : {}),
    ...(baselinePythonSourceReader
      ? { pythonLocalSourceFileReader: baselinePythonSourceReader }
      : {})
  });
}

function buildDiffLockfileChanges(input: {
  projectRoot: string;
  currentLockfiles: ProjectLockfile[];
  baselineLockfiles: ProjectLockfile[];
}): DiffLockfileChanges {
  const current = normalizeDiffLockfiles(input.projectRoot, input.currentLockfiles);
  const baseline = normalizeDiffLockfiles(input.projectRoot, input.baselineLockfiles);
  const currentKeys = new Set(current.map(diffLockfileKey));
  const baselineKeys = new Set(baseline.map(diffLockfileKey));

  return {
    current,
    baseline,
    added: current.filter((lockfile) => !baselineKeys.has(diffLockfileKey(lockfile))),
    removed: baseline.filter((lockfile) => !currentKeys.has(diffLockfileKey(lockfile)))
  };
}

function normalizeDiffLockfiles(
  projectRoot: string,
  lockfiles: ProjectLockfile[]
): DiffLockfileChanges["current"] {
  const byKey = new Map<string, DiffLockfileChanges["current"][number]>();
  for (const lockfile of lockfiles) {
    const normalized = {
      kind: lockfile.kind,
      path: projectRelativeLockfilePath(projectRoot, lockfile.path)
    };
    byKey.set(diffLockfileKey(normalized), normalized);
  }
  return [...byKey.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
  );
}

function diffLockfileKey(lockfile: DiffLockfileChanges["current"][number]): string {
  return `${lockfile.kind}\0${lockfile.path}`;
}

function projectRelativeLockfilePath(projectRoot: string, lockfilePath: string): string {
  const relativePath = path.relative(projectRoot, lockfilePath).replace(/\\/g, "/");
  return relativePath === "" ? path.basename(lockfilePath) : relativePath;
}


function readBaselinePrimaryLockfile(input: {
  projectRoot: string;
  lockfilePath: string;
  ref: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<string, OhriskError> {
  if (isGradleDependencyLocksDirectory(input.lockfilePath)) {
    return readBaselineGradleDependencyLocksDirectory(input);
  }

  return input.readRefFile({
    projectRoot: input.projectRoot,
    ref: input.ref,
    relativePath: input.relativePath
  });
}

function readBaselineGradleDependencyLocksDirectory(input: {
  projectRoot: string;
  lockfilePath: string;
  ref: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<string, OhriskError> {
  let entries: string[];
  try {
    if (input.baselineFiles) {
      const normalizedDirectory = input.relativePath.replace(/\\/g, "/").replace(/\/$/, "");
      const prefix = `${normalizedDirectory}/`;
      entries = [...input.baselineFiles]
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length))
        .filter((entry) => !entry.includes("/") && entry.toLowerCase().endsWith(".lockfile"))
        .sort();
    } else {
      entries = readdirSync(input.lockfilePath)
        .filter((entry) => entry.toLowerCase().endsWith(".lockfile"))
        .filter((entry) => isFile(path.join(input.lockfilePath, entry)))
        .sort();
    }
  } catch (cause) {
    return err(createError({
      code: "GRADLE_LOCK_READ_FAILED",
      category: "filesystem",
      message: "Failed to read Gradle dependency locks directory.",
      details: {
        lockfilePath: input.lockfilePath,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }

  const texts: string[] = [];
  let firstMissingFile: OhriskError | undefined;
  for (const entry of entries) {
    const result = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.ref,
      relativePath: `${input.relativePath.replace(/\\/g, "/").replace(/\/$/, "")}/${entry}`
    });

    if (isErr(result)) {
      if (result.error.code === "GIT_REF_FILE_NOT_FOUND") {
        firstMissingFile ??= result.error;
        continue;
      }

      return result;
    }

    texts.push(result.value);
  }

  if (texts.length === 0) {
    return firstMissingFile
      ? err(firstMissingFile)
      : err(createError({
          code: "GRADLE_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse Gradle dependency locks directory. Ohrisk expected at least one *.lockfile.",
          details: {
            lockfilePath: input.lockfilePath,
            reason: "no_lockfiles"
          }
        }));
  }

  return ok(texts.join("\n"));
}

function baselineLockfilePathForKind(input: {
  kind: ProjectInput["lockfile"]["kind"];
  rootName: string;
  relativeLockfilePath: string;
  baselineRef: string;
}): string {
  return input.kind === "gradle-lock"
    ? path.join(input.rootName, input.relativeLockfilePath)
    : `${input.baselineRef}:${input.relativeLockfilePath}`;
}

function readBaselineCargoMemberManifests(input: {
  project: ProjectInput;
  baselineRef: string;
  rootManifestText: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<string[] | undefined, OhriskError> {
  const memberManifestPaths = input.baselineFiles
    ? findCargoWorkspaceMemberManifestPathsFromRelativePaths({
        rootManifestText: input.rootManifestText,
        lockfilePath: input.project.lockfile.path,
        projectRoot: input.project.rootDir,
        relativePaths: input.baselineFiles
      })
    : findCargoWorkspaceMemberManifestPaths({
        rootManifestText: input.rootManifestText,
        lockfilePath: input.project.lockfile.path,
        projectRoot: input.project.rootDir
      });
  const manifestTexts: string[] = [];

  for (const memberManifestPath of memberManifestPaths) {
    const manifestText = readOptionalBaselineFile({
      projectRoot: input.project.rootDir,
      baselineRef: input.baselineRef,
      relativePath: memberManifestPath.relativeManifestPath,
      readRefFile: input.readRefFile
    });
    if (isErr(manifestText)) {
      return manifestText;
    }

    if (manifestText.value !== undefined) {
      manifestTexts.push(manifestText.value);
    }
  }

  return ok(manifestTexts);
}

function readBaselineYarnWorkspacePackageJsons(input: {
  projectRoot: string;
  baselineRef: string;
  rootPackageJsonText: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<YarnWorkspacePackageJsonInput[], OhriskError> {
  const rootPackageJson = tryParseObject(input.rootPackageJsonText);
  if (!rootPackageJson) {
    return ok([]);
  }

  const packageJsons: YarnWorkspacePackageJsonInput[] = [];
  const workspacePackageJsonPaths = input.baselineFiles
    ? findYarnWorkspacePackageJsonPathsFromRelativePaths({
        projectRoot: input.projectRoot,
        workspaces: rootPackageJson.workspaces,
        relativePaths: input.baselineFiles
      })
    : findYarnWorkspacePackageJsonPaths({
        projectRoot: input.projectRoot,
        workspaces: rootPackageJson.workspaces
      });
  for (const workspacePackageJsonPath of workspacePackageJsonPaths) {
    const baselinePackageJson = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.baselineRef,
      relativePath: workspacePackageJsonPath.relativePackageJsonPath
    });
    if (isErr(baselinePackageJson)) {
      if (baselinePackageJson.error.code === "GIT_REF_FILE_NOT_FOUND") {
        continue;
      }

      return baselinePackageJson;
    }

    packageJsons.push({
      packageJsonText: baselinePackageJson.value,
      packageJsonPath: `${input.baselineRef}:${workspacePackageJsonPath.relativePackageJsonPath}`,
      workspacePath: workspacePackageJsonPath.workspacePath
    });
  }

  return ok(packageJsons);
}

function createBaselineRequirementsIncludedFileReader(input: {
  projectRoot: string;
  baselineRef: string;
  readRefFile: GitRefFileReader;
}): RequirementsIncludedFileReader {
  return ({ includePath, fromFilePath, directive }) => {
    if (path.isAbsolute(includePath)) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Absolute nested requirement or constraint paths are not supported.",
          details: {
            lockfilePath: fromFilePath,
            includePath,
            directive
          }
        })
      );
    }

    const fromRelativePath = stripBaselineRefPrefix(fromFilePath, input.baselineRef);
    const includedRelativePath = normalizeBaselineRelativePath(
      path.join(path.dirname(fromRelativePath), includePath)
    );

    if (!includedRelativePath) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Nested requirement or constraint paths must stay inside the requirements root.",
          details: {
            lockfilePath: fromFilePath,
            includePath,
            directive
          }
        })
      );
    }

    const included = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.baselineRef,
      relativePath: includedRelativePath
    });

    if (isErr(included)) {
      return err(included.error);
    }

    return ok({
      path: `${input.baselineRef}:${includedRelativePath}`,
      text: included.value
    });
  };
}

type BaselinePythonLocalSourceErrors = {
  parseCode: OhriskError["code"];
  displayName: string;
};

function baselinePythonLocalSourceErrorsForKind(
  kind: ProjectInput["lockfile"]["kind"]
): BaselinePythonLocalSourceErrors | undefined {
  switch (kind) {
    case "requirements-txt":
      return {
        parseCode: "REQUIREMENTS_PARSE_FAILED",
        displayName: "requirements.txt"
      };
    case "pipfile-lock":
      return {
        parseCode: "PIPFILE_LOCK_PARSE_FAILED",
        displayName: "Pipfile.lock"
      };
    case "pdm-lock":
      return {
        parseCode: "PDM_LOCK_PARSE_FAILED",
        displayName: "pdm.lock"
      };
    case "uv-lock":
      return {
        parseCode: "UV_LOCK_PARSE_FAILED",
        displayName: "uv.lock"
      };
    case "pylock":
      return {
        parseCode: "PYLOCK_PARSE_FAILED",
        displayName: "pylock.toml"
      };
    default:
      return undefined;
  }
}

function createBaselinePythonLocalSourceFileReader(input: {
  projectRoot: string;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  errors: BaselinePythonLocalSourceErrors;
}): PythonLocalSourceFileReader {
  return ({ sourcePath, relativeFilePath, fromFilePath }) => {
    if (path.isAbsolute(sourcePath)) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Absolute local source paths are not supported.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    const fromRelativePath = stripBaselineRefPrefix(fromFilePath, input.baselineRef);
    const sourceRelativePath = normalizeBaselineRelativePath(
      path.join(path.dirname(fromRelativePath), sourcePath)
    );

    if (!sourceRelativePath) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Local source paths must stay inside the project root.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    const sourceFileRelativePath = normalizeBaselineRelativePath(
      path.join(sourceRelativePath, relativeFilePath)
    );

    if (!sourceFileRelativePath) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Local source evidence paths must stay inside the local source root.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    const sourceFile = readOptionalBaselineFile({
      projectRoot: input.projectRoot,
      baselineRef: input.baselineRef,
      relativePath: sourceFileRelativePath,
      readRefFile: input.readRefFile
    });

    if (isErr(sourceFile)) {
      return sourceFile;
    }

    return ok(sourceFile.value === undefined
      ? undefined
      : {
          path: `${input.baselineRef}:${sourceFileRelativePath}`,
          text: sourceFile.value
        });
  };
}

function stripBaselineRefPrefix(filePath: string, baselineRef: string): string {
  const prefix = `${baselineRef}:`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function normalizeBaselineRelativePath(relativePath: string): string | undefined {
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) {
    return undefined;
  }

  return normalized;
}

function isGradleDependencyLocksDirectory(lockfilePath: string): boolean {
  const segments = path.normalize(lockfilePath).split(path.sep);
  return segments.length >= 2
    && segments[segments.length - 1] === "dependency-locks"
    && segments[segments.length - 2] === "gradle";
}

function findBaselineDirectoryPackagesPropsPath(input: {
  projectRoot: string;
  projectFilePath: string;
  baselineFiles: ReadonlySet<string>;
}): string | undefined {
  let current = path.posix.dirname(projectRelativeLockfilePath(
    input.projectRoot,
    input.projectFilePath
  ));

  while (true) {
    const candidate = current === "."
      ? "Directory.Packages.props"
      : `${current}/Directory.Packages.props`;
    if (input.baselineFiles.has(candidate)) {
      return candidate;
    }
    if (current === ".") {
      return undefined;
    }
    const parent = path.posix.dirname(current);
    current = parent === current ? "." : parent;
  }
}

function readBaselineDirectoryPackagesProps(input: {
  project: ProjectInput;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<{ path: string; text: string } | undefined, OhriskError> {
  const relativePath = input.baselineFiles
    ? findBaselineDirectoryPackagesPropsPath({
        projectRoot: input.project.rootDir,
        projectFilePath: input.project.lockfile.path,
        baselineFiles: input.baselineFiles
      })
    : normalizeBaselineRelativePath(
        path.relative(
          input.project.rootDir,
          findNearestDirectoryPackagesPropsPath(input.project.lockfile.path) ?? ""
        )
      );

  if (!relativePath) {
    return ok(undefined);
  }

  const baselineProps = readOptionalBaselineFile({
    projectRoot: input.project.rootDir,
    baselineRef: input.baselineRef,
    relativePath,
    readRefFile: input.readRefFile
  });

  if (isErr(baselineProps)) {
    return baselineProps;
  }

  return ok(baselineProps.value === undefined
    ? undefined
    : {
        path: `${input.baselineRef}:${relativePath}`,
        text: baselineProps.value
      });
}

function readOptionalBaselineFile(input: {
  projectRoot: string;
  baselineRef: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
}): Result<string | undefined, OhriskError> {
  const result = input.readRefFile({
    projectRoot: input.projectRoot,
    ref: input.baselineRef,
    relativePath: input.relativePath
  });

  if (!isErr(result)) {
    return ok(result.value);
  }

  if (result.error.code === "GIT_REF_FILE_NOT_FOUND") {
    return ok(undefined);
  }

  return err(result.error);
}

function tryParseObject(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function renderHelp(target?: HelpTarget): string {
  switch (target) {
    case "scan":
      return renderScanHelp();
    case "ci":
      return renderCiHelp();
    case "diff":
      return renderDiffHelp();
    case "explain":
      return renderExplainHelp();
    case "cache":
      return renderCacheHelp();
    case "help":
      return renderHelpCommandHelp();
    case "version":
      return renderVersionHelp();
    case undefined:
      return renderTopLevelHelp();
  }
}

function renderTopLevelHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    "  ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
    "  ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--output <file>] [--open]",
    "  ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "  ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
    "  ohrisk cache status|prune|clear [--cache-dir <path>] [--json]",
    "  ohrisk help [command]",
    "  ohrisk version",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "  ci      Run a scan and exit non-zero when findings meet the fail threshold.",
    "  diff    Compare current findings against a baseline git ref.",
    "  explain Explain how a license expression is classified for a profile.",
    "  cache   Inspect, prune, or clear the persistent artifact cache.",
    "  help    Print this help text.",
    "  version Print the Ohrisk package version.",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --repo <url>           Scan public GitHub; auto-select one nested dependency project.",
    "  --submodules <mode>    Ignore with an incomplete-coverage warning (default), or reject.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Render HTML; remote scans save it in the current directory.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --fail-on <severity>   CI threshold. Defaults to high for ci.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --help, -h             Print this help text.",
    "  --version, -v          Print the Ohrisk package version."
  ].join("\n");
}

function renderScanHelp(): string {
  return [
    "Ohrisk scan",
    "",
    "Usage:",
    "  ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --repo <url>           Scan public GitHub; auto-select one nested dependency project.",
    "  --submodules <mode>    Ignore with an incomplete-coverage warning (default), or reject.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Render HTML; remote scans default to <repository>-ohrisk.html.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderCiHelp(): string {
  return [
    "Ohrisk ci",
    "",
    "Usage:",
    "  ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--output <file>] [--open]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Print a browser-friendly HTML report.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --fail-on <severity>   CI threshold. Defaults to high.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderDiffHelp(): string {
  return [
    "Ohrisk diff",
    "",
    "Usage:",
    "  ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --all                  Compare every supported lockfile in both revisions.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --fail-on <severity>   Optional diff threshold.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderCacheHelp(): string {
  return [
    "Ohrisk cache",
    "",
    "Usage:",
    "  ohrisk cache status [--cache-dir <path>] [--json]",
    "  ohrisk cache prune [--cache-dir <path>] [--max-size <size>] [--max-age <duration>] [--json]",
    "  ohrisk cache clear [--cache-dir <path>] [--json]",
    "",
    "Actions:",
    "  status                Show entry, object, size, freshness, and corruption counts.",
    "  prune                 Remove expired, old, orphaned, or least-recently-used entries.",
    "  clear                 Remove all Ohrisk cache entries and objects.",
    "",
    "Options:",
    "  --cache-dir <path>    Manage this cache directory instead of the default cache.",
    "  --max-size <size>     Keep cache objects within a size such as 512MiB or 2GB.",
    "  --max-age <duration>  Remove entries unused for a duration such as 24h or 7d.",
    "  --json                Print machine-readable output without an absolute cache path.",
    "  --help, -h            Print this help text."
  ].join("\n");
}

function renderExplainHelp(): string {
  return [
    "Ohrisk explain",
    "",
    "Usage:",
    "  ohrisk explain <license-expression> [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--json] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --policy <path>        Apply license rules from a workspace-contained policy file.",
    "  --workspace-root <path> Set the boundary for local policy inheritance.",
    "  --json                 Print machine-readable output.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderHelpCommandHelp(): string {
  return [
    "Ohrisk help",
    "",
    "Usage:",
    "  ohrisk help [command]",
    "",
    "Commands:",
    "  scan",
    "  ci",
    "  diff",
    "  explain",
    "  cache",
    "  help",
    "  version",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderVersionHelp(): string {
  return [
    "Ohrisk version",
    "",
    "Usage:",
    "  ohrisk version",
    "  ohrisk --version",
    "  ohrisk -v",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function emitReport(input: {
  contents: string;
  outputPath: string | undefined;
  io: CliIO;
  suppressSuccessMessage?: boolean;
}): Result<string | undefined, OhriskError> {
  if (!input.outputPath) {
    input.io.stdout(input.contents);
    return ok(undefined);
  }

  const writer = input.io.writeReport ?? writeReportFile;
  const written = writer({
    cwd: input.io.cwd,
    outputPath: input.outputPath,
    contents: input.contents
  });

  if (isErr(written)) {
    return written;
  }

  if (!input.suppressSuccessMessage) {
    input.io.stderr(`Wrote report to ${written.value}`);
  }
  return ok(written.value);
}

function formatReportOpenWarning(error: OhriskError): string {
  const opener =
    typeof error.details?.opener === "string" && error.details.opener.trim() !== ""
      ? ` with ${error.details.opener}`
      : "";
  const cause =
    typeof error.details?.cause === "string" && error.details.cause.trim() !== ""
      ? ` Cause: ${error.details.cause}`
      : "";
  return `Could not open report${opener}: ${error.message}${cause}`;
}

function redactTemporaryPath(error: OhriskError, temporaryRoot: string): OhriskError {
  return {
    ...error,
    message: redactTemporaryPathText(error.message, temporaryRoot),
    ...(error.details
      ? { details: redactTemporaryPathValue(error.details, temporaryRoot) as Record<string, unknown> }
      : {})
  };
}

function redactTemporaryPathValue(value: unknown, temporaryRoot: string): unknown {
  if (typeof value === "string") {
    return redactTemporaryPathText(value, temporaryRoot);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactTemporaryPathValue(item, temporaryRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactTemporaryPathValue(item, temporaryRoot)])
    );
  }
  return value;
}

function redactTemporaryPathText(value: string, temporaryRoot: string): string {
  const variants = [
    temporaryRoot,
    temporaryRoot.replace(/\\/g, "/"),
    temporaryRoot.replace(/\//g, "\\")
  ];
  return variants.reduce(
    (redacted, variant) => redacted.split(variant).join("<temporary repository>"),
    value
  );
}

function createScanProgressReporter(io: CliIO): ScanProgressReporter {
  if (!io.stderrStream?.isTTY) {
    return createLegacyScanProgressReporter(io);
  }

  const runtime = createProgressRuntime({
    stderr: io.stderrStream,
    format: "human",
    progressPolicy: "auto",
    env: io.env ?? process.env,
    maxRows: 1,
    manageProcessLifecycle: false,
    theme: {
      runningSymbol: ">",
      successSymbol: "ok",
      progressComplete: "#",
      progressIncomplete: "-",
      overflowMarker: "..."
    }
  });
  const task = runtime.createTask("Ohrisk scan", { total: 100 });

  const reporter = ((rawPercent, message) => {
    updateLaquScanTask(task, rawPercent, message);
  }) as ScanProgressReporter;
  reporter.close = (status) => closeLaquScanProgress(runtime, task, status);
  return reporter;
}

function createLegacyScanProgressReporter(io: CliIO): ScanProgressReporter {
  return (rawPercent, message) => {
    const percent = normalizeScanProgressPercent(rawPercent);
    const filled = Math.round((percent / 100) * SCAN_PROGRESS_BAR_WIDTH);
    const bar = `${"#".repeat(filled)}${"-".repeat(SCAN_PROGRESS_BAR_WIDTH - filled)}`;
    io.stderr(`[${bar}] ${percent.toString().padStart(3, " ")}% ${message}`);
  };
}

function updateLaquScanTask(task: TaskHandle, rawPercent: number, message: string): void {
  const percent = normalizeScanProgressPercent(rawPercent);
  task.setCompleted(percent);
  task.setMessage(`${percent.toString().padStart(3, " ")}% ${message}`);
}

async function closeLaquScanProgress(
  runtime: ProgressRuntime,
  task: TaskHandle,
  status: ScanProgressCloseStatus = "success"
): Promise<void> {
  if (status === "success") {
    task.succeed("Report ready.");
  } else {
    task.fail("Scan failed.");
  }
  await runtime.close();
}

async function closeScanProgressReporter(
  reporter: ScanProgressReporter | undefined,
  status: ScanProgressCloseStatus = "success"
): Promise<void> {
  await reporter?.close?.(status);
}

function normalizeScanProgressPercent(rawPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, rawPercent)));
}

function reportFormatLabel(command: Extract<CliCommand, { kind: "scan" | "ci" }>): string {
  if (command.json) {
    return "JSON";
  }
  if (command.sarif) {
    return "SARIF";
  }
  if (command.markdown) {
    return "Markdown";
  }
  if (command.html) {
    return "HTML";
  }
  if (command.cyclonedx) {
    return "CycloneDX";
  }
  return "terminal";
}


function renderVersion(): string {
  return `ohrisk ${OHRISK_VERSION}`;
}

function resolveWorkspaceRootPath(input: {
  cwd: string;
  workspaceRootPath: string | undefined;
}): Result<string | undefined, OhriskError> {
  if (!input.workspaceRootPath) {
    return ok(undefined);
  }

  const resolvedPath = path.resolve(input.cwd, input.workspaceRootPath);
  try {
    const realPath = realpathSync(resolvedPath);
    if (!statSync(realPath).isDirectory()) {
      return err(workspaceRootInvalidError(input.workspaceRootPath));
    }

    return ok(realPath);
  } catch {
    return err(workspaceRootInvalidError(input.workspaceRootPath));
  }
}

function workspaceRootInvalidError(workspaceRootPath: string): OhriskError {
  const absolute = path.isAbsolute(workspaceRootPath);
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "--workspace-root must point to an existing directory.",
    details: {
      workspaceRootPath: absolute ? "<absolute-path>" : workspaceRootPath,
      reason: absolute
        ? "absolute_workspace_root_not_available"
        : "workspace_root_not_available"
    }
  });
}

function isCliEntrypoint(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
  }
}

function isFile(pathname: string): boolean {
  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function defaultIO(): CliIO {
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    stderrStream: process.stderr,
    env: process.env
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await main();
  process.exit(exitCode);
}
