#!/usr/bin/env node
import type { StreamTarget } from "@0disoft/laqu";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args";
import { COMMAND_CANCELLED_EXIT_CODE, createCommandCancellation, createProcessCommandSignal, isCommandCancelled, renderCommandCancelled } from "./cancellation";
import { OHRISK_VERSION } from "./version";
import { diffRiskFindings } from "../diff/compare";
import { fetchMavenCentralModelPoms } from "../evidence/collect";
import { parseProjectDependencyGraphWithRemoteMavenPoms, resolveWithRemoteMavenPoms } from "../ecosystems/registry";
import { listGitRefFiles, readGitRefFile, type GitRefFileLister, type GitRefFileReader } from "../git/ref-file";
import { refineGoDependencyScopes } from "../graph/go-scope";
import { normalizeAllLicenseEvidence, normalizeLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisk, evaluateLicenseRisks } from "../policy/evaluate";
import { readPolicyConfig, summarizePolicyConfig } from "../policy/config";
import { hasFindingAtOrAbove } from "../policy/severity";
import { incompleteEvidenceGateFailed, type ComparisonCompleteness } from "../policy/completeness";
import { buildGraphGate } from "../policy/inspection-gate";
import { renderCycloneDxReport } from "../report/cyclonedx-report";
import { renderDiffReport } from "../report/diff-report";
import { renderExplainReport } from "../report/explain-report";
import { detectSystemLocale, resolveReportLanguage } from "../report/language";
import { renderSarifReport } from "../report/sarif-report";
import { buildScanCompleteness, renderScanReport, type RemoteRepositoryReportSource, type ScanReportInput } from "../report/scan-report";
import { openReportFile, type ReportOpener } from "../report/open-report";
import type { ReportWriter } from "../report/write-output";
import { type RepositoryCloner } from "../repository/github-repository";
import type { RepositoryTreeInventory } from "../repository/tree-inventory";
import { projectLockfiles } from "../project/discover";
import { exitCodeForError, formatError } from "../shared/errors";
import { isErr } from "../shared/result";
import { buildDiffLockfileChanges, loadBaselineProjectGraph } from "./baseline-project";
import { runCacheCommand } from "./cache-command";
import type { CliCommand } from "./command";
import { runInitCommand } from "./init-command";
import { renderHelp } from "./help";
import { emitReport, formatReportOpenWarning, reportFormatLabel } from "./report-output";
import { redactTemporaryPath, runRemoteRepositoryScan } from "./remote-repository-scan";
import { closeScanProgressReporter, createScanProgressReporter, SCAN_PROGRESS_READY_PERCENT, SCAN_PROGRESS_RENDER_PERCENT, SCAN_PROGRESS_WRITE_PERCENT, type ScanProgressReporter } from "./scan-progress";
import { filterGraphBeforeEvidence, filterGraphForProdOnly, hasWaiverDrift } from "./scan-policy";
import { resolveWorkspaceRootPath } from "./workspace-root";
import { captureArtifacts } from "../evidence/artifact-capture";
import { createInspectionSnapshot, SNAPSHOT_MAX_BYTES } from "../snapshot/inspection-snapshot";
import { writeReportFile } from "../report/write-output";
import { scanProject, discoverFilesystemProject, evaluateProjectScan, collectEvidenceForGraph, resolveEvidenceRuntimeOptions } from "./scan-engine";


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
  systemLocale?: () => string | undefined;
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
      case "init":
        return runInitCommand(command, io);
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
    prodOnly: command.prodOnly,
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

  const diff = diffRiskFindings({
    baselineFindings,
    currentFindings: current.value.riskFindings
  });

  const baselineCompleteness = buildScanCompleteness({ evidence: relevantBaselineEvidence, graph: baselineScanGraph, normalizedLicenses: baselineLicenses });
  const currentCompleteness = buildScanCompleteness({ evidence: current.value.evidence, graph: current.value.graph, normalizedLicenses: current.value.normalizedLicenses });
  const completeness: ComparisonCompleteness = {
    status: baselineCompleteness.status === "partial" || currentCompleteness.status === "partial"
      ? "partial" : "complete",
    baseline: baselineCompleteness,
    current: currentCompleteness
  };
  const evidenceGateFailed = incompleteEvidenceGateFailed({
    enabled: command.failOn !== undefined,
    allowPartialEvidence: command.allowPartialEvidence ?? false,
    completeness
  });
  const graphGate = buildGraphGate({ required: command.requireCompleteGraph ?? false, completeness });

  const output = renderDiffReport({
    baselineRef: command.baselineRef,
    completeness,
    evidenceGateFailed,
    ...(graphGate.required ? { graphGate } : {}),
    allowPartialEvidence: command.allowPartialEvidence ?? false,
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

  if (command.failOn && hasFindingAtOrAbove(diff.introducedFindings, command.failOn)) {
    return 1;
  }

  if (evidenceGateFailed || graphGate.failed) return 1;

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
  allowProjectContainedGoReplacementEvidence?: boolean;
  reportProgress?: ScanProgressReporter;
  temporaryRoot?: string;
  repository?: RemoteRepositoryReportSource;
  signal: AbortSignal;
  inventory?: RepositoryTreeInventory;
}): Promise<number> {
  const { command, io, reportProgress, signal } = input;
  if (command.snapshotPath && command.outputPath && path.resolve(io.cwd, command.snapshotPath) === path.resolve(io.cwd, command.outputPath)) {
    await closeScanProgressReporter(reportProgress, "failure");
    io.stderr("Snapshot and report output paths must differ.");
    return 2;
  }
  const now = io.now ?? Date.now;
  const workspaceRoot = resolveWorkspaceRootPath({
    cwd: io.cwd,
    workspaceRootPath: command.workspaceRootPath
  });
  if (isErr(workspaceRoot)) {
    io.stderr(formatError(workspaceRoot.error));
    return exitCodeForError(workspaceRoot.error);
  }

  const scan = () => scanProject({
    cwd: input.scanCwd,
    ...(input.configurationRoot ? { configurationRoot: input.configurationRoot } : {}),
    ...(input.runtimeRoot ? { runtimeRoot: input.runtimeRoot } : {}),
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : {}),
    ...(input.allowProjectContainedGoReplacementEvidence !== undefined
      ? {
          allowProjectContainedGoReplacementEvidence:
            input.allowProjectContainedGoReplacementEvidence
        }
      : {}),
    ...(command.lockfilePath ? { lockfilePath: command.lockfilePath } : {}),
    ...(command.archivePath ? { archivePath: command.archivePath } : {}),
    ...(input.repository ? { projectSearchMode: "tree" as const } : {}),
    ...(input.repository || command.archivePath ? { autoMergeSameRoot: true } : {}),
    ...(input.repository ? { autoMergeDescendantProjects: true } : {}),
    allLockfiles: command.allLockfiles ?? false,
    ...(command.fromSnapshotPath ? { fromSnapshotPath: command.fromSnapshotPath } : {}),
    captureSnapshot: Boolean(command.snapshotPath),
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
  const captured = command.snapshotPath ? await captureArtifacts(scan) : { value: await scan(), artifacts: [], truncated: false };
  const scanned = captured.value;

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

  const repository = input.repository ?? scanned.value.snapshotRepository;
  if (isCommandCancelled(signal)) {
    await closeScanProgressReporter(reportProgress, "failure");
    io.stderr(renderCommandCancelled("Scan"));
    return COMMAND_CANCELLED_EXIT_CODE;
  }
  const sourceSnapshot = scanned.value.snapshotSource;
  if (sourceSnapshot) io.stderr(`Replaying saved evidence from Ohrisk ${sourceSnapshot.payload.tool.version}; dependencies and evidence retained; policy ${sourceSnapshot.payload.policyDigest === scanned.value.policy.digest ? "unchanged" : "changed"}; rules ${sourceSnapshot.payload.tool.rulesVersion === OHRISK_VERSION ? "same version" : "changed version"}; waivers ${sourceSnapshot.payload.waiverDigest === scanned.value.snapshotWaiverDigest ? "unchanged" : "changed"}.`);
  if (command.snapshotPath) {
    const snapshot = createInspectionSnapshot({ scan: scanned.value, inputs: scanned.value.snapshotInputs ?? [],
      waiverDigest: scanned.value.snapshotWaiverDigest ?? null, prodOnly: command.prodOnly,
      artifacts: sourceSnapshot?.payload.artifacts ?? captured.artifacts,
      artifactsTruncated: sourceSnapshot?.payload.artifactsTruncated ?? captured.truncated,
      ...(sourceSnapshot ? { replayedFrom: sourceSnapshot.payloadSha256 } : {}), ...(repository ? { repository } : {}) });
    const contents = JSON.stringify(snapshot, null, 2);
    if (Buffer.byteLength(contents) > SNAPSHOT_MAX_BYTES) {
      await closeScanProgressReporter(reportProgress, "failure");
      io.stderr("Snapshot exceeds the 32 MiB limit.");
      return 2;
    }
    const written = (io.writeReport ?? writeReportFile)({ cwd: io.cwd, outputPath: command.snapshotPath, contents });
    if (isErr(written)) { await closeScanProgressReporter(reportProgress, "failure"); io.stderr(formatError(written.error)); return exitCodeForError(written.error); }
  }
  const completeness = buildScanCompleteness({
    evidence: scanned.value.evidence,
    graph: scanned.value.graph,
    normalizedLicenses: scanned.value.normalizedLicenses,
    ...(repository ? { repository } : {})
  });
  const graphGate = buildGraphGate({ required: command.requireCompleteGraph ?? false, completeness });

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
    ...(command.html
      ? {
          reportLanguage: resolveReportLanguage(
            command.reportLanguage,
            io.systemLocale?.()
          )
        }
      : {}),
    waiverMode: command.noWaivers ? "ignored" : "local",
    ...(command.kind === "ci" && command.failOn ? { failOn: command.failOn } : {}),
    ...(command.kind === "ci" ? { strictWaivers: command.strictWaivers } : {}),
    waivedFindings: scanned.value.waivedFindings,
    expiredWaivers: scanned.value.expiredWaivers,
    unmatchedWaivers: scanned.value.unmatchedWaivers,
    policy: scanned.value.policy,
    completeness,
    ...(graphGate.required ? { graphGate } : {}),
    ...(repository ? { repository } : {})
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
  if (graphGate.failed) return 1;

  if (
    incompleteEvidenceGateFailed({
      enabled: command.kind === "ci",
      allowPartialEvidence: command.kind === "ci" && command.allowPartialEvidence,
      completeness
    })
  ) {
    return 1;
  }

  if (command.kind === "ci" && command.strictWaivers && hasWaiverDrift(scanned.value)) {
    return 1;
  }

  return 0;
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
    env: process.env,
    systemLocale: detectSystemLocale
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
