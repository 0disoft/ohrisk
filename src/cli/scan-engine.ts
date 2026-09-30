import { isIP } from "node:net";
import path from "node:path";
import { evidenceCollectionStartMessage } from "./evidence-progress-message";
import { loadArchiveProject } from "../archive/archive-project";
import { readArchiveFile } from "../archive/archive-reader";
import { defaultArtifactCacheDirectory } from "../evidence/cache";
import { collectGraphEvidence, fetchMavenCentralModelPoms, type EvidenceCollectionProgress } from "../evidence/collect";
import { parseProjectDependencyGraphWithRemoteMavenPoms } from "../ecosystems/registry";
import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph } from "../graph/types";
import { readPolicyConfig, type ResolvedPolicyConfig } from "../policy/config";
import type { RepositoryTreeInventory } from "../repository/tree-inventory";
import { discoverProject, isSbomLockfileKind, type ProjectInput } from "../project/discover";
import { createError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";
import type { CliCommand } from "./command";
import { createEvidenceProgressReporter, SCAN_PROGRESS_DISCOVER_PERCENT, SCAN_PROGRESS_EVALUATE_PERCENT, SCAN_PROGRESS_EVIDENCE_START_PERCENT, SCAN_PROGRESS_READ_LOCKFILE_PERCENT, type ScanClock, type ScanProgressReporter } from "./scan-progress";
import { evaluateScanPolicyAndWaivers, filterGraphBeforeEvidence, type ScanResult } from "./scan-policy";
import { digest, inputReceipts, readInspectionSnapshot, snapshotError, waiverDigest } from "../snapshot/inspection-snapshot";

export type EvidenceRuntimeOptions = {
  offline: boolean;
  cacheDir: string;
  jobs?: number;
  timeoutMs?: number;
  npmRegistryUrl?: string;
  registryAuthTokens: ReadonlyMap<string, string>;
  allowedArtifactHosts: ReadonlySet<string>;
};

export async function scanProject(input: {
  fromSnapshotPath?: string;
  captureSnapshot?: boolean;
  cwd: string;
  configurationRoot?: string;
  runtimeRoot?: string;
  allowLocalProjectEvidence?: boolean;
  allowProjectContainedGoReplacementEvidence?: boolean;
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
  if (input.fromSnapshotPath) {
    const snapshot = readInspectionSnapshot(path.resolve(input.cwd, input.fromSnapshotPath));
    if (isErr(snapshot)) return snapshot;
    if (snapshot.value.payload.prodOnly && !input.prodOnly) return snapshotError("A production-only snapshot cannot be replayed as a full dependency scan. Use --prod.");
    const policy = readPolicyConfig({ projectRoot: input.configurationRoot ?? input.cwd,
      ...(input.policyPath ? { policyPath: input.policyPath } : {}), ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}) });
    if (isErr(policy)) return policy;
    const payload = snapshot.value.payload;
    const project: ProjectInput = { rootDir: input.cwd, lockfile: payload.project.lockfiles[0]!, lockfiles: payload.project.lockfiles };
    const evaluated = evaluateScanPolicyAndWaivers({ project, collectionGraph: payload.graph, evidence: payload.evidence,
      profile: input.profile, policy: policy.value, prodOnly: input.prodOnly, applyWaivers: input.applyWaivers });
    if (isErr(evaluated)) return evaluated;
    return ok({ ...evaluated.value, snapshotSource: snapshot.value, snapshotInputs: payload.inputs, snapshotWaiverDigest: waiverDigest(input.cwd, input.applyWaivers),
      ...(payload.repository ? { snapshotRepository: payload.repository } : {}) });
  }
  let project: ProjectInput;
  let scanGraph: DependencyGraph | undefined;
  if (input.archivePath) {
    const loaded = loadArchiveProjectGraph({
      cwd: input.cwd,
      archivePath: input.archivePath,
      allLockfiles: input.allLockfiles,
      autoMergeSameRoot: input.autoMergeSameRoot ?? false,
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

  const capturedInputs = input.captureSnapshot ? inputReceipts(project) : undefined;
  const capturedWaivers = input.captureSnapshot ? waiverDigest(input.configurationRoot ?? (project.source ? input.cwd : project.rootDir), input.applyWaivers) : undefined;
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

  const evaluated = await evaluateProjectScan({
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
    ...(input.allowProjectContainedGoReplacementEvidence !== undefined
      ? {
          allowProjectContainedGoReplacementEvidence:
            input.allowProjectContainedGoReplacementEvidence
        }
      : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.progress ? { progress: input.progress } : {}),
    ...(input.signal ? { signal: input.signal } : {})
  });
  if (isErr(evaluated)) return evaluated;
  if (capturedInputs && digest(JSON.stringify(capturedInputs)) !== digest(JSON.stringify(inputReceipts(project)))) return snapshotError("Selected dependency inputs changed during the scan; snapshot was not saved.");
  return ok({ ...evaluated.value, ...(capturedInputs ? { snapshotInputs: capturedInputs, snapshotWaiverDigest: capturedWaivers ?? null } : {}) });
}

function loadArchiveProjectGraph(input: {
  cwd: string;
  archivePath: string;
  allLockfiles: boolean;
  autoMergeSameRoot: boolean;
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
    allLockfiles: input.allLockfiles || input.autoMergeSameRoot
  });
  if (isErr(loaded)) {
    return loaded;
  }

  return ok({
    project: loaded.value.project,
    scanGraph: filterGraphBeforeEvidence(loaded.value.graph, input.prodOnly)
  });
}

export function discoverFilesystemProject(input: {
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

export async function evaluateProjectScan(input: {
  project: ProjectInput;
  scanGraph: DependencyGraph;
  configurationRoot?: string;
  allowLocalProjectEvidence?: boolean;
  allowProjectContainedGoReplacementEvidence?: boolean;
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
    evidenceCollectionStartMessage(input.scanGraph, input.prodOnly)
  );
  const evidence = await collectEvidenceForGraph({
    graph: input.scanGraph,
    projectRoot: input.project.rootDir,
    ...(input.allowLocalProjectEvidence !== undefined
      ? { allowLocalProjectEvidence: input.allowLocalProjectEvidence }
      : input.project.source
        ? { allowLocalProjectEvidence: false }
        : {}),
    ...(input.allowProjectContainedGoReplacementEvidence !== undefined
      ? {
          allowProjectContainedGoReplacementEvidence:
            input.allowProjectContainedGoReplacementEvidence
        }
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

export async function collectEvidenceForGraph(input: {
  graph: DependencyGraph;
  projectRoot: string;
  allowLocalProjectEvidence?: boolean;
  allowProjectContainedGoReplacementEvidence?: boolean;
  workspaceRoot?: string;
  evidenceRuntime: EvidenceRuntimeOptions;
  progress?: (progress: EvidenceCollectionProgress) => void;
  signal?: AbortSignal;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const embeddedEvidence = input.graph.embeddedEvidence ?? [];
  const graphNodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const conflictingArtifactIds = new Set(input.graph.nodes
    .filter((node) => node.artifactIdentityConflict).map((node) => node.id));
  const relevantEmbeddedEvidence = embeddedEvidence.filter((evidence) =>
    graphNodeIds.has(evidence.packageId) && !conflictingArtifactIds.has(evidence.packageId)
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
    ...(input.allowProjectContainedGoReplacementEvidence !== undefined
      ? {
          allowProjectContainedGoReplacementEvidence:
            input.allowProjectContainedGoReplacementEvidence
        }
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

export function resolveEvidenceRuntimeOptions(input: {
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
