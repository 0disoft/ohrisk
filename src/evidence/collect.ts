import { createArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { createCachingArtifactHostResolver, createDefaultArtifactFetcher, defaultArtifactHostResolver, normalizeAllowedArtifactHosts, withRegistryAuthorization, type ArtifactHostResolver } from "./artifact-transport";
import { BatchCancellation, isCollectionAbortedError } from "./cancellation";
import { resolveTrustedWorkspaceRoot } from "./local-artifact-path";
import type { MissingExternalMavenPom } from "../graph/java-maven-pom";
import { MAVEN_POM_METADATA_MAX_BYTES, parseMavenPomLicenseMetadata } from "./maven-package";
import type { LicenseEvidence } from "./types";
import type { DependencyGraph } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { mavenPomRepositoryPath } from "../shared/maven-repository";
import { err, ok, type Result } from "../shared/result";
import { collectNodeEvidence } from "./node-evidence";
import { isRecoverableRemoteEvidenceError, unavailableRemoteEvidence } from "./evidence-failure";
import { createCargoGitHubArchiveEvidenceCache } from "./remote-cargo-evidence";
import { createYarnCacheIndexLoader } from "./local-package-evidence";
import { createNugetServiceIndexLoader } from "./remote-nuget-evidence";
import { createMavenEvidenceCollector } from "./remote-maven-evidence";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { type EvidenceCollectionProgress, type RemoteMavenModelPom, ARTIFACT_FETCH_TIMEOUT_MS, REGISTRY_METADATA_MAX_BYTES, PACKAGE_TARBALL_MAX_BYTES, INSTALLED_PACKAGE_JSON_MAX_BYTES, DEFAULT_EVIDENCE_CONCURRENCY, MAVEN_CENTRAL_BASE_URL, MAVEN_CENTRAL_HOSTS, MAVEN_JAR_MAX_BYTES } from "./collection-runtime";



export { goModuleProxyModUrl, goModuleProxyZipUrl } from "./go-proxy-url";
export {
  secureArtifactLookup,
  selectSecureArtifactLookupResponse,
  validateArtifactSocketRemoteAddress
} from "./artifact-transport";
export type { ArtifactHostResolver } from "./artifact-transport";
export type { ArtifactFetcher } from "./artifact-response";

export type { EvidenceCollectionProgress, RemoteMavenModelPom } from "./collection-runtime";
export async function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
  workspaceRoot?: string;
  allowLocalProjectEvidence?: boolean;
  allowProjectContainedGoReplacementEvidence?: boolean;
  fetchArtifact?: ArtifactFetcher;
  fetchTimeoutMs?: number;
  registryMetadataMaxBytes?: number;
  tarballMaxBytes?: number;
  installedPackageJsonMaxBytes?: number;
  resolveArtifactHost?: ArtifactHostResolver;
  evidenceConcurrency?: number;
  offline?: boolean;
  cacheDir?: string;
  npmRegistryUrl?: string;
  registryAuthTokens?: ReadonlyMap<string, string>;
  allowedArtifactHosts?: Iterable<string>;
  progress?: (progress: EvidenceCollectionProgress) => void;
  signal?: AbortSignal;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const evidence = new Array<LicenseEvidence>(input.graph.nodes.length);
  const total = input.graph.nodes.length;
  if (total === 0) {
    return ok([]);
  }

  const batchCancellation = new BatchCancellation(input.signal);

  const workspaceRoot = input.workspaceRoot
    ? resolveTrustedWorkspaceRoot(input.workspaceRoot)
    : ok(undefined);
  if (!workspaceRoot.ok) {
    return err(workspaceRoot.error);
  }

  let completed = 0;
  let nextIndex = 0;
  let failure: { index: number; error: OhriskError } | undefined;
  const workerCount = normalizeEvidenceConcurrency(input.evidenceConcurrency, total);
  const allowedHosts = normalizeAllowedArtifactHosts(input.allowedArtifactHosts);
  const uncachedArtifactHostResolver = input.resolveArtifactHost
    ?? (input.fetchArtifact ? undefined : defaultArtifactHostResolver);
  const resolveArtifactHost = uncachedArtifactHostResolver
    ? createCachingArtifactHostResolver(uncachedArtifactHostResolver)
    : undefined;
  const baseFetchArtifact = input.fetchArtifact
    ?? createDefaultArtifactFetcher(resolveArtifactHost ?? defaultArtifactHostResolver);
  const fetchArtifact = baseFetchArtifact;
  const npmFetchArtifact = withRegistryAuthorization(baseFetchArtifact, input.registryAuthTokens);
  const artifactCache = input.cacheDir ? createArtifactCache(input.cacheDir) : undefined;
  const fetchTimeoutMs = input.fetchTimeoutMs ?? ARTIFACT_FETCH_TIMEOUT_MS;
  const registryMetadataMaxBytes = input.registryMetadataMaxBytes ?? REGISTRY_METADATA_MAX_BYTES;
  const tarballMaxBytes = input.tarballMaxBytes ?? PACKAGE_TARBALL_MAX_BYTES;
  const cargoGitHubArchiveEvidenceCache = createCargoGitHubArchiveEvidenceCache(input.graph.nodes);
  const installedPackageJsonMaxBytes =
    input.installedPackageJsonMaxBytes ?? INSTALLED_PACKAGE_JSON_MAX_BYTES;
  const allowLocalProjectEvidence = input.allowLocalProjectEvidence ?? true;
  const allowProjectContainedGoReplacementEvidence =
    input.allowProjectContainedGoReplacementEvidence ?? false;
  const loadYarnCacheIndex = allowLocalProjectEvidence
    ? createYarnCacheIndexLoader(input.projectRoot)
    : () => ok(undefined);
  const collectMavenEvidence = createMavenEvidenceCollector({
    fetchArtifact,
    resolveArtifactHost,
    fetchTimeoutMs,
    pomMaxBytes: Math.min(registryMetadataMaxBytes, MAVEN_POM_METADATA_MAX_BYTES),
    jarMaxBytes: Math.min(tarballMaxBytes, MAVEN_JAR_MAX_BYTES),
    offline: input.offline ?? false,
    artifactCache,
    signal: batchCancellation.signal,
    allowedHosts,
    repositoryUrls: input.graph.mavenRepositoryUrls ?? []
  });
  const loadNugetServiceIndex = createNugetServiceIndexLoader({
    fetchArtifact,
    resolveArtifactHost,
    fetchTimeoutMs,
    registryMetadataMaxBytes,
    offline: input.offline ?? false,
    artifactCache,
    signal: batchCancellation.signal,
    allowedHosts
  });

  const collectNext = async (): Promise<void> => {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= total) {
        return;
      }

      const node = input.graph.nodes[index];
      if (!node) {
        return;
      }

      const collected = await collectNodeEvidence({
        node,
        projectRoot: input.projectRoot,
        allowLocalProjectEvidence,
        allowProjectContainedGoReplacementEvidence,
        ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
        fetchArtifact,
        npmFetchArtifact,
        resolveArtifactHost,
        fetchTimeoutMs,
        registryMetadataMaxBytes,
        tarballMaxBytes,
        installedPackageJsonMaxBytes,
        offline: input.offline ?? false,
        artifactCache,
        signal: batchCancellation.signal,
        npmRegistryUrl: input.npmRegistryUrl,
        allowedHosts,
        loadYarnCacheIndex,
        collectMavenEvidence,
        loadNugetServiceIndex,
        cargoGitHubArchiveEvidenceCache
      });

      if (!collected.ok) {
        if (isRecoverableRemoteEvidenceError(collected.error)) {
          evidence[index] = unavailableRemoteEvidence({
            packageId: node.id,
            error: collected.error
          });
          completed += 1;
          input.progress?.({
            completed,
            total,
            packageId: node.id,
            concurrency: workerCount
          });
          continue;
        }

        const previousFailure = failure as { index: number; error: OhriskError } | undefined;
        if (isCollectionAbortedError(collected.error)) {
          if (!previousFailure) {
            failure = {
              index,
              error: collected.error
            };
            batchCancellation.abort();
          }
          // In-flight sibling work was cancelled after an earlier fatal. Its
          // failure is a consequence of that cancellation and must never
          // replace the representative error.
          return;
        }
        if (!previousFailure || index < previousFailure.index) {
          failure = {
            index,
            error: collected.error
          };
          batchCancellation.abort();
        }
        return;
      }

      evidence[index] = collected.value;
      completed += 1;
      input.progress?.({
        completed,
        total,
        packageId: node.id,
        concurrency: workerCount
      });
    }
  };

  try {
    await Promise.all(Array.from({ length: workerCount }, () => collectNext()));
    artifactCache?.maintain({ signal: batchCancellation.signal });
  } finally {
    batchCancellation.dispose();
  }

  if (failure) {
    return err(failure.error);
  }

  return ok(evidence);
}

