#!/usr/bin/env node
import { isIP } from "node:net";
import type { StreamTarget } from "@0disoft/laqu";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./args";
import {
  COMMAND_CANCELLED_EXIT_CODE,
  createCommandCancellation,
  createProcessCommandSignal,
  isCommandCancelled,
  renderCommandCancelled
} from "./cancellation";
import { OHRISK_VERSION } from "./version";
import { loadArchiveProject } from "../archive/archive-project";
import { readArchiveFile } from "../archive/archive-reader";
import { diffRiskFindings } from "../diff/compare";
import {
  defaultArtifactCacheDirectory
} from "../evidence/cache";
import {
  collectGraphEvidence,
  fetchMavenCentralModelPoms,
  type EvidenceCollectionProgress
} from "../evidence/collect";
import {
  parseProjectDependencyGraphWithRemoteMavenPoms,
  resolveWithRemoteMavenPoms
} from "../ecosystems/registry";
import type { LicenseEvidence } from "../evidence/types";
import {
  listGitRefFiles,
  readGitRefFile,
  type GitRefFileLister,
  type GitRefFileReader
} from "../git/ref-file";
import { refineGoDependencyScopes } from "../graph/go-scope";
import type { DependencyGraph } from "../graph/types";
import { normalizeAllLicenseEvidence, normalizeLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisk, evaluateLicenseRisks } from "../policy/evaluate";
import {
  readPolicyConfig,
  summarizePolicyConfig,
  type ResolvedPolicyConfig
} from "../policy/config";
import { hasFindingAtOrAbove } from "../policy/severity";
import { renderCycloneDxReport } from "../report/cyclonedx-report";
import { renderDiffReport } from "../report/diff-report";
import { renderExplainReport } from "../report/explain-report";
import { renderSarifReport } from "../report/sarif-report";
import {
  buildScanCompleteness,
  renderScanReport,
  type RemoteRepositoryReportSource,
  type ScanReportInput
} from "../report/scan-report";
import { openReportFile, type ReportOpener } from "../report/open-report";
import type { ReportWriter } from "../report/write-output";
import {
  type RepositoryCloner
} from "../repository/github-repository";
import type { RepositoryTreeInventory } from "../repository/tree-inventory";
import {
  discoverProject,
  isSbomLockfileKind,
  projectLockfiles,
  type ProjectInput
} from "../project/discover";
import { createError, exitCodeForError, formatError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";
import {
  buildDiffLockfileChanges,
  loadBaselineProjectGraph
} from "./baseline-project";
import { runCacheCommand } from "./cache-command";
import {
  buildDiffEvidenceCompleteness,
  renderIncompleteDiffEvidence
} from "./diff-completeness";
import type { CliCommand } from "./command";
import { renderHelp } from "./help";
import {
  emitReport,
  formatReportOpenWarning,
  reportFormatLabel
} from "./report-output";
import {
  redactTemporaryPath,
  runRemoteRepositoryScan
} from "./remote-repository-scan";
import {
  closeScanProgressReporter,
  createEvidenceProgressReporter,
  createScanProgressReporter,
  SCAN_PROGRESS_DISCOVER_PERCENT,
  SCAN_PROGRESS_EVALUATE_PERCENT,
  SCAN_PROGRESS_EVIDENCE_START_PERCENT,
  SCAN_PROGRESS_READ_LOCKFILE_PERCENT,
  SCAN_PROGRESS_READY_PERCENT,
  SCAN_PROGRESS_RENDER_PERCENT,
  SCAN_PROGRESS_WRITE_PERCENT,
  type ScanClock,
  type ScanProgressReporter
} from "./scan-progress";
import {
  evaluateScanPolicyAndWaivers,
  filterGraphBeforeEvidence,
  filterGraphForProdOnly,
  hasWaiverDrift,
  type ScanResult
} from "./scan-policy";
import { resolveWorkspaceRootPath } from "./workspace-root";

export { loadBaselineProjectGraph } from "./baseline-project";
export { filterGraphBeforeEvidence } from "./scan-policy";

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
  signal?: AbortSignal;
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

  const commandCancellation = createCommandCancellation(io.signal);
  try {
    switch (command.kind) {
      case "help":
        io.stdout(renderHelp(command.target));
        return 0;
      case "version":
        io.stdout(renderVersion());
        return 0;
      case "cache":
        return runCacheCommand(command, io);
      case "scan":
        return await runScan(command, io, commandCancellation.signal);
      case "ci":
        return await runScan(command, io, commandCancellation.signal);
      case "diff":
        return await runDiff(command, io, commandCancellation.signal);
      case "explain":
        return runExplain(command, io);
    }
  } finally {
    commandCancellation.dispose();
  }
}

async function runDiff(
  command: Extract<CliCommand, { kind: "diff" }>,
  io: CliIO,
  signal: AbortSignal
): Promise<number> {
  const workspaceRoot = resolveWorkspaceRootPath({
    cwd: io.cwd,
    workspaceRootPath: command.workspaceRootPath
  });
  if (isErr(workspaceRoot)) {
    io.stderr(formatError(workspaceRoot.error));
    return exitCodeForError(workspaceRoot.error);
  }

  const currentProject = discoverFilesystemProject({
    cwd: io.cwd,
    ...(command.lockfilePath ? { lockfilePath: command.lockfilePath } : {}),
    ...(command.allLockfiles ? { allLockfiles: true } : {})
  });

  if (isErr(currentProject)) {
    io.stderr(formatError(currentProject.error));
    return exitCodeForError(currentProject.error);
  }

  const policy = readPolicyConfig({
    projectRoot: currentProject.value.rootDir,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
    ...(command.policyPath ? { policyPath: command.policyPath } : {})
  });
  if (isErr(policy)) {
    io.stderr(formatError(policy.error));
    return exitCodeForError(policy.error);
  }

  const evidenceRuntime = resolveEvidenceRuntimeOptions({
    cwd: io.cwd,
    projectRoot: currentProject.value.rootDir,
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

  const fetchRemoteMavenPoms = (requests: Parameters<typeof fetchMavenCentralModelPoms>[0]["requests"]) =>
    fetchMavenCentralModelPoms({
      requests,
      offline: evidenceRuntime.value.offline,
      signal,
      ...(evidenceRuntime.value.timeoutMs === undefined
        ? {}
        : { fetchTimeoutMs: evidenceRuntime.value.timeoutMs }),
      ...(evidenceRuntime.value.cacheDir === undefined
        ? {}
        : { cacheDir: evidenceRuntime.value.cacheDir })
    });
  const currentGraph = await parseProjectDependencyGraphWithRemoteMavenPoms({
    project: currentProject.value,
    fetchRemotePoms: fetchRemoteMavenPoms
  });
  if (isErr(currentGraph)) {
    io.stderr(formatError(currentGraph.error));
    return exitCodeForError(currentGraph.error);
  }
  const currentProjectGraph = {
    project: currentProject.value,
    scanGraph: filterGraphBeforeEvidence(currentGraph.value, command.prodOnly)
  };

  if (isCommandCancelled(signal)) {
    io.stderr(renderCommandCancelled("Diff"));
    return COMMAND_CANCELLED_EXIT_CODE;
  }

  const readRefFile = io.readRefFile ?? readGitRefFile;
  const listRefFiles = io.listRefFiles ?? listGitRefFiles;
  const baselineProject = await resolveWithRemoteMavenPoms({
    parse: (mavenExternalPoms) => loadBaselineProjectGraph({
      currentProject: currentProjectGraph,
      baselineRef: command.baselineRef,
      allLockfiles: command.allLockfiles ?? false,
      readRefFile,
      listRefFiles,
      ...(mavenExternalPoms.size > 0 ? { mavenExternalPoms } : {}),
      ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {})
    }),
    fetchRemotePoms: fetchRemoteMavenPoms
  });

  if (isErr(baselineProject)) {
    io.stderr(formatError(baselineProject.error));
    return exitCodeForError(baselineProject.error);
  }

  const baselineCollectionGraph = filterGraphBeforeEvidence(
    baselineProject.value.graph,
    command.prodOnly
  );
  const baselineEvidence = await collectEvidenceForGraph({
    graph: baselineCollectionGraph,
    projectRoot: currentProject.value.rootDir,
    allowLocalProjectEvidence: false,
    evidenceRuntime: evidenceRuntime.value,
    signal,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {})
  });

  if (isErr(baselineEvidence)) {
    if (isCommandCancelled(signal)) {
      io.stderr(renderCommandCancelled("Diff"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }
    io.stderr(formatError(baselineEvidence.error));
    return exitCodeForError(baselineEvidence.error);
  }

  const baselineScanGraph = filterGraphForProdOnly(
    refineGoDependencyScopes(baselineCollectionGraph, baselineEvidence.value),
    command.prodOnly
  );
  const baselineNodeIds = new Set(baselineScanGraph.nodes.map((node) => node.id));
  const relevantBaselineEvidence = baselineEvidence.value.filter((item) =>
    baselineNodeIds.has(item.packageId)
  );
  const baselineLicenses = normalizeAllLicenseEvidence(relevantBaselineEvidence);
  const baselineFindings = evaluateLicenseRisks({
    licenses: baselineLicenses,
    dependencies: baselineScanGraph.nodes,
    profile: command.profile,
    policy: policy.value
  });
  const current = await evaluateProjectScan({
    ...currentProjectGraph,
    profile: command.profile,
    policy: policy.value,
    evidenceRuntime: evidenceRuntime.value,
    prodOnly: command.prodOnly,
    applyWaivers: false,
    now: io.now ?? Date.now,
    signal,
    ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {})
  });

  if (isErr(current)) {
    if (isCommandCancelled(signal)) {
      io.stderr(renderCommandCancelled("Diff"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }
    io.stderr(formatError(current.error));
    return exitCodeForError(current.error);
  }

  const completeness = buildDiffEvidenceCompleteness({
  baseline: buildScanCompleteness({ evidence: relevantBaselineEvidence }),
  current: buildScanCompleteness({ evidence: current.value.evidence })
});
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
      projectRoot: currentProject.value.rootDir,
      currentLockfiles: projectLockfiles(currentProject.value),
      baselineLockfiles: baselineProject.value.lockfiles
    }),
    ...(command.failOn ? { failOn: command.failOn } : {}),
    policy: summarizePolicyConfig(policy.value)
  });

  if (isCommandCancelled(signal)) {
    io.stderr(renderCommandCancelled("Diff"));
    return COMMAND_CANCELLED_EXIT_CODE;
  }

  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    if (isCommandCancelled(signal)) {
      io.stderr(renderCommandCancelled("Diff"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (completeness.status === "partial" && !command.allowPartialEvidence) {
  io.stderr(renderIncompleteDiffEvidence(completeness));
  return 1;
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
  io: CliIO,
  signal: AbortSignal
): Promise<number> {
  const repository = command.kind === "scan" ? command.repository : undefined;
  const reportProgress = command.outputPath ? createScanProgressReporter(io) : undefined;
  reportProgress?.(0, command.kind === "ci" ? "Starting CI scan..." : "Starting scan...");

  if (!repository) {
    return runScanAt({
      command,
      io,
      scanCwd: io.cwd,
      ...(reportProgress ? { reportProgress } : {}),
      signal
    });
  }

  const submoduleMode = command.kind === "scan" ? command.submoduleMode ?? "ignore" : "ignore";
  return runRemoteRepositoryScan({
    repository,
    submoduleMode,
    invocationCwd: io.cwd,
    signal,
    ...(reportProgress ? { reportProgress } : {}),
    ...(io.cloneRepository ? { cloneRepository: io.cloneRepository } : {}),
    stderr: io.stderr,
    scan: (context) => runScanAt({
      command,
      io,
      ...context,
      ...(reportProgress ? { reportProgress } : {}),
      signal
    })
  });
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
  signal: AbortSignal;
  inventory?: RepositoryTreeInventory;
}): Promise<number> {
  const { command, io, reportProgress, signal } = input;
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
    ...(reportProgress ? { progress: reportProgress } : {}),
    signal,
    ...(input.inventory ? { inventory: input.inventory } : {})
  });

  if (isErr(scanned)) {
    await closeScanProgressReporter(reportProgress, "failure");
    if (isCommandCancelled(signal)) {
      io.stderr(renderCommandCancelled("Scan"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }
    const scanError = input.temporaryRoot
      ? redactTemporaryPath(scanned.error, input.temporaryRoot)
      : scanned.error;
    io.stderr(formatError(scanError));
    return exitCodeForError(scanError);
  }

  const completeness = buildScanCompleteness({
    evidence: scanned.value.evidence,
    ...(input.repository ? { repository: input.repository } : {})
  });

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
    completeness,
    ...(input.repository ? { repository: input.repository } : {})
  };

  reportProgress?.(SCAN_PROGRESS_RENDER_PERCENT, `Rendering ${reportFormatLabel(command)} report...`);
  const output = command.cyclonedx
    ? renderCycloneDxReport(reportInput)
    : command.sarif
      ? renderSarifReport(reportInput)
      : renderScanReport(reportInput);

  if (isCommandCancelled(signal)) {
    await closeScanProgressReporter(reportProgress, "failure");
    io.stderr(renderCommandCancelled("Scan"));
    return COMMAND_CANCELLED_EXIT_CODE;
  }

  reportProgress?.(SCAN_PROGRESS_WRITE_PERCENT, "Writing report file...");
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io,
    suppressSuccessMessage: Boolean(reportProgress)
  });

  if (isErr(emitted)) {
    await closeScanProgressReporter(reportProgress, "failure");
    if (isCommandCancelled(signal)) {
      io.stderr(renderCommandCancelled("Scan"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }
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

  if (
    command.kind === "ci"
    && completeness.status === "partial"
    && !command.allowPartialEvidence
  ) {
    return 1;
  }

  if (command.kind === "ci" && command.strictWaivers && hasWaiverDrift(scanned.value)) {
    return 1;
  }

  return 0;
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
  signal?: AbortSignal;
  inventory?: RepositoryTreeInventory;
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
      ...(input.progress ? { progress: input.progress } : {}),
      ...(input.signal ? { signal: input.signal } : {})
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
      ...(input.progress ? { progress: input.progress } : {}),
      ...(input.inventory ? { inventory: input.inventory } : {})
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
        ...(input.signal ? { signal: input.signal } : {}),
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
    scanGraph = filterGraphBeforeEvidence(graph.value, input.prodOnly);
  }

  return evaluateProjectScan({
    project,
    scanGraph,
    profile: input.profile,
    policy: policy.value,
    evidenceRuntime: evidenceRuntime.value,
    prodOnly: input.prodOnly,
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
    ...(input.progress ? { progress: input.progress } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });
}

function loadArchiveProjectGraph(input: {
  cwd: string;
  archivePath: string;
  allLockfiles: boolean;
  prodOnly: boolean;
  now: ScanClock;
  progress?: ScanProgressReporter;
  signal?: AbortSignal;
}): Result<{
  project: ProjectInput;
  scanGraph: DependencyGraph;
}, OhriskError> {
  input.progress?.(SCAN_PROGRESS_DISCOVER_PERCENT, "Reading archive index...");
  const archive = readArchiveFile({
    cwd: input.cwd,
    archivePath: input.archivePath,
    now: input.now,
    ...(input.signal ? { signal: input.signal } : {})
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
    scanGraph: filterGraphBeforeEvidence(loaded.value.graph, input.prodOnly)
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
  inventory?: RepositoryTreeInventory;
}): Result<ProjectInput, OhriskError> {
  input.progress?.(SCAN_PROGRESS_DISCOVER_PERCENT, "Discovering project...");
  const discovered = discoverProject({
    cwd: input.cwd,
    ...(input.lockfilePath ? { lockfilePath: input.lockfilePath } : {}),
    ...(input.projectSearchMode ? { searchMode: input.projectSearchMode } : {}),
    ...(input.autoMergeSameRoot ? { autoMergeSameRoot: true } : {}),
    ...(input.autoMergeDescendantProjects ? { autoMergeDescendantProjects: true } : {}),
    ...(input.allLockfiles ? { allLockfiles: true } : {}),
    ...(input.inventory ? { inventory: input.inventory } : {})
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
  prodOnly: boolean;
  applyWaivers: boolean;
  now: ScanClock;
  workspaceRoot?: string;
  progress?: ScanProgressReporter;
  signal?: AbortSignal;
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
    ...(evidenceProgress ? { progress: evidenceProgress } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });

  if (isErr(evidence)) {
    return evidence;
  }

  input.progress?.(SCAN_PROGRESS_EVALUATE_PERCENT, "Evaluating license risk...");
  return evaluateScanPolicyAndWaivers({
    project: input.project,
    collectionGraph: input.scanGraph,
    evidence: evidence.value,
    profile: input.profile,
    policy: input.policy,
    prodOnly: input.prodOnly,
    applyWaivers: input.applyWaivers,
    ...(input.configurationRoot ? { configurationRoot: input.configurationRoot } : {})
  });
}

async function collectEvidenceForGraph(input: {
  graph: DependencyGraph;
  projectRoot: string;
  allowLocalProjectEvidence?: boolean;
  workspaceRoot?: string;
  evidenceRuntime: EvidenceRuntimeOptions;
  progress?: (progress: EvidenceCollectionProgress) => void;
  signal?: AbortSignal;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const embeddedEvidence = input.graph.embeddedEvidence ?? [];
  const graphNodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const relevantEmbeddedEvidence = embeddedEvidence.filter((evidence) =>
    graphNodeIds.has(evidence.packageId)
  );
  const nodesById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const ignoredOverlappingSbomIds = new Set(
    relevantEmbeddedEvidence
      .filter((evidence) => {
        const node = nodesById.get(evidence.packageId);
        return evidence.source === "sbom"
          && node?.origins?.some((origin) => !isSbomLockfileKind(origin.lockfileKind));
      })
      .map((evidence) => evidence.packageId)
  );
  const authoritativeEmbeddedEvidence = relevantEmbeddedEvidence.filter(
    (evidence) => !ignoredOverlappingSbomIds.has(evidence.packageId)
  );
  const embeddedEvidenceIds = new Set(
    authoritativeEmbeddedEvidence.map((evidence) => evidence.packageId)
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

  for (const evidence of authoritativeEmbeddedEvidence) {
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
    ...(input.signal ? { signal: input.signal } : {}),
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

  return ok([
    ...authoritativeEmbeddedEvidence,
    ...collected.value.map((evidence) => ignoredOverlappingSbomIds.has(evidence.packageId)
      ? {
          ...evidence,
          warnings: [
            ...evidence.warnings,
            "Embedded SBOM license metadata was ignored because a dependency input resolved the same package."
          ]
        }
      : evidence)
  ]);
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

function renderVersion(): string {
  return `ohrisk ${OHRISK_VERSION}`;
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
  const processSignal = createProcessCommandSignal();
  const exitCode = await main(process.argv.slice(2), {
    ...defaultIO(),
    signal: processSignal.signal
  }).finally(() => {
    processSignal.dispose();
  });
  process.exit(exitCode);
}