export async function fetchMavenCentralModelPoms(input: {
  requests: MissingExternalMavenPom[];
  fetchArtifact?: ArtifactFetcher;
  resolveArtifactHost?: ArtifactHostResolver;
  fetchTimeoutMs?: number;
  pomMaxBytes?: number;
  offline?: boolean;
  cacheDir?: string;
  signal?: AbortSignal;
}): Promise<Result<RemoteMavenModelPom[], OhriskError>> {
  if (input.requests.length === 0) {
    return ok([]);
  }

  const uncachedArtifactHostResolver = input.resolveArtifactHost
    ?? (input.fetchArtifact ? undefined : defaultArtifactHostResolver);
  const resolveArtifactHost = uncachedArtifactHostResolver
    ? createCachingArtifactHostResolver(uncachedArtifactHostResolver)
    : undefined;
  const fetchArtifact = input.fetchArtifact
    ?? createDefaultArtifactFetcher(resolveArtifactHost ?? defaultArtifactHostResolver);
  const artifactCache = input.cacheDir ? createArtifactCache(input.cacheDir) : undefined;
  const documents: RemoteMavenModelPom[] = [];

  try {
    for (const request of input.requests) {
      const repositoryPath = mavenPomRepositoryPath(request);
      if (!repositoryPath) {
        return err(createError({
          code: "MAVEN_POM_PARSE_FAILED",
          category: "unsupported_input",
          message: "Remote Maven parent or BOM coordinates were not safe exact repository coordinates.",
          details: {
            dependency: request.dependency,
            reason: "unsafe_remote_maven_coordinates"
          }
        }));
      }

      const pomUrl = `${MAVEN_CENTRAL_BASE_URL}/${repositoryPath}`;
      const pomBytes = await readRemoteArtifactBytes({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        packageId: request.dependency,
        url: pomUrl,
        blockedMessage: "Maven Central parent or BOM URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve Maven Central host for parent or BOM metadata.",
        fetchFailureMessage: "Failed to fetch Maven Central parent or BOM POM metadata.",
        tooLargeMessage: "Maven Central parent or BOM POM exceeded the maximum supported size.",
        unreadableMessage: "Maven Central parent or BOM POM did not expose a readable body stream.",
        offlineMissMessage: "Offline mode could not find Maven parent or BOM metadata in the artifact cache.",
        details: {
          registryUrl: pomUrl,
          coordinates: request.dependency,
          usage: request.usage
        },
        maxBytes: input.pomMaxBytes ?? MAVEN_POM_METADATA_MAX_BYTES,
        fetchArtifact,
        resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs ?? ARTIFACT_FETCH_TIMEOUT_MS,
        offline: input.offline ?? false,
        artifactCache,
        signal: input.signal ?? new AbortController().signal,
        allowedHosts: new Set(),
        permittedHosts: MAVEN_CENTRAL_HOSTS,
        urlDetailKey: "registryUrl"
      });
      if (!pomBytes.ok) {
        return pomBytes;
      }

      const text = pomBytes.value.toString("utf8");
      const identity = parseMavenPomLicenseMetadata({
        packageId: request.dependency,
        requested: request,
        source: pomUrl,
        text
      });
      if (!identity.ok) {
        return identity;
      }

      documents.push({ ...request, source: pomUrl, text });
    }

    return ok(documents);
  } finally {
    artifactCache?.maintain(input.signal ? { signal: input.signal } : {});
  }
}

function normalizeEvidenceConcurrency(value: number | undefined, total: number): number {
  if (value === undefined) {
    return Math.min(DEFAULT_EVIDENCE_CONCURRENCY, total);
  }

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(1, Math.trunc(value)), total);
}
