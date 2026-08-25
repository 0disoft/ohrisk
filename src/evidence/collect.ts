import { createHash, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  type Stats
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import {
  artifactCacheMetadataFromHeaders,
  createArtifactCache,
  type ArtifactCache,
  type ArtifactCacheEntry,
  type ArtifactCacheResponseMetadata
} from "./cache";
import {
  artifactBodyLimitDetails,
  cancelReadableBody,
  readResponseBodyWithLimit,
  type ArtifactFetchResponse,
  type ArtifactFetcher
} from "./artifact-response";
import {
  BlockedArtifactRemoteAddressError,
  blockedRemoteArtifactHostReason,
  createCachingArtifactHostResolver,
  createDefaultArtifactFetcher,
  defaultArtifactHostResolver,
  isExplicitlyAllowedArtifactHost,
  normalizeAllowedArtifactHosts,
  normalizeUrlHostname,
  shouldResolveRemoteArtifactHost,
  withRegistryAuthorization,
  type ArtifactHostResolution,
  type ArtifactHostResolver
} from "./artifact-transport";
import {
  parseHttpUrl,
  redactUrlCredentialsInDetails,
  safeErrorCauseForDetails,
  safeOptionalUrlForErrorDetails,
  safeUrlForErrorDetails
} from "./artifact-url";
import {
  abortableDelay,
  BatchCancellation,
  isAbortErrorLike,
  isCollectionAbortedError
} from "./cancellation";
import { collectCargoCrateEvidence } from "./cargo-crate";
import { collectRegisteredEcosystemEvidence } from "../ecosystems/registry";
import {
  collectGoModuleZipEvidence,
  readChecksumVerifiedGoModuleRequirements
} from "./go-module-zip";
import {
  GO_MODULE_PROXY_BASE_URL,
  goModuleProxyModUrl,
  goModuleProxyZipUrl,
  remoteGoModuleCoordinates
} from "./go-proxy-url";
import { collectHackageCabalEvidence } from "./hackage-package";
import { collectLocalPackageEvidence } from "./local-package";
import {
  resolveExistingLocalArtifactPath,
  resolveTrustedWorkspaceRoot
} from "./local-artifact-path";
import { collectMavenJarEvidence } from "./maven-jar";
import { collectNugetNupkgEvidence } from "./nuget-nupkg";
import {
  parseSupportedIntegrityEntries,
  sha256HexIntegrity,
  verifyPackageIntegrity
} from "./package-integrity";
import {
  normalizeNugetVersion,
  parseNugetCatalogPackage,
  parseNugetPackageVersions,
  parseNugetRegistrationIndex,
  parseNugetRegistrationPage,
  parseNugetServiceIndex,
  type NugetServiceEndpoints
} from "./nuget-registry";
import type { MissingExternalMavenPom } from "../graph/java-maven-pom";
import {
  MAVEN_LICENSE_PARENT_MAX_DEPTH,
  MAVEN_POM_METADATA_MAX_BYTES,
  mavenCoordinateKey,
  parseMavenPackageCoordinates,
  parseMavenPomLicenseMetadata,
  type MavenPomLicenseMetadata
} from "./maven-package";
import {
  collectPythonDistributionEvidence,
  parsePyPiReleaseMetadata,
  pythonDistributionArchiveFormat
} from "./pypi-package";
import { collectPubTarballEvidence, collectTarballEvidence } from "./tarball";
import { collectRemoteZigTarballEvidence } from "./zig-package";
import {
  collectRubyGemArchiveEvidence,
  parseRubyGemsVersionMetadata,
  rubyGemsVersionMetadataUrl
} from "./rubygems-package";
import type { LicenseEvidence } from "./types";
import { collectZipPackageEvidence } from "./zip-package";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { parseZigHash } from "../graph/zig-zon";
import { createError, type OhriskError } from "../shared/errors";
import {
  mavenPomRepositoryPath,
  type MavenCoordinates
} from "../shared/maven-repository";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";

export { goModuleProxyModUrl, goModuleProxyZipUrl } from "./go-proxy-url";
export {
  secureArtifactLookup,
  selectSecureArtifactLookupResponse,
  validateArtifactSocketRemoteAddress
} from "./artifact-transport";
export type { ArtifactHostResolver } from "./artifact-transport";
export type { ArtifactFetcher } from "./artifact-response";

type RemoteArtifactRead = {
  bytes: Buffer;
  cacheMetadata: ArtifactCacheResponseMetadata;
  notModified: boolean;
};

type RemoteArtifactFetchPolicy = {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  message: string;
  resolveFailureMessage: string;
  details: Record<string, unknown>;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
};

type YarnCacheIndex = {
  cacheDir: string;
  filenames: string[];
};

type YarnCacheIndexLoader = () => Result<YarnCacheIndex | undefined, OhriskError>;
type MavenEvidenceCollector = (
  node: DependencyNode
) => Promise<Result<LicenseEvidence, OhriskError>>;
type NugetServiceIndexLoader = (
  packageId: string
) => Promise<Result<NugetServiceEndpoints, OhriskError>>;

type MavenRepositoryEndpoint = {
  baseUrl: string;
  label: string;
  permittedHosts: ReadonlySet<string>;
};

type MavenPomLookup = {
  metadata: MavenPomLicenseMetadata;
  repository: MavenRepositoryEndpoint;
};

export type EvidenceCollectionProgress = {
  completed: number;
  total: number;
  packageId: string;
  concurrency: number;
};

export type RemoteMavenModelPom = MissingExternalMavenPom & {
  source: string;
  text: string;
};

const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;
const REGISTRY_METADATA_MAX_BYTES = 10 * 1024 * 1024;
const PACKAGE_TARBALL_MAX_BYTES = 100 * 1024 * 1024;
const INSTALLED_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const LOCAL_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;
const MAX_ARTIFACT_REDIRECTS = 5;
const DEFAULT_EVIDENCE_CONCURRENCY = 8;
const PYPI_METADATA_HOSTS = new Set(["pypi.org"]);
const PYPI_DISTRIBUTION_HOSTS = new Set(["files.pythonhosted.org"]);
const RUBYGEMS_ORG_HOSTS = new Set(["rubygems.org"]);
const PUB_DEV_ARCHIVE_HOSTS = new Set(["pub.dev"]);
const NUGET_SERVICE_INDEX_URL = "https://api.nuget.org/v3/index.json";
const NUGET_ORG_HOSTS = new Set(["api.nuget.org"]);
const MAVEN_CENTRAL_BASE_URL = "https://repo.maven.apache.org/maven2";
const MAVEN_CENTRAL_HOSTS = new Set(["repo.maven.apache.org"]);
const MAVEN_JAR_MAX_BYTES = 32 * 1024 * 1024;
const MAVEN_CHECKSUM_MAX_BYTES = 256;
const GO_MODULE_PROXY_HOSTS = new Set(["proxy.golang.org", "storage.googleapis.com"]);
const GO_MODULE_MOD_MAX_BYTES = 2 * 1024 * 1024;
const GO_MODULE_TRANSIENT_FETCH_ATTEMPTS = 2;
const GO_MODULE_TRANSIENT_RETRY_DELAY_MS = 200;

const CARGO_CRATES_IO_SOURCES = new Set([
  "registry+https://github.com/rust-lang/crates.io-index",
  "registry+https://index.crates.io/"
]);
const CARGO_CRATE_BASE_URL = "https://static.crates.io/crates";
const CARGO_CRATE_HOSTS = new Set(["static.crates.io"]);
const HACKAGE_CABAL_HOSTS = new Set(["hackage.haskell.org"]);
const HACKAGE_CABAL_MAX_HISTORICAL_REVISIONS = 64;
const HACKAGE_CABAL_MAX_BYTES = 1024 * 1024;

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
        loadNugetServiceIndex
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

function isRecoverableRemoteEvidenceError(error: OhriskError): boolean {
  if (isCollectionAbortedError(error)) {
    return false;
  }
  return (
    error.category === "network"
    && (
      error.code === "REGISTRY_METADATA_FETCH_FAILED"
      || error.code === "TARBALL_FETCH_FAILED"
    )
  );
}

function unavailableRemoteEvidence(input: {
  packageId: string;
  error: OhriskError;
}): LicenseEvidence {
  const diagnostic = remoteEvidenceFailureDiagnostic(input.error);
  return {
    packageId: input.packageId,
    files: [],
    source: "unavailable",
    warnings: [
      `Package evidence could not be fetched (${input.error.code}): ${input.error.message}${
        diagnostic ? ` (${diagnostic})` : ""
      }`
    ]
  };
}

function remoteEvidenceFailureDiagnostic(error: OhriskError): string | undefined {
  const cause = typeof error.details?.cause === "string" ? error.details.cause : undefined;
  const timeout = cause?.match(/\btimed out after (\d+)ms\b/i);
  return timeout?.[1] ? `timeout after ${timeout[1]}ms` : undefined;
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

async function collectNodeEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  allowLocalProjectEvidence: boolean;
  allowProjectContainedGoReplacementEvidence: boolean;
  workspaceRoot?: string;
  fetchArtifact: ArtifactFetcher;
  npmFetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  installedPackageJsonMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
  loadYarnCacheIndex: YarnCacheIndexLoader;
  collectMavenEvidence: MavenEvidenceCollector;
  loadNugetServiceIndex: NugetServiceIndexLoader;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const projectContainedGoReplacementEvidence =
    !input.allowLocalProjectEvidence
    && input.allowProjectContainedGoReplacementEvidence
    && input.node.ecosystem === "go"
    && input.node.resolved !== undefined
    && !input.node.resolved.startsWith("go-module:")
      ? collectRegisteredEcosystemEvidence({
          node: input.node,
          projectRoot: input.projectRoot
        })
      : undefined;
  if (projectContainedGoReplacementEvidence) {
    return projectContainedGoReplacementEvidence;
  }

  const hasVerifiedPubArchive = input.node.ecosystem === "pub"
    && input.node.resolved !== undefined
    && input.node.integrity !== undefined;
  const ecosystemEvidence = input.allowLocalProjectEvidence && !hasVerifiedPubArchive
    ? collectRegisteredEcosystemEvidence({
        node: input.node,
        projectRoot: input.projectRoot
      })
    : undefined;
  if (ecosystemEvidence) {
    if (
      input.node.ecosystem === "go"
      && ecosystemEvidence.ok
      && ecosystemEvidence.value.source !== "unavailable"
      && ecosystemEvidence.value.goModuleRequirements === undefined
    ) {
      return collectVerifiedRemoteGoModuleRequirements({
        node: input.node,
        evidence: ecosystemEvidence.value,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }
    if (
      (
        input.node.ecosystem !== "maven"
        && input.node.ecosystem !== "go"
        && input.node.ecosystem !== "cargo"
        && input.node.ecosystem !== "nuget"
        && input.node.ecosystem !== "gem"
        && input.node.ecosystem !== "hackage"
        && input.node.ecosystem !== "zig"
      )
      || !ecosystemEvidence.ok
      || ecosystemEvidence.value.source !== "unavailable"
    ) {
      return ecosystemEvidence;
    }
  }

  const explicitLocalPath = input.allowLocalProjectEvidence && input.node.resolved
    ? resolveLocalArtifact({
      packageId: input.node.id,
      resolved: input.node.resolved,
      integrity: input.node.integrity,
      projectRoot: input.projectRoot,
      workspaceRoot: input.workspaceRoot
    })
    : ok(undefined);

  if (!explicitLocalPath.ok) {
    return err(explicitLocalPath.error);
  }

  if (explicitLocalPath.value) {
    return collectLocalPathEvidence({
      node: input.node,
      projectRoot: input.projectRoot,
      workspaceRoot: input.workspaceRoot,
      localPath: explicitLocalPath.value,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  const nodeModulesPath = input.allowLocalProjectEvidence
    ? findNodeModulesPackage({
        node: input.node,
        projectRoot: input.projectRoot,
        packageJsonMaxBytes: input.installedPackageJsonMaxBytes
      })
    : undefined;
  if (nodeModulesPath) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  const yarnCacheEvidence = input.allowLocalProjectEvidence
    ? collectYarnCachePackageEvidence({
        node: input.node,
        loadYarnCacheIndex: input.loadYarnCacheIndex,
        zipMaxBytes: input.tarballMaxBytes
      })
    : ok(undefined);
  if (!yarnCacheEvidence.ok) {
    return err(yarnCacheEvidence.error);
  }

  if (yarnCacheEvidence.value) {
    return ok(yarnCacheEvidence.value);
  }

  if (input.node.ecosystem === "pypi") {
    if (!input.node.resolved) {
      return collectPyPiReleaseEvidence({
        node: input.node,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        registryMetadataMaxBytes: input.registryMetadataMaxBytes,
        artifactMaxBytes: input.tarballMaxBytes,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }

    if (isHttpUrl(input.node.resolved)) {
      const artifactFilename = remoteArtifactFilename(input.node.resolved);
      if (!artifactFilename || !pythonDistributionArchiveFormat(artifactFilename)) {
        return ok(unsupportedRemoteEcosystemEvidence({
          node: input.node,
          reason: "The resolved Python package URL did not identify a supported wheel or source distribution."
        }));
      }

      return collectRemotePythonDistributionEvidence({
        node: input.node,
        resolved: input.node.resolved,
        artifactFilename,
        ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        artifactMaxBytes: input.tarballMaxBytes,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }

    return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
  }

  if (input.node.ecosystem === "maven") {
    return input.collectMavenEvidence(input.node);
  }

  if (input.node.ecosystem === "gem") {
    return collectRemoteRubyGemEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "go") {
    return collectRemoteGoModuleEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "cargo") {
    return collectRemoteCargoCrateEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "nuget") {
    return collectRemoteNugetPackageEvidence({
      node: input.node,
      allowLocalProjectEvidence: input.allowLocalProjectEvidence,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      loadServiceIndex: input.loadNugetServiceIndex
    });
  }

  if (
    input.node.ecosystem === "hackage"
    && input.node.resolved
    && input.node.integrity
  ) {
    return collectRemoteHackageCabalEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      metadataMaxBytes: Math.min(input.registryMetadataMaxBytes, HACKAGE_CABAL_MAX_BYTES),
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "pub" && input.node.resolved) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: PUB_DEV_ARCHIVE_HOSTS,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Dart pub package archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the pub.dev package archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(input.node.resolved)
        }
      },
      collectEvidence: (tarball) => collectPubTarballEvidence({
        packageId: input.node.id,
        packageName: input.node.name,
        version: input.node.version,
        tarball
      })
    });
  }

  if (
    input.node.ecosystem === "zig"
    && input.node.resolved
    && input.node.integrity
    && parseZigHash(input.node.integrity) !== null
  ) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      integrity: input.node.integrity,
      skipIntegrityCheck: true,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Zig package archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the Zig package archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(input.node.resolved)
        }
      },
      collectEvidence: (tarball) => collectRemoteZigTarballEvidence({
        packageId: input.node.id,
        packageName: input.node.name,
        tarball,
        expectedHash: input.node.integrity!
      })
    });
  }

  if (input.node.ecosystem === "npm" && shouldCollectNpmRegistryEvidence({
    node: input.node,
    npmRegistryUrl: input.npmRegistryUrl
  })) {
    return collectNpmRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.npmFetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      npmRegistryUrl: input.npmRegistryUrl,
      allowedHosts: input.allowedHosts
    });
  }

  const resolved = input.node.resolved;
  if (input.node.ecosystem === "npm" && resolved && isHttpUrl(resolved)) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved,
      ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
      fetchArtifact: input.npmFetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
}

async function collectRemoteHackageCabalEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  metadataMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const resolved = input.node.resolved;
  if (!resolved || !input.node.integrity) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "The Stack lockfile did not provide checksum-pinned Hackage Cabal metadata."
    }));
  }

  const currentCabalBytes = await readRemoteHackageCabalBytes({
    ...input,
    packageId: input.node.id,
    url: resolved
  });
  if (!currentCabalBytes.ok) {
    return err(currentCabalBytes.error);
  }

  const currentIntegrity = verifyPackageIntegrity({
    packageId: input.node.id,
    resolvedDetail: safeUrlForErrorDetails(resolved),
    integrity: input.node.integrity,
    artifact: currentCabalBytes.value
  });

  let cabalBytes = currentCabalBytes.value;
  let cabalUrl = resolved;
  if (!currentIntegrity.ok) {
    if (!isPackageIntegrityMismatch(currentIntegrity.error)) {
      return err(currentIntegrity.error);
    }

    const historicalCabal = await findChecksumPinnedHackageCabalRevision({
      ...input,
      packageId: input.node.id,
      packageName: input.node.name,
      version: input.node.version,
      integrity: input.node.integrity
    });
    if (!historicalCabal.ok) {
      return err(historicalCabal.error);
    }
    if (!historicalCabal.value) {
      return ok({
        packageId: input.node.id,
        files: [],
        source: "unavailable",
        warnings: [
          "Locked Hackage Cabal metadata is not the current public revision; mismatched bytes were not trusted."
        ]
      });
    }

    cabalBytes = historicalCabal.value.bytes;
    cabalUrl = historicalCabal.value.url;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(cabalBytes);
  } catch {
    return err(createError({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      message: "Hackage Cabal metadata was not valid UTF-8.",
      details: {
        packageId: input.node.id,
        registryUrl: safeUrlForErrorDetails(cabalUrl)
      }
    }));
  }

  return collectHackageCabalEvidence({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    text
  });
}

async function findChecksumPinnedHackageCabalRevision(input: {
  packageId: string;
  packageName: string;
  version: string;
  integrity: string;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  metadataMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<{ bytes: Buffer; url: string } | undefined, OhriskError>> {
  for (let revision = 0; revision < HACKAGE_CABAL_MAX_HISTORICAL_REVISIONS; revision += 1) {
    const url = hackageCabalRevisionUrl(input.packageName, input.version, revision);
    if (!url) {
      return ok(undefined);
    }

    const candidate = await readRemoteHackageCabalBytes({ ...input, url });
    if (!candidate.ok) {
      if (candidate.error.details?.status === 404) {
        return ok(undefined);
      }
      if (input.offline && candidate.error.details?.reason === "offline_cache_miss") {
        continue;
      }
      return err(candidate.error);
    }

    const integrity = verifyPackageIntegrity({
      packageId: input.packageId,
      resolvedDetail: safeUrlForErrorDetails(url),
      integrity: input.integrity,
      artifact: candidate.value
    });
    if (integrity.ok) {
      return ok({ bytes: candidate.value, url });
    }
    if (!isPackageIntegrityMismatch(integrity.error)) {
      return err(integrity.error);
    }
  }

  return ok(undefined);
}

function readRemoteHackageCabalBytes(input: {
  packageId: string;
  url: string;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  metadataMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<Buffer, OhriskError>> {
  return readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.packageId,
    url: input.url,
    blockedMessage: "Hackage Cabal metadata URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the Hackage metadata host.",
    fetchFailureMessage: "Failed to fetch Hackage Cabal metadata.",
    tooLargeMessage: "Hackage Cabal metadata exceeded the maximum supported size.",
    unreadableMessage: "Hackage Cabal metadata did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find Hackage Cabal metadata in the artifact cache.",
    details: { registryUrl: input.url },
    maxBytes: input.metadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: HACKAGE_CABAL_HOSTS,
    urlDetailKey: "registryUrl"
  });
}

function hackageCabalRevisionUrl(
  packageName: string,
  version: string,
  revision: number
): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(packageName)
      || !/^[0-9]+(?:\.[0-9]+)*$/.test(version)
      || !Number.isSafeInteger(revision)
      || revision < 0) {
    return undefined;
  }
  return `https://hackage.haskell.org/package/${packageName}-${version}/revision/${revision}.cabal`;
}

function isPackageIntegrityMismatch(error: OhriskError): boolean {
  return Array.isArray(error.details?.computed);
}

function shouldCollectNpmRegistryEvidence(input: {
  node: DependencyNode;
  npmRegistryUrl: string | undefined;
}): boolean {
  if (!input.node.resolved) {
    return true;
  }
  if (input.node.direct) {
    return false;
  }

  const resolvedUrl = parseHttpUrl(input.node.resolved);
  const registryUrl = parseHttpUrl(input.npmRegistryUrl ?? "https://registry.npmjs.org");
  return resolvedUrl?.protocol === "https:"
    && registryUrl?.protocol === "https:"
    && normalizeUrlHostname(resolvedUrl.hostname) === normalizeUrlHostname(registryUrl.hostname);
}

function collectLocalPathEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  workspaceRoot: string | undefined;
  localPath: string;
  tarballMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  if (!existsSync(input.localPath)) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Resolved package artifact does not exist.",
        details: {
          packageId: input.node.id,
          resolved: safeOptionalUrlForErrorDetails(input.node.resolved),
          artifactPath: safeUrlForErrorDetails(input.localPath)
        }
      })
    );
  }

  const trustedLocalPath = resolveExistingLocalArtifactPath({
    packageId: input.node.id,
    resolved: input.node.resolved,
    integrity: input.node.integrity,
    projectRoot: input.projectRoot,
    workspaceRoot: input.workspaceRoot,
    artifactPath: input.localPath
  });

  if (!trustedLocalPath.ok) {
    return err(trustedLocalPath.error);
  }

  const artifactStats = readLocalArtifactStats({
    filePath: trustedLocalPath.value,
    packageId: input.node.id,
    resolved: input.node.resolved
  });

  if (!artifactStats.ok) {
    return err(artifactStats.error);
  }

  if (artifactStats.value.isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: trustedLocalPath.value
    });
  }

  if (artifactStats.value.size > input.tarballMaxBytes) {
    return err(localArtifactTooLargeError({
      packageId: input.node.id,
      resolved: input.node.resolved,
      artifactPath: trustedLocalPath.value,
      maxBytes: input.tarballMaxBytes,
      observedBytes: artifactStats.value.size
    }));
  }

  const tarball = readLocalArtifactFileWithLimit({
    filePath: trustedLocalPath.value,
    packageId: input.node.id,
    resolved: input.node.resolved,
    maxBytes: input.tarballMaxBytes
  });

  if (!tarball.ok) {
    return err(tarball.error);
  }

  const verified = verifyPackageIntegrity({
    packageId: input.node.id,
    resolvedDetail: safeOptionalUrlForErrorDetails(input.node.resolved),
    integrity: input.node.integrity,
    artifact: tarball.value
  });

  if (!verified.ok) {
    return err(verified.error);
  }

  const evidence = collectTarballEvidence({
    packageId: input.node.id,
    tarball: tarball.value
  });

  if (!evidence.ok) {
    return err(evidence.error);
  }

  return ok(addIntegrityWarningWhenUnverified({
    evidence: evidence.value,
    integrity: input.node.integrity
  }));
}

function createNugetServiceIndexLoader(input: {
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): NugetServiceIndexLoader {
  let pending: Promise<Result<NugetServiceEndpoints, OhriskError>> | undefined;
  return (packageId) => {
    pending ??= (async () => {
      const bytes = await readNugetRegistryBytes({
        packageId,
        url: NUGET_SERVICE_INDEX_URL,
        label: "service index",
        maxBytes: input.registryMetadataMaxBytes,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
      return bytes.ok
        ? parseNugetServiceIndex({ packageId, text: bytes.value.toString("utf8") })
        : bytes;
    })();
    return pending;
  };
}

async function collectRemoteNugetPackageEvidence(input: {
  node: DependencyNode;
  allowLocalProjectEvidence: boolean;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  loadServiceIndex: NugetServiceIndexLoader;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(input.node.name)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "NuGet package ID was not safe for the public nuget.org V3 API."
    }));
  }
  if (!normalizeNugetVersion(input.node.version)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "NuGet dependency version was not a safe exact version."
    }));
  }
  const lockDigest = input.node.integrity
    ? parseSupportedIntegrityEntries(input.node.integrity)
      .find((entry) => entry.algorithm === "sha512")?.digest
    : undefined;
  if (!lockDigest) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [nugetMissingIntegrityWarning(input.allowLocalProjectEvidence)]
    });
  }

  const service = await input.loadServiceIndex(input.node.id);
  if (!service.ok) {
    return service;
  }
  const lowerName = input.node.name.toLowerCase();
  const encodedName = encodeURIComponent(lowerName);
  const versionsUrl = `${service.value.packageBaseUrl}${encodedName}/index.json`;
  const versionsBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: versionsUrl,
    label: "package version index",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!versionsBytes.ok) {
    return versionsBytes;
  }
  const normalizedVersion = parseNugetPackageVersions({
    packageId: input.node.id,
    packageName: input.node.name,
    requestedVersion: input.node.version,
    text: versionsBytes.value.toString("utf8")
  });
  if (!normalizedVersion.ok) {
    return normalizedVersion;
  }

  const encodedVersion = encodeURIComponent(normalizedVersion.value);
  const packageContentUrl = `${service.value.packageBaseUrl}${encodedName}/${encodedVersion}/${encodedName}.${encodedVersion}.nupkg`;
  const registrationUrl = `${service.value.registrationsBaseUrl}${encodedName}/index.json`;
  const registrationBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: registrationUrl,
    label: "registration index",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!registrationBytes.ok) {
    return registrationBytes;
  }
  const lookup = parseNugetRegistrationIndex({
    packageId: input.node.id,
    packageName: input.node.name,
    normalizedVersion: normalizedVersion.value,
    expectedPackageContentUrl: packageContentUrl,
    text: registrationBytes.value.toString("utf8")
  });
  if (!lookup.ok) {
    return lookup;
  }

  let registrationLeaf;
  if (lookup.value.kind === "leaf") {
    registrationLeaf = lookup.value.leaf;
  } else {
    const pageBytes = await readNugetRegistryBytes({
      packageId: input.node.id,
      url: lookup.value.pageUrl,
      label: "registration page",
      maxBytes: input.registryMetadataMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
    if (!pageBytes.ok) {
      return pageBytes;
    }
    const page = parseNugetRegistrationPage({
      packageId: input.node.id,
      packageName: input.node.name,
      normalizedVersion: normalizedVersion.value,
      expectedPackageContentUrl: packageContentUrl,
      text: pageBytes.value.toString("utf8")
    });
    if (!page.ok) {
      return page;
    }
    registrationLeaf = page.value;
  }

  const catalogBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: registrationLeaf.catalogUrl,
    label: "catalog leaf",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!catalogBytes.ok) {
    return catalogBytes;
  }
  const catalog = parseNugetCatalogPackage({
    packageId: input.node.id,
    packageName: input.node.name,
    normalizedVersion: normalizedVersion.value,
    text: catalogBytes.value.toString("utf8")
  });
  if (!catalog.ok) {
    return catalog;
  }
  const catalogDigest = Buffer.from(catalog.value.packageHash, "base64");
  if (
    catalogDigest.length !== lockDigest.length
    || !timingSafeEqual(catalogDigest, lockDigest)
  ) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "NuGet catalog package hash did not match the selected dependency input.",
      details: {
        packageId: input.node.id,
        packageName: input.node.name,
        version: normalizedVersion.value,
        reason: "nuget_catalog_lock_hash_mismatch"
      }
    }));
  }
  if (catalog.value.packageSize > input.artifactMaxBytes) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [
        "NuGet package source was not fetched because the catalog-declared package size exceeded the configured artifact limit."
      ]
    });
  }

  const nupkg = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.node.id,
    url: registrationLeaf.packageContentUrl,
    blockedMessage: "NuGet package content URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the nuget.org package content host.",
    fetchFailureMessage: "Failed to fetch NuGet package content.",
    tooLargeMessage: "NuGet package content exceeded the maximum supported size.",
    unreadableMessage: "NuGet package content did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find NuGet package content in the artifact cache.",
    details: {
      packageName: input.node.name,
      version: normalizedVersion.value
    },
    maxBytes: Math.min(input.artifactMaxBytes, catalog.value.packageSize),
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: NUGET_ORG_HOSTS,
    urlDetailKey: "resolved"
  });
  if (!nupkg.ok) {
    return nupkg;
  }
  return collectNugetNupkgEvidence({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    normalizedVersion: normalizedVersion.value,
    expectedSha512: catalog.value.packageHash,
    expectedSize: catalog.value.packageSize,
    nupkg: nupkg.value,
    artifactMaxBytes: input.artifactMaxBytes
  });
}

async function collectRemoteRubyGemEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = rubyGemsVersionMetadataUrl(input.node.name, input.node.version);
  if (!metadataUrl) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "Ruby gem name or version could not be encoded safely for the fixed RubyGems.org API."
    }));
  }

  const metadataBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.node.id,
    url: metadataUrl,
    blockedMessage: "RubyGems version metadata URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the RubyGems.org metadata host.",
    fetchFailureMessage: "Failed to fetch RubyGems version metadata.",
    tooLargeMessage: "RubyGems version metadata exceeded the maximum supported size.",
    unreadableMessage: "RubyGems version metadata did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find RubyGems version metadata in the artifact cache.",
    details: {
      packageName: input.node.name,
      version: input.node.version,
      registryUrl: metadataUrl
    },
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: RUBYGEMS_ORG_HOSTS,
    urlDetailKey: "registryUrl"
  });
  if (!metadataBytes.ok) return metadataBytes;

  const metadata = parseRubyGemsVersionMetadata({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    registryUrl: metadataUrl,
    text: metadataBytes.value.toString("utf8")
  });
  if (!metadata.ok) return metadata;

  const gem = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.node.id,
    url: metadata.value.gemUrl,
    blockedMessage: "Ruby gem artifact URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the RubyGems.org artifact host.",
    fetchFailureMessage: "Failed to fetch Ruby gem archive.",
    tooLargeMessage: "Ruby gem archive exceeded the maximum supported size.",
    unreadableMessage: "Ruby gem archive did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Ruby gem archive in the artifact cache.",
    details: {
      packageName: input.node.name,
      version: input.node.version,
      resolved: metadata.value.gemUrl
    },
    maxBytes: input.artifactMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: RUBYGEMS_ORG_HOSTS,
    urlDetailKey: "resolved"
  });
  if (!gem.ok) return gem;

  const collected = collectRubyGemArchiveEvidence({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    sha256: metadata.value.sha256,
    gem: gem.value,
    artifactMaxBytes: input.artifactMaxBytes
  });
  if (
    !collected.ok
    && (
      collected.error.code === "ARCHIVE_LIMIT_EXCEEDED"
      || collected.error.code === "ARCHIVE_ENTRY_TYPE_UNSUPPORTED"
    )
  ) {
    return ok(unavailableRemoteArchiveLimitEvidence(
      input.node.id,
      collected.error,
      "Ruby gem"
    ));
  }
  return collected;
}

function nugetMissingIntegrityWarning(allowLocalProjectEvidence: boolean): string {
  if (allowLocalProjectEvidence) {
    return "NuGet package source was not fetched because the selected dependency input did not contain an exact SHA-512 package content hash. Restore the project, then rerun Ohrisk against the local checkout; use --lockfile obj/project.assets.json or a generated packages.lock.json when available.";
  }

  return "NuGet package source was not fetched because this non-local input did not contain an exact SHA-512 package content hash. For a repository URL, commit a generated packages.lock.json with contentHash entries; otherwise clone or extract, restore, and scan the local checkout.";
}

async function readNugetRegistryBytes(input: {
  packageId: string;
  url: string;
  label: string;
  maxBytes: number;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<Buffer, OhriskError>> {
  const response = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.packageId,
    url: input.url,
    blockedMessage: `NuGet ${input.label} URL targets an unsupported or blocked host.`,
    resolveFailureMessage: `Failed to resolve the nuget.org ${input.label} host.`,
    fetchFailureMessage: `Failed to fetch NuGet ${input.label}.`,
    tooLargeMessage: `NuGet ${input.label} exceeded the maximum supported size.`,
    unreadableMessage: `NuGet ${input.label} did not expose a readable body stream.`,
    offlineMissMessage: `Offline mode could not find NuGet ${input.label} in the artifact cache.`,
    details: { registryUrl: input.url },
    maxBytes: input.maxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: NUGET_ORG_HOSTS,
    urlDetailKey: "registryUrl"
  });
  if (!response.ok || !isGzipBytes(response.value)) {
    return response;
  }
  try {
    return ok(gunzipSync(response.value, { maxOutputLength: input.maxBytes }));
  } catch (cause) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: `NuGet ${input.label} gzip response was malformed or exceeded the maximum supported size.`,
      details: {
        packageId: input.packageId,
        registryUrl: safeUrlForErrorDetails(input.url),
        maxBytes: input.maxBytes,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }
}

function isGzipBytes(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function collectRemoteGoModuleEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const coordinates = remoteGoModuleCoordinates(input.node);
  if (!coordinates) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: input.node.resolved
        ? "Go local replacement evidence is unavailable during a remote repository scan."
        : "Go module coordinates were not safe for the fixed public module proxy."
    }));
  }
  const zipChecksum = input.node.integrity && /^h1:[A-Za-z0-9+/]{43}=$/u.test(input.node.integrity)
    ? input.node.integrity
    : undefined;
  let evidence: LicenseEvidence;

  if (!zipChecksum) {
    evidence = {
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [
        "Go module source was not fetched because go.sum did not contain an exact h1 checksum for the module zip."
      ]
    };
  } else {
    const resolved = goModuleProxyZipUrl(coordinates.modulePath, coordinates.version);
    if (!resolved) {
      return ok(unsupportedRemoteEcosystemEvidence({
        node: input.node,
        reason: "Go module path or version could not be encoded safely for the fixed public module proxy."
      }));
    }
    const zip = await readRemoteArtifactBytes({
      code: "TARBALL_FETCH_FAILED",
      packageId: input.node.id,
      url: resolved,
      blockedMessage: "Go module proxy URL targets an unsupported or blocked host.",
      resolveFailureMessage: "Failed to resolve the Go module proxy host.",
      fetchFailureMessage: "Failed to fetch Go module zip.",
      tooLargeMessage: "Go module zip response exceeded the maximum supported size.",
      unreadableMessage: "Go module zip response did not expose a readable body stream.",
      offlineMissMessage: "Offline mode could not find the Go module zip in the artifact cache.",
      details: {
        modulePath: coordinates.modulePath,
        version: coordinates.version,
        proxy: GO_MODULE_PROXY_BASE_URL
      },
      maxBytes: input.artifactMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: GO_MODULE_PROXY_HOSTS,
      urlDetailKey: "resolved",
      transientFetchAttempts: GO_MODULE_TRANSIENT_FETCH_ATTEMPTS,
      transientRetryDelayMs: GO_MODULE_TRANSIENT_RETRY_DELAY_MS
    });
    if (!zip.ok) {
      if (!isGoModuleZipSizeLimitError(zip.error)) {
        return zip;
      }
      evidence = unavailableRemoteEvidence({
        packageId: input.node.id,
        error: zip.error
      });
    } else {
      const collected = collectGoModuleZipEvidence({
        packageId: input.node.id,
        modulePath: coordinates.modulePath,
        version: coordinates.version,
        checksum: zipChecksum,
        zip: zip.value,
        artifactMaxBytes: input.artifactMaxBytes
      });
      if (!collected.ok) {
        return collected;
      }
      evidence = collected.value;
    }
  }

  return collectVerifiedRemoteGoModuleRequirements({
    node: input.node,
    evidence,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
}

function isGoModuleZipSizeLimitError(error: OhriskError): boolean {
  return error.code === "TARBALL_FETCH_FAILED"
    && error.message === "Go module zip response exceeded the maximum supported size."
    && typeof error.details?.maxBytes === "number"
    && typeof error.details?.observedBytes === "number";
}

async function collectVerifiedRemoteGoModuleRequirements(input: {
  node: DependencyNode;
  evidence: LicenseEvidence;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (input.evidence.goModuleRequirements !== undefined) {
    return ok(input.evidence);
  }
  const goModChecksum = input.node.goModIntegrity
    && /^h1:[A-Za-z0-9+/]{43}=$/u.test(input.node.goModIntegrity)
    ? input.node.goModIntegrity
    : undefined;
  if (!goModChecksum) {
    return ok(input.evidence);
  }
  const coordinates = remoteGoModuleCoordinates(input.node);
  if (!coordinates) {
    return ok(input.evidence);
  }
  const goModUrl = goModuleProxyModUrl(coordinates.modulePath, coordinates.version);
  if (!goModUrl) {
    return ok(input.evidence);
  }

  const goMod = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.node.id,
    url: goModUrl,
    blockedMessage: "Go module proxy URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the Go module proxy host.",
    fetchFailureMessage: "Failed to fetch the checksum-identified Go module go.mod.",
    tooLargeMessage: "Go module go.mod response exceeded the maximum supported size.",
    unreadableMessage: "Go module go.mod response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Go module go.mod in the artifact cache.",
    details: {
      modulePath: coordinates.modulePath,
      version: coordinates.version,
      proxy: GO_MODULE_PROXY_BASE_URL
    },
    maxBytes: GO_MODULE_MOD_MAX_BYTES,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: GO_MODULE_PROXY_HOSTS,
    urlDetailKey: "resolved",
    transientFetchAttempts: GO_MODULE_TRANSIENT_FETCH_ATTEMPTS,
    transientRetryDelayMs: GO_MODULE_TRANSIENT_RETRY_DELAY_MS
  });
  if (!goMod.ok) {
    return ok(input.evidence);
  }

  const requirements = readChecksumVerifiedGoModuleRequirements({
    checksum: goModChecksum,
    goMod: goMod.value
  });
  return ok(requirements === undefined
    ? input.evidence
    : { ...input.evidence, goModuleRequirements: requirements });
}

async function collectRemoteCargoCrateEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (!input.node.resolved || !CARGO_CRATES_IO_SOURCES.has(input.node.resolved)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "Cargo Git, path, and non-crates.io registry sources are not fetched during a remote repository scan."
    }));
  }
  if (!input.node.integrity || !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(input.node.integrity)) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [
        "Cargo crate source was not fetched because Cargo.lock did not contain a valid SHA-256 checksum."
      ]
    });
  }
  if (
    !/^[A-Za-z0-9_-]+$/u.test(input.node.name)
    || !/^[A-Za-z0-9.+-]+$/u.test(input.node.version)
  ) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "Cargo crate name or version could not be encoded safely for the fixed crates.io artifact host."
    }));
  }

  const encodedName = encodeURIComponent(input.node.name);
  const encodedVersion = encodeURIComponent(input.node.version);
  const resolved = `${CARGO_CRATE_BASE_URL}/${encodedName}/${encodedName}-${encodedVersion}.crate`;
  const crate = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.node.id,
    url: resolved,
    blockedMessage: "Cargo crate URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the Cargo crate artifact host.",
    fetchFailureMessage: "Failed to fetch Cargo crate archive.",
    tooLargeMessage: "Cargo crate archive response exceeded the maximum supported size.",
    unreadableMessage: "Cargo crate archive response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Cargo crate archive in the artifact cache.",
    details: {
      packageName: input.node.name,
      version: input.node.version,
      registry: CARGO_CRATE_BASE_URL
    },
    maxBytes: input.artifactMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: CARGO_CRATE_HOSTS,
    urlDetailKey: "resolved"
  });
  if (!crate.ok) {
    return crate;
  }

  return collectCargoCrateEvidence({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    integrity: input.node.integrity,
    crate: crate.value,
    artifactMaxBytes: input.artifactMaxBytes
  });
}

function readLocalArtifactStats(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
}): Result<Stats, OhriskError> {
  try {
    return ok(statSync(input.filePath));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to inspect resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      })
    );
  }
}

function readLocalArtifactFileWithLimit(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
  maxBytes: number;
}): Result<Buffer, OhriskError> {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(input.filePath, "r");

    while (true) {
      const readSize = Math.min(
        LOCAL_ARTIFACT_READ_CHUNK_BYTES,
        Math.max(1, input.maxBytes + 1 - observedBytes)
      );
      const chunk = Buffer.alloc(readSize);
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        return ok(Buffer.concat(chunks, observedBytes));
      }

      observedBytes += bytesRead;
      if (observedBytes > input.maxBytes) {
        return err(localArtifactTooLargeError({
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          maxBytes: input.maxBytes,
          observedBytes
        }));
      }

      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      })
    );
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the primary read or size error.
      }
    }
  }
}

function localArtifactTooLargeError(input: {
  packageId: string;
  resolved: string | undefined;
  artifactPath: string;
  maxBytes: number;
  observedBytes: number;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Resolved package artifact exceeded the maximum supported size.",
    details: {
      packageId: input.packageId,
      resolved: safeOptionalUrlForErrorDetails(input.resolved),
      artifactPath: safeUrlForErrorDetails(input.artifactPath),
      ...artifactBodyLimitDetails({
        maxBytes: input.maxBytes,
        observedBytes: input.observedBytes
      })
    }
  });
}

function createMavenEvidenceCollector(input: {
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  jarMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  repositoryUrls: string[];
}): MavenEvidenceCollector {
  const repositories = mavenRepositoryEndpoints(input.repositoryUrls, input.allowedHosts);
  const pomRequests = new Map<
    string,
    Promise<Result<MavenPomLookup, OhriskError>>
  >();

  const loadPom = (
    coordinates: MavenCoordinates
  ): Promise<Result<MavenPomLookup, OhriskError>> => {
    const key = mavenCoordinateKey(coordinates);
    const existing = pomRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = loadMavenPomFromRepositories({
      coordinates,
      repositories,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      pomMaxBytes: input.pomMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
    pomRequests.set(key, request);
    return request;
  };

  return async (node) => {
    const requested = parseMavenPackageCoordinates(node.name, node.version);
    if (!requested) {
      return err(createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "unsupported_input",
        message: "Maven dependency did not contain safe exact repository coordinates.",
        details: {
          packageId: node.id,
          coordinates: node.name,
          version: node.version
        }
      }));
    }

    const visited = new Set<string>();
    let current = requested;
    let artifactRepository: MavenRepositoryEndpoint | undefined;
    for (let depth = 0; depth <= MAVEN_LICENSE_PARENT_MAX_DEPTH; depth += 1) {
      const coordinateKey = mavenCoordinateKey(current);
      if (visited.has(coordinateKey)) {
        return err(createError({
          code: "REGISTRY_METADATA_FETCH_FAILED",
          category: "unsupported_input",
          message: "Maven Central POM license inheritance contains a parent cycle.",
          details: {
            packageId: node.id,
            coordinates: coordinateKey,
            reason: "parent_cycle"
          }
        }));
      }
      visited.add(coordinateKey);

      const metadata = await loadPom(current);
      if (!metadata.ok) {
        return metadata;
      }
      if (depth === 0) {
        artifactRepository = metadata.value.repository;
      }
      if (metadata.value.metadata.licenses.length > 0) {
        return ok({
          packageId: node.id,
          metadataLicense: metadata.value.metadata.licenses.join(" OR "),
          metadataSource: depth === 0
            ? `${metadata.value.repository.label} pom.xml`
            : `${metadata.value.repository.label} parent pom.xml (${coordinateKey})`,
          files: [],
          source: "tarball",
          warnings: []
        });
      }
      if (!metadata.value.metadata.parent) {
        const jarEvidence = artifactRepository
          ? await collectRemoteMavenJarEvidence({
              packageId: node.id,
              coordinates: requested,
              repository: artifactRepository,
              fetchArtifact: input.fetchArtifact,
              resolveArtifactHost: input.resolveArtifactHost,
              fetchTimeoutMs: input.fetchTimeoutMs,
              jarMaxBytes: input.jarMaxBytes,
              offline: input.offline,
              artifactCache: input.artifactCache,
              signal: input.signal,
              allowedHosts: input.allowedHosts
            })
          : ok(undefined);
        if (!jarEvidence.ok) {
          return jarEvidence;
        }
        if (jarEvidence.value) {
          return ok(jarEvidence.value);
        }
        return ok({
          packageId: node.id,
          files: [],
          source: "tarball",
          warnings: [
            `${metadata.value.repository.label} POM and its resolvable parent chain did not declare license names.`
          ]
        });
      }

      current = metadata.value.metadata.parent;
    }

    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven Central POM license inheritance exceeded the maximum supported parent depth.",
      details: {
        packageId: node.id,
        coordinates: mavenCoordinateKey(current),
        reason: "parent_depth",
        maxParentDepth: MAVEN_LICENSE_PARENT_MAX_DEPTH
      }
    }));
  };
}

function mavenRepositoryEndpoints(
  repositoryUrls: string[],
  allowedHosts: ReadonlySet<string>
): MavenRepositoryEndpoint[] {
  const endpoints: MavenRepositoryEndpoint[] = [{
    baseUrl: MAVEN_CENTRAL_BASE_URL,
    label: "Maven Central",
    permittedHosts: MAVEN_CENTRAL_HOSTS
  }];
  const seen = new Set([MAVEN_CENTRAL_BASE_URL]);

  for (const rawUrl of repositoryUrls) {
    const parsed = parseHttpUrl(rawUrl);
    if (
      !parsed
      || parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
    ) {
      continue;
    }
    const host = normalizeUrlHostname(parsed.hostname);
    if (!allowedHosts.has(host)) {
      continue;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    const baseUrl = parsed.toString().replace(/\/$/u, "");
    if (seen.has(baseUrl)) {
      continue;
    }
    seen.add(baseUrl);
    endpoints.push({
      baseUrl,
      label: `Maven repository ${host}`,
      permittedHosts: new Set([host])
    });
  }

  return endpoints;
}

async function loadMavenPomFromRepositories(input: {
  coordinates: MavenCoordinates;
  repositories: MavenRepositoryEndpoint[];
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<MavenPomLookup, OhriskError>> {
  let firstNetworkError: OhriskError | undefined;
  for (const repository of input.repositories) {
    const loaded = await loadMavenPomFromRepository({
      ...input,
      repository
    });
    if (loaded.ok) {
      return ok({ metadata: loaded.value, repository });
    }
    if (loaded.error.category !== "network") {
      return loaded;
    }
    firstNetworkError ??= loaded.error;
  }

  return err(firstNetworkError ?? createError({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    category: "network",
    message: "Failed to fetch Maven POM metadata.",
    details: {
      coordinates: mavenCoordinateKey(input.coordinates),
      reason: "no_permitted_repository"
    }
  }));
}

async function loadMavenPomFromRepository(input: {
  coordinates: MavenCoordinates;
  repository: MavenRepositoryEndpoint;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<MavenPomLicenseMetadata, OhriskError>> {
  const repositoryPath = mavenPomRepositoryPath(input.coordinates);
  const coordinateKey = mavenCoordinateKey(input.coordinates);
  if (!repositoryPath) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven POM coordinates were not safe exact repository coordinates.",
      details: { packageId: coordinateKey, coordinates: coordinateKey }
    }));
  }

  const pomUrl = `${input.repository.baseUrl}/${repositoryPath}`;
  const central = input.repository.baseUrl === MAVEN_CENTRAL_BASE_URL;
  const pomBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: coordinateKey,
    url: pomUrl,
    blockedMessage: "Maven POM URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: central
      ? "Failed to fetch Maven Central POM metadata."
      : "Failed to fetch Maven repository POM metadata.",
    tooLargeMessage: "Maven POM response exceeded the maximum supported size.",
    unreadableMessage: "Maven POM response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find Maven POM metadata in the artifact cache.",
    details: { registryUrl: pomUrl, coordinates: coordinateKey },
    maxBytes: input.pomMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "registryUrl"
  });
  if (!pomBytes.ok) {
    return pomBytes;
  }

  return parseMavenPomLicenseMetadata({
    packageId: coordinateKey,
    requested: input.coordinates,
    source: pomUrl,
    text: pomBytes.value.toString("utf8")
  });
}

async function collectRemoteMavenJarEvidence(input: {
  packageId: string;
  coordinates: MavenCoordinates;
  repository: MavenRepositoryEndpoint;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  jarMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence | undefined, OhriskError>> {
  const pomPath = mavenPomRepositoryPath(input.coordinates);
  if (!pomPath) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven JAR coordinates were not safe exact repository coordinates.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates)
      }
    }));
  }
  const jarPath = pomPath.replace(/\.pom$/u, ".jar");
  const jarUrl = `${input.repository.baseUrl}/${jarPath}`;
  const checksumUrl = `${jarUrl}.sha256`;
  const checksumBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.packageId,
    url: checksumUrl,
    blockedMessage: "Maven JAR checksum URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: "Failed to fetch Maven JAR SHA-256 checksum.",
    tooLargeMessage: "Maven JAR SHA-256 checksum response exceeded the maximum supported size.",
    unreadableMessage: "Maven JAR SHA-256 checksum response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Maven JAR SHA-256 checksum in the artifact cache.",
    details: { registryUrl: checksumUrl, coordinates: mavenCoordinateKey(input.coordinates) },
    maxBytes: MAVEN_CHECKSUM_MAX_BYTES,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "registryUrl"
  });
  if (!checksumBytes.ok) {
    return checksumBytes.error.category === "network"
      ? ok(undefined)
      : checksumBytes;
  }
  const checksum = checksumBytes.value.toString("utf8").trim();
  if (!/^[a-f0-9]{64}$/iu.test(checksum)) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Maven JAR SHA-256 checksum response was malformed.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates),
        reason: "maven_jar_checksum_malformed"
      }
    }));
  }

  const jarBytes = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.packageId,
    url: jarUrl,
    blockedMessage: "Maven JAR URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: "Failed to fetch Maven JAR evidence.",
    tooLargeMessage: "Maven JAR response exceeded the maximum supported size.",
    unreadableMessage: "Maven JAR response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Maven JAR in the artifact cache.",
    details: { resolved: jarUrl, coordinates: mavenCoordinateKey(input.coordinates) },
    maxBytes: input.jarMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "resolved"
  });
  if (!jarBytes.ok) {
    return jarBytes.error.category === "network" ? ok(undefined) : jarBytes;
  }
  const expected = Buffer.from(checksum, "hex");
  const observed = createHash("sha256").update(jarBytes.value).digest();
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Maven JAR did not match its repository SHA-256 checksum.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates),
        reason: "maven_jar_checksum_mismatch"
      }
    }));
  }

  return collectMavenJarEvidence({
    packageId: input.packageId,
    coordinates: input.coordinates,
    jar: jarBytes.value
  });
}

async function collectNpmRegistryTarballEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = npmRegistryPackageVersionUrl(
    input.node.name,
    input.node.version,
    input.npmRegistryUrl
  );
  const metadataBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.node.id,
    url: metadataUrl,
    blockedMessage: "npm registry metadata URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve npm registry metadata host.",
    fetchFailureMessage: "Failed to fetch npm registry metadata.",
    tooLargeMessage: "npm registry metadata response exceeded the maximum supported size.",
    unreadableMessage: "npm registry metadata response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find npm registry metadata in the artifact cache.",
    details: { registryUrl: metadataUrl },
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    urlDetailKey: "registryUrl"
  });
  if (!metadataBytes.ok) {
    return err(metadataBytes.error);
  }

  const metadata = parseRegistryMetadata({
    packageId: input.node.id,
    registryUrl: metadataUrl,
    text: metadataBytes.value.toString("utf8")
  });
  if (!metadata.ok) {
    return err(metadata.error);
  }

  const tarballUrl = readRegistryTarballUrl(metadata.value, input.node.version);
  if (!tarballUrl) {
    return err(
      createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "unsupported_input",
        message: "npm registry metadata did not include a tarball for the requested version.",
        details: {
          packageId: input.node.id,
          registryUrl: metadataUrl,
          version: input.node.version
        }
      })
    );
  }

  return collectRemoteTarballEvidence({
    packageId: input.node.id,
    resolved: tarballUrl,
    ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    tarballMaxBytes: input.tarballMaxBytes,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    urlError: {
      code: "REGISTRY_METADATA_FETCH_FAILED",
      message: "npm registry metadata included an unsupported tarball URL.",
      resolveFailureMessage: "Failed to resolve registry tarball host.",
      details: {
        registryUrl: metadataUrl,
        version: input.node.version,
        tarballUrl
      }
    }
  });
}

async function collectPyPiReleaseEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = pypiPackageVersionUrl(input.node.name, input.node.version);
  const metadataBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.node.id,
    url: metadataUrl,
    blockedMessage: "PyPI release metadata URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve PyPI release metadata host.",
    fetchFailureMessage: "Failed to fetch PyPI release metadata.",
    tooLargeMessage: "PyPI release metadata response exceeded the maximum supported size.",
    unreadableMessage: "PyPI release metadata response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find PyPI release metadata in the artifact cache.",
    details: { registryUrl: metadataUrl },
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: PYPI_METADATA_HOSTS,
    urlDetailKey: "registryUrl"
  });
  if (!metadataBytes.ok) {
    return err(metadataBytes.error);
  }

  const release = parsePyPiReleaseMetadata({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    registryUrl: metadataUrl,
    text: metadataBytes.value.toString("utf8")
  });
  if (!release.ok) {
    return err(release.error);
  }

  if (
    release.value.artifact.size !== undefined
    && release.value.artifact.size > input.artifactMaxBytes
  ) {
    return ok(unavailableOversizedTarballEvidence(input.node.id));
  }

  return collectRemotePythonDistributionEvidence({
    node: input.node,
    resolved: release.value.artifact.url,
    artifactFilename: release.value.artifact.filename,
    integrity: sha256HexIntegrity(release.value.artifact.sha256),
    yanked: release.value.artifact.yanked,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    artifactMaxBytes: input.artifactMaxBytes,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: PYPI_DISTRIBUTION_HOSTS,
    urlError: {
      code: "TARBALL_FETCH_FAILED",
      message: "PyPI release metadata included an unsupported distribution URL.",
      resolveFailureMessage: "Failed to resolve PyPI distribution host.",
      details: {
        registryUrl: metadataUrl,
        version: input.node.version,
        resolved: release.value.artifact.url
      }
    }
  });
}

async function collectRemotePythonDistributionEvidence(input: {
  node: DependencyNode;
  resolved: string;
  artifactFilename: string;
  integrity?: string;
  yanked?: boolean;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
  urlError?: {
    code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
    message: string;
    resolveFailureMessage: string;
    details: Record<string, unknown>;
  };
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const urlError = input.urlError ?? {
    code: "TARBALL_FETCH_FAILED" as const,
    message: "Python distribution URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Python distribution host.",
    details: { resolved: safeUrlForErrorDetails(input.resolved) }
  };
  const urlValidation = validateRemoteArtifactUrl({
    code: urlError.code,
    packageId: input.node.id,
    resolved: input.resolved,
    message: urlError.message,
    details: urlError.details,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (!input.integrity) {
    if (!input.offline) {
      const preflight = await preflightRemoteArtifactFetchTarget({
        code: urlError.code,
        packageId: input.node.id,
        resolved: input.resolved,
        message: urlError.message,
        resolveFailureMessage: urlError.resolveFailureMessage,
        details: urlError.details,
        resolveArtifactHost: input.resolveArtifactHost,
        timeoutMs: input.fetchTimeoutMs,
        allowedHosts: input.allowedHosts,
        ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
      });
      if (!preflight.ok) {
        return err(preflight.error);
      }
    }
    return ok(unavailableUnverifiedRemoteTarballEvidence(input.node.id));
  }

  try {
    const artifact = await readRemoteArtifactBytes({
      code: urlError.code,
      packageId: input.node.id,
      url: input.resolved,
      blockedMessage: urlError.message,
      resolveFailureMessage: urlError.resolveFailureMessage,
      fetchFailureMessage: "Failed to fetch Python distribution.",
      tooLargeMessage: "Python distribution response exceeded the maximum supported size.",
      unreadableMessage: "Python distribution response did not expose a readable body stream.",
      offlineMissMessage: "Offline mode could not find the Python distribution in the artifact cache.",
      details: urlError.details,
      maxBytes: input.artifactMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {}),
      urlDetailKey: "resolved"
    });
    if (!artifact.ok) {
      if (isPackageArtifactTooLargeError(artifact.error)) {
        return ok(unavailableOversizedTarballEvidence(input.node.id));
      }
      return err(artifact.error);
    }

    const verified = verifyPackageIntegrity({
      packageId: input.node.id,
      resolvedDetail: safeOptionalUrlForErrorDetails(input.resolved),
      integrity: input.integrity,
      artifact: artifact.value
    });
    if (!verified.ok) {
      return err(verified.error);
    }

    const collected = collectPythonDistributionEvidence({
      packageId: input.node.id,
      packageName: input.node.name,
      version: input.node.version,
      artifactFilename: input.artifactFilename,
      artifactBytes: artifact.value,
      artifactMaxBytes: input.artifactMaxBytes,
      ...(input.yanked !== undefined ? { yanked: input.yanked } : {})
    });
    if (!collected.ok && collected.error.code === "ARCHIVE_LIMIT_EXCEEDED") {
      return ok(unavailableRemoteArchiveLimitEvidence(
        input.node.id,
        collected.error,
        "Python distribution"
      ));
    }
    return collected;
  } catch (cause) {
    return err(createRemoteArtifactExceptionError({
      code: urlError.code,
      message: "Failed to fetch Python distribution.",
      blockedMessage: urlError.message,
      details: {
        packageId: input.node.id,
        resolved: safeUrlForErrorDetails(input.resolved),
        ...urlError.details
      },
      cause
    }));
  }
}

function parseRegistryMetadata(input: {
  packageId: string;
  registryUrl: string;
  text: string;
}): Result<unknown, OhriskError> {
  try {
    return ok(JSON.parse(input.text) as unknown);
  } catch (cause) {
    return err(
      createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "unsupported_input",
        message: "npm registry metadata was not valid JSON.",
        details: {
          packageId: input.packageId,
          registryUrl: input.registryUrl,
          cause: safeErrorCauseForDetails(cause)
        }
      })
    );
  }
}

function resolveLocalArtifact(input: {
  packageId: string;
  resolved: string;
  integrity: string | undefined;
  projectRoot: string;
  workspaceRoot: string | undefined;
}): Result<string | undefined, OhriskError> {
  let localPath: string | undefined;

  if (input.resolved.startsWith("file://")) {
    const filePath = resolveFileUrl(input.resolved);
    if (filePath) {
      localPath = filePath;
    }
  }

  if (!localPath && input.resolved.startsWith("file:")) {
    const specifier = decodeFilePathSpecifier(input.resolved.slice("file:".length));
    localPath = path.resolve(input.projectRoot, specifier);
  }

  if (!localPath && input.resolved.startsWith("workspace:")) {
    const specifier = decodeFilePathSpecifier(input.resolved.slice("workspace:".length));
    if (isWorkspaceLocalPathSpecifier(specifier)) {
      localPath = path.resolve(input.projectRoot, specifier);
    }
  }

  if (!localPath && (input.resolved.startsWith(".") || path.isAbsolute(input.resolved))) {
    localPath = path.resolve(input.projectRoot, input.resolved);
  }

  if (!localPath) {
    return ok(undefined);
  }

  const artifactPath = path.resolve(localPath);
  // Containment is checked after existence with canonical paths in
  // resolveExistingLocalArtifactPath. A lexical check here misclassifies
  // macOS /var -> /private/var aliases and other filesystem aliases.
  return ok(artifactPath);
}

function resolveFileUrl(value: string): string | undefined {
  try {
    return fileURLToPath(value);
  } catch {
    return undefined;
  }
}

function decodeFilePathSpecifier(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWorkspaceLocalPathSpecifier(value: string): boolean {
  return value.startsWith(".")
    || value.startsWith("/")
    || value.includes("/")
    || value.includes("\\");
}

function findNodeModulesPackage(input: {
  node: DependencyNode;
  projectRoot: string;
  packageJsonMaxBytes: number;
}): string | undefined {
  const packageNames = [...new Set([...(input.node.installNames ?? []), input.node.name])];

  for (const packageName of packageNames) {
    for (const packagePath of resolveNodeModulesPackageCandidates({
      packageName,
      version: input.node.version,
      projectRoot: input.projectRoot
    })) {
      if (
        existsSync(packagePath)
        && isReadableDirectory(packagePath)
        && installedPackageMatchesNode({
          node: input.node,
          packagePath,
          maxBytes: input.packageJsonMaxBytes
        })
      ) {
        return packagePath;
      }
    }
  }

  return undefined;
}

function resolveNodeModulesPackageCandidates(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string[] {
  const segments = nodeModulesPackageSegments(input.packageName);
  if (!segments) {
    return [];
  }

  const candidates = [path.join(input.projectRoot, "node_modules", ...segments)];
  const bunStoreSegment = bunIsolatedStoreSegment(input.packageName, input.version);
  if (bunStoreSegment) {
    candidates.push(path.join(
      input.projectRoot,
      "node_modules",
      ".bun",
      bunStoreSegment,
      "node_modules",
      ...segments
    ));
  }
  return candidates;
}

function bunIsolatedStoreSegment(packageName: string, version: string): string | undefined {
  if (
    version === ""
    || version === "."
    || version === ".."
    || version.includes("/")
    || version.includes("\\")
    || version.includes(":")
  ) {
    return undefined;
  }
  return `${packageName.replaceAll("/", "+")}@${version}`;
}

function nodeModulesPackageSegments(packageName: string): string[] | undefined {
  if (packageName === "" || packageName.includes("\\") || packageName.includes(":")) {
    return undefined;
  }

  const segments = packageName.split("/");
  if (segments.length === 1) {
    const [name] = segments;
    return name && isSafeNodeModulesSegment(name) && !name.startsWith("@")
      ? segments
      : undefined;
  }

  if (segments.length === 2) {
    const [scope, name] = segments;
    if (
      scope
      && name
      && scope.startsWith("@")
      && scope.length > 1
      && isSafeNodeModulesSegment(scope)
      && isSafeNodeModulesSegment(name)
    ) {
      return segments;
    }
  }

  return undefined;
}

function isSafeNodeModulesSegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== "..";
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function installedPackageMatchesNode(input: {
  node: DependencyNode;
  packagePath: string;
  maxBytes: number;
}): boolean {
  try {
    const packageJsonText = readTextFileWithLimit({
      filePath: path.join(input.packagePath, "package.json"),
      maxBytes: input.maxBytes
    });

    if (!packageJsonText.ok) {
      return false;
    }

    const packageJson = JSON.parse(packageJsonText.value) as unknown;

    return isRecord(packageJson)
      && packageJson.name === input.node.name
      && packageJson.version === input.node.version;
  } catch {
    return false;
  }
}

function collectYarnCachePackageEvidence(input: {
  node: DependencyNode;
  loadYarnCacheIndex: YarnCacheIndexLoader;
  zipMaxBytes: number;
}): Result<LicenseEvidence | undefined, OhriskError> {
  const filenamePrefix = yarnCacheFilenamePrefix(input.node);
  if (!filenamePrefix) {
    return ok(undefined);
  }

  const loadedIndex = input.loadYarnCacheIndex();
  if (!loadedIndex.ok) {
    return err(loadedIndex.error);
  }
  if (!loadedIndex.value) {
    return ok(undefined);
  }

  for (const filename of loadedIndex.value.filenames) {
    if (!filename.startsWith(filenamePrefix)) {
      continue;
    }
    const cachePath = path.join(loadedIndex.value.cacheDir, filename);
    const stats = readLocalArtifactStats({
      filePath: cachePath,
      packageId: input.node.id,
      resolved: undefined
    });
    if (!stats.ok) {
      return err(stats.error);
    }

    if (stats.value.size > input.zipMaxBytes) {
      return err(localArtifactTooLargeError({
        packageId: input.node.id,
        resolved: undefined,
        artifactPath: cachePath,
        maxBytes: input.zipMaxBytes,
        observedBytes: stats.value.size
      }));
    }

    const zip = readLocalArtifactFileWithLimit({
      filePath: cachePath,
      packageId: input.node.id,
      resolved: undefined,
      maxBytes: input.zipMaxBytes
    });
    if (!zip.ok) {
      return err(zip.error);
    }

    const evidence = collectZipPackageEvidence({
      packageId: input.node.id,
      packageName: input.node.name,
      packageVersion: input.node.version,
      zip: zip.value
    });
    if (!evidence.ok) {
      return err(evidence.error);
    }

    if (evidence.value) {
      return ok(evidence.value);
    }
  }

  return ok(undefined);
}

function createYarnCacheIndexLoader(projectRoot: string): YarnCacheIndexLoader {
  let loaded: Result<YarnCacheIndex | undefined, OhriskError> | undefined;
  return () => {
    if (loaded) {
      return loaded;
    }

    const cacheDir = path.join(projectRoot, ".yarn", "cache");
    if (!existsSync(cacheDir) || !isReadableDirectory(cacheDir)) {
      loaded = ok(undefined);
      return loaded;
    }

    try {
      loaded = ok({
        cacheDir,
        filenames: readdirSync(cacheDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right))
      });
    } catch (cause) {
      loaded = err(createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read Yarn package cache directory.",
        details: {
          cacheDir,
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      }));
    }
    return loaded;
  };
}

function yarnCacheFilenamePrefix(node: DependencyNode): string | undefined {
  const slug = yarnCachePackageSlug(node.name);
  return slug ? `${slug}-npm-${node.version}-` : undefined;
}

function yarnCachePackageSlug(packageName: string): string | undefined {
  const segments = nodeModulesPackageSegments(packageName);
  return segments ? segments.join("-") : undefined;
}

async function collectRemoteTarballEvidence(input: {
  packageId: string;
  resolved: string;
  integrity?: string;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  tarballMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
  collectEvidence?: (tarball: Buffer) => Result<LicenseEvidence, OhriskError>;
  urlError?: {
    code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
    message: string;
    resolveFailureMessage: string;
    details: Record<string, unknown>;
  };
  skipIntegrityCheck?: boolean;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const urlError = input.urlError ?? {
    code: "TARBALL_FETCH_FAILED" as const,
    message: "Package tarball URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve package tarball host.",
    details: {
      resolved: safeUrlForErrorDetails(input.resolved)
    }
  };

  const urlValidation = validateRemoteArtifactUrl({
    code: urlError.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: urlError.message,
    details: urlError.details,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (!input.integrity && !input.skipIntegrityCheck) {
    if (!input.offline) {
      const preflight = await preflightRemoteArtifactFetchTarget({
        code: urlError.code,
        packageId: input.packageId,
        resolved: input.resolved,
        message: urlError.message,
        resolveFailureMessage: urlError.resolveFailureMessage,
        details: urlError.details,
        resolveArtifactHost: input.resolveArtifactHost,
        timeoutMs: input.fetchTimeoutMs,
        allowedHosts: input.allowedHosts,
        ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
      });
      if (!preflight.ok) {
        return err(preflight.error);
      }
    }
    return ok(unavailableUnverifiedRemoteTarballEvidence(input.packageId));
  }

  try {
    const tarball = await readRemoteArtifactBytes({
      code: urlError.code,
      packageId: input.packageId,
      url: input.resolved,
      blockedMessage: urlError.message,
      resolveFailureMessage: urlError.resolveFailureMessage,
      fetchFailureMessage: "Failed to fetch package tarball.",
      tooLargeMessage: "Package tarball response exceeded the maximum supported size.",
      unreadableMessage: "Package tarball response did not expose a readable body stream.",
      offlineMissMessage: "Offline mode could not find the package tarball in the artifact cache.",
      details: urlError.details,
      maxBytes: input.tarballMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {}),
      urlDetailKey: "resolved"
    });

    if (!tarball.ok) {
      if (isPackageTarballTooLargeError(tarball.error)) {
        return ok(unavailableOversizedTarballEvidence(input.packageId));
      }
      return err(tarball.error);
    }

    if (!input.skipIntegrityCheck) {
      const verified = verifyPackageIntegrity({
        packageId: input.packageId,
        resolvedDetail: safeOptionalUrlForErrorDetails(input.resolved),
        integrity: input.integrity,
        artifact: tarball.value
      });
      if (!verified.ok) {
        return err(verified.error);
      }
    }

    const evidence = input.collectEvidence
      ? input.collectEvidence(tarball.value)
      : collectTarballEvidence({
          packageId: input.packageId,
          tarball: tarball.value
        });
    if (!evidence.ok) {
      if (isPackageTarballTooLargeError(evidence.error)) {
        return ok(unavailableOversizedTarballEvidence(input.packageId));
      }
      return err(evidence.error);
    }

    return ok(addIntegrityWarningWhenUnverified({
      evidence: evidence.value,
      integrity: input.integrity
    }));
  } catch (cause) {
    return err(
      createRemoteArtifactExceptionError({
        code: urlError.code,
        message: "Failed to fetch package tarball.",
        blockedMessage: urlError.message,
        details: {
          packageId: input.packageId,
          resolved: safeUrlForErrorDetails(input.resolved),
          ...urlError.details
        },
        cause
      })
    );
  }
}

async function readRemoteArtifactBytes(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  url: string;
  blockedMessage: string;
  resolveFailureMessage: string;
  fetchFailureMessage: string;
  tooLargeMessage: string;
  unreadableMessage: string;
  offlineMissMessage: string;
  details: Record<string, unknown>;
  maxBytes: number;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  allowedHosts: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
  urlDetailKey: "registryUrl" | "resolved";
  transientFetchAttempts?: number;
  transientRetryDelayMs?: number;
  signal: AbortSignal;
}): Promise<Result<Buffer, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.url,
    message: input.blockedMessage,
    details: input.details,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (input.signal.aborted) {
    return err(collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    }));
  }

  const cached = input.artifactCache?.read(input.url, input.maxBytes);
  if (cached && (!cached.stale || input.offline)) {
    return ok(cached.bytes);
  }

  if (input.offline) {
    return err(createError({
      code: input.code,
      category: "network",
      message: input.offlineMissMessage,
      details: {
        packageId: input.packageId,
        ...redactUrlCredentialsInDetails(input.details),
        reason: "offline_cache_miss"
      }
    }));
  }

  const preflight = await preflightRemoteArtifactFetchTarget({
    code: input.code,
    packageId: input.packageId,
    resolved: input.url,
    message: input.blockedMessage,
    resolveFailureMessage: input.resolveFailureMessage,
    details: input.details,
    resolveArtifactHost: input.resolveArtifactHost,
    timeoutMs: input.fetchTimeoutMs,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!preflight.ok) {
    return err(preflight.error);
  }

  const requestHeaders = conditionalArtifactRequestHeaders(cached);
  const artifact = await readTransientRemoteArtifactWithRetry({
    attempts: input.transientFetchAttempts ?? 1,
    retryDelayMs: input.transientRetryDelayMs ?? 0,
    signal: input.signal,
    createAbortError: () => collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    }),
    read: () => readArtifactWithTimeout<RemoteArtifactRead>({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      ...(requestHeaders ? { requestHeaders } : {}),
      timeoutMs: input.fetchTimeoutMs,
      signal: input.signal,
      createAbortError: () => collectionAbortedRemoteError({
        code: input.code,
        details: input.details
      }),
      redirectPolicy: {
        code: input.code,
        packageId: input.packageId,
        message: input.blockedMessage,
        resolveFailureMessage: input.resolveFailureMessage,
        details: input.details,
        resolveArtifactHost: input.resolveArtifactHost,
        allowedHosts: input.allowedHosts,
        ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
      },
      createFailureError: (cause) => createRemoteArtifactExceptionError({
        code: input.code,
        message: input.fetchFailureMessage,
        blockedMessage: input.blockedMessage,
        details: {
          packageId: input.packageId,
          [input.urlDetailKey]: safeUrlForErrorDetails(input.url),
          ...input.details
        },
        cause
      }),
      readResponse: async (response, signal) => {
        const cacheMetadata = artifactCacheMetadataFromHeaders(response.headers);
        if (response.status === 304) {
          cancelReadableBody(response.body);
          if (!cached) {
            return err(createError({
              code: input.code,
              category: "network",
              message: input.fetchFailureMessage,
              details: {
                packageId: input.packageId,
                [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
                status: response.status,
                statusText: response.statusText,
                reason: "not_modified_without_cache_entry"
              }
            }));
          }
          return ok({
            bytes: cached.bytes,
            cacheMetadata,
            notModified: true
          });
        }

        if (!response.ok) {
          cancelReadableBody(response.body);
          return err(createError({
            code: input.code,
            category: "network",
            message: input.fetchFailureMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
              status: response.status,
              statusText: response.statusText
            }
          }));
        }

        const bytes = await readResponseBodyWithLimit({
          response,
          signal,
          maxBytes: input.maxBytes,
          createTooLargeError: (limit) => createError({
            code: input.code,
            category: "unsupported_input",
            message: input.tooLargeMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: input.code,
            category: "unsupported_input",
            message: input.unreadableMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url)
            }
          })
        });
        return bytes.ok
          ? ok({ bytes: bytes.value, cacheMetadata, notModified: false })
          : bytes;
      }
    })
  });
  if (!artifact.ok) {
    return artifact;
  }

  if (artifact.value.notModified) {
    if (artifact.value.cacheMetadata.cacheable) {
      input.artifactCache?.revalidate(input.url, artifact.value.cacheMetadata);
    } else {
      input.artifactCache?.remove(input.url);
    }
  } else if (artifact.value.cacheMetadata.cacheable) {
    input.artifactCache?.write(
      input.url,
      artifact.value.bytes,
      artifact.value.cacheMetadata
    );
  } else {
    input.artifactCache?.remove(input.url);
  }
  return ok(artifact.value.bytes);
}

async function readTransientRemoteArtifactWithRetry<T>(input: {
  attempts: number;
  retryDelayMs: number;
  signal?: AbortSignal;
  createAbortError: () => OhriskError;
  read: () => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const attempts = Math.max(1, Math.trunc(input.attempts));
  let result = await input.read();
  for (let attempt = 1; attempt < attempts && !result.ok; attempt += 1) {
    if (!isRetryableTransientRemoteError(result.error)) {
      return result;
    }
    if (input.signal?.aborted) {
      return err(input.createAbortError());
    }
    if (input.retryDelayMs > 0) {
      await abortableDelay(input.retryDelayMs, input.signal);
      if (input.signal?.aborted) {
        return err(input.createAbortError());
      }
    }
    result = await input.read();
  }
  return result;
}

function isRetryableTransientRemoteError(error: OhriskError): boolean {
  if (isCollectionAbortedError(error)) {
    return false;
  }
  if (error.category !== "network") {
    return false;
  }
  const status = error.details?.status;
  if (typeof status === "number") {
    return status === 408
      || status === 425
      || status === 429
      || status === 500
      || status === 502
      || status === 503
      || status === 504;
  }
  const cause = error.details?.cause;
  return typeof cause !== "string" || !cause.toLowerCase().includes("timed out");
}

function collectionAbortedRemoteError(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  details: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: input.code,
    category: "network",
    message: "Evidence collection was aborted.",
    details: {
      ...redactUrlCredentialsInDetails(input.details),
      reason: "aborted"
    }
  });
}

function isPackageTarballTooLargeError(error: OhriskError): boolean {
  return (
    error.code === "TARBALL_FETCH_FAILED"
    && error.message === "Package tarball response exceeded the maximum supported size."
  ) || (
    error.code === "TARBALL_PARSE_FAILED"
    && error.message === "Failed to decompress package tarball evidence."
    && typeof error.details?.maxUnpackedBytes === "number"
  );
}

function isPackageArtifactTooLargeError(error: OhriskError): boolean {
  return isPackageTarballTooLargeError(error) || (
    error.code === "TARBALL_FETCH_FAILED"
    && error.message === "Python distribution response exceeded the maximum supported size."
  );
}

function unavailableOversizedTarballEvidence(packageId: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Package tarball evidence exceeded Ohrisk's size limit and was not scanned."
    ]
  };
}

function unavailableRemoteArchiveLimitEvidence(
  packageId: string,
  error: OhriskError,
  artifactLabel: string
): LicenseEvidence {
  const limit = typeof error.details?.limit === "string"
    ? ` (${error.details.limit})`
    : "";
  const warning = error.code === "ARCHIVE_ENTRY_TYPE_UNSUPPORTED"
    ? `Remote ${artifactLabel} contained an unsupported archive entry type; its contents were not used as license evidence.`
    : `Remote ${artifactLabel} exceeded Ohrisk's bounded archive inspection limit${limit}; its contents were not used as license evidence.`;
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [warning]
  };
}

function addIntegrityWarningWhenUnverified(input: {
  evidence: LicenseEvidence;
  integrity: string | undefined;
}): LicenseEvidence {
  if (input.integrity) {
    return input.evidence;
  }

  return {
    ...input.evidence,
    warnings: [
      ...input.evidence.warnings,
      "Package artifact integrity was not available in the lockfile; tarball contents were not verified."
    ]
  };
}

function unavailableUnverifiedRemoteTarballEvidence(packageId: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Remote package artifact integrity was not available in the lockfile; tarball contents were not trusted."
    ]
  };
}

async function readArtifactWithTimeout<T>(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  requestHeaders?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  createAbortError: () => OhriskError;
  redirectPolicy: RemoteArtifactFetchPolicy;
  createFailureError: (cause: unknown) => OhriskError;
  readResponse: (
    response: ArtifactFetchResponse,
    signal: AbortSignal
  ) => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const controller = new AbortController();
  const fetchController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;
  let onExternalAbort: (() => void) | undefined;

  const timeoutPromise = new Promise<Result<T, OhriskError>>((resolve) => {
    timeout = setTimeout(() => {
      timeoutError = new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`);
      controller.abort();
      fetchController.abort();
      resolve(err(input.createFailureError(timeoutError)));
    }, input.timeoutMs);
  });

  if (input.signal) {
    if (input.signal.aborted) {
      fetchController.abort();
    } else {
      // The batch abort cancels the request and its body stream immediately,
      // while a response that was already obtained still settles its body read
      // through the timeout-only signal so real package fatals can participate
      // in the deterministic lowest-index arbitration.
      onExternalAbort = () => fetchController.abort();
      input.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    const readPromise = fetchArtifactWithManualRedirects({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      signal: fetchController.signal,
      ...(input.requestHeaders ? { requestHeaders: input.requestHeaders } : {}),
      redirectPolicy: input.redirectPolicy
    })
      .then(async (response): Promise<Result<T, OhriskError>> => {
        if (!response.ok) {
          return err(response.error);
        }

        const result = await input.readResponse(response.value, controller.signal);
        if (timeoutError) {
          throw timeoutError;
        }

        return result;
      })
      .catch((cause): Result<T, OhriskError> => {
        if (input.signal?.aborted) {
          return err(input.createAbortError());
        }
        return err(input.createFailureError(cause));
      });
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (onExternalAbort) {
      input.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function fetchArtifactWithManualRedirects(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  signal: AbortSignal;
  requestHeaders?: Record<string, string>;
  redirectPolicy: RemoteArtifactFetchPolicy;
}): Promise<Result<ArtifactFetchResponse, OhriskError>> {
  let currentUrl = input.url;

  for (let redirectCount = 0; redirectCount <= MAX_ARTIFACT_REDIRECTS; redirectCount += 1) {
    const response = await input.fetchArtifact(currentUrl, {
      signal: input.signal,
      redirect: "manual",
      ...(redirectCount === 0 && input.requestHeaders
        ? { headers: input.requestHeaders }
        : {})
    });
    const responseWithUrl: ArtifactFetchResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: currentUrl,
      arrayBuffer: () => response.arrayBuffer(),
      ...(response.headers === undefined ? {} : { headers: response.headers }),
      ...(response.body === undefined ? {} : { body: response.body })
    };

    if (!isRedirectResponse(responseWithUrl)) {
      return ok(responseWithUrl);
    }

    cancelReadableBody(responseWithUrl.body);

    const location = responseWithUrl.headers?.get("location")?.trim();
    if (!location) {
      return ok(responseWithUrl);
    }

    if (redirectCount >= MAX_ARTIFACT_REDIRECTS) {
      return err(
        createError({
          code: input.redirectPolicy.code,
          category: "network",
          message: "Package artifact redirect limit exceeded.",
          details: {
            packageId: input.redirectPolicy.packageId,
            ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
            redirectFrom: safeUrlForErrorDetails(currentUrl),
            redirectCount: redirectCount + 1,
            maxRedirects: MAX_ARTIFACT_REDIRECTS
          }
        })
      );
    }

    const nextUrl = resolveRedirectLocation(currentUrl, location);
    if (!nextUrl) {
      return err(
        createError({
          code: input.redirectPolicy.code,
          category: "unsupported_input",
          message: input.redirectPolicy.message,
          details: {
            packageId: input.redirectPolicy.packageId,
            ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
            redirectFrom: safeUrlForErrorDetails(currentUrl),
            redirectLocation: safeUrlForErrorDetails(location),
            reason: "invalid_redirect_location"
          }
        })
      );
    }

    const redirectPreflight = await preflightRemoteArtifactFetchTarget({
      code: input.redirectPolicy.code,
      packageId: input.redirectPolicy.packageId,
      resolved: nextUrl,
      message: input.redirectPolicy.message,
      resolveFailureMessage: input.redirectPolicy.resolveFailureMessage,
      details: {
        ...input.redirectPolicy.details,
        redirectFrom: currentUrl,
        redirectUrl: nextUrl
      },
      resolveArtifactHost: input.redirectPolicy.resolveArtifactHost,
      ...(input.redirectPolicy.allowedHosts
        ? { allowedHosts: input.redirectPolicy.allowedHosts }
        : {}),
      ...(input.redirectPolicy.permittedHosts
        ? { permittedHosts: input.redirectPolicy.permittedHosts }
        : {})
    });

    if (!redirectPreflight.ok) {
      return err(redirectPreflight.error);
    }

    currentUrl = nextUrl;
  }

  return err(
    createError({
      code: input.redirectPolicy.code,
      category: "network",
      message: "Package artifact redirect limit exceeded.",
      details: {
        packageId: input.redirectPolicy.packageId,
        ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
        redirectFrom: safeUrlForErrorDetails(currentUrl),
        maxRedirects: MAX_ARTIFACT_REDIRECTS
      }
    })
  );
}

function isRedirectResponse(response: ArtifactFetchResponse): boolean {
  return response.status === 301
    || response.status === 302
    || response.status === 303
    || response.status === 307
    || response.status === 308;
}

function conditionalArtifactRequestHeaders(
  cached: ArtifactCacheEntry | undefined
): Record<string, string> | undefined {
  if (!cached?.stale) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  if (cached.etag) {
    headers["if-none-match"] = cached.etag;
  }
  if (cached.lastModified) {
    headers["if-modified-since"] = cached.lastModified;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function resolveRedirectLocation(currentUrl: string, location: string): string | undefined {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return undefined;
  }
}

function isHttpUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return url !== undefined;
}

function validateRemoteArtifactUrl(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  details: Record<string, unknown>;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
}): Result<void, OhriskError> {
  const url = parseHttpUrl(input.resolved);
  if (!url) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          reason: "unsupported_or_invalid_url"
        }
      })
    );
  }

  if (url.username !== "" || url.password !== "") {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: "url_credentials_not_supported"
        }
      })
    );
  }

  if (url.protocol !== "https:") {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: "insecure_http_not_supported"
        }
      })
    );
  }

  const normalizedHost = normalizeUrlHostname(url.hostname);
  if (input.permittedHosts && !input.permittedHosts.has(normalizedHost)) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizedHost,
          reason: "host_not_permitted"
        }
      })
    );
  }
  const blockedHostReason = isExplicitlyAllowedArtifactHost(normalizedHost, input.allowedHosts)
    ? undefined
    : blockedRemoteArtifactHostReason(normalizedHost);
  if (blockedHostReason) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: blockedHostReason
        }
      })
    );
  }

  return ok(undefined);
}

async function preflightRemoteArtifactFetchTarget(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  resolveFailureMessage: string;
  details: Record<string, unknown>;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  timeoutMs?: number;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
}): Promise<Result<void, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: input.message,
    details: input.details,
    ...(input.allowedHosts ? { allowedHosts: input.allowedHosts } : {}),
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });

  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (!input.resolveArtifactHost) {
    return ok(undefined);
  }

  const url = parseHttpUrl(input.resolved);
  if (!url) {
    return ok(undefined);
  }

  const artifactHost = normalizeUrlHostname(url.hostname);
  if (!shouldResolveRemoteArtifactHost(artifactHost)) {
    return ok(undefined);
  }

  let resolutions: ArtifactHostResolution[];
  try {
    resolutions = await resolveArtifactHostWithTimeout({
      resolveArtifactHost: input.resolveArtifactHost,
      artifactHost,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
  } catch (cause) {
    return err(
      createError({
        code: input.code,
        category: "network",
        message: input.resolveFailureMessage,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost,
          cause: safeErrorCauseForDetails(cause)
        }
      })
    );
  }

  if (resolutions.length === 0) {
    return err(
      createError({
        code: input.code,
        category: "network",
        message: input.resolveFailureMessage,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost,
          reason: "empty_dns_response"
        }
      })
    );
  }

  for (const resolution of resolutions) {
    const resolvedAddress = normalizeUrlHostname(resolution.address);
    const blockedHostReason = blockedRemoteArtifactHostReason(resolvedAddress);
    if (blockedHostReason) {
      return err(
        createError({
          code: input.code,
          category: "unsupported_input",
          message: input.message,
          details: {
            packageId: input.packageId,
            ...redactUrlCredentialsInDetails(input.details),
            artifactHost,
            resolvedAddress,
            reason: blockedHostReason
          }
        })
      );
    }
  }

  return ok(undefined);
}

async function resolveArtifactHostWithTimeout(input: {
  resolveArtifactHost: ArtifactHostResolver;
  artifactHost: string;
  timeoutMs?: number;
}): Promise<ArtifactHostResolution[]> {
  if (input.timeoutMs === undefined) {
    return input.resolveArtifactHost(input.artifactHost);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.resolveArtifactHost(input.artifactHost),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(
            `Artifact host resolution timed out after ${input.timeoutMs}ms.`
          ));
        }, input.timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function createRemoteArtifactExceptionError(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  message: string;
  blockedMessage: string;
  details: Record<string, unknown>;
  cause: unknown;
}): OhriskError {
  if (input.cause instanceof BlockedArtifactRemoteAddressError) {
    return createError({
      code: input.code,
      category: "unsupported_input",
      message: input.blockedMessage,
      details: {
        ...redactUrlCredentialsInDetails(input.details),
        artifactHost: input.cause.hostname,
        resolvedAddress: normalizeUrlHostname(input.cause.remoteAddress),
        reason: input.cause.reason
      }
    });
  }

  if (isAbortErrorLike(input.cause)) {
    return collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    });
  }

  return createError({
    code: input.code,
    category: "network",
    message: input.message,
    details: {
      ...redactUrlCredentialsInDetails(input.details),
      cause: safeErrorCauseForDetails(input.cause)
    }
  });
}

function npmRegistryPackageVersionUrl(
  name: string,
  version: string,
  registryUrl?: string
): string {
  return `${npmRegistryPackageUrl(name, registryUrl)}/${encodeURIComponent(version)}`;
}

function pypiPackageVersionUrl(name: string, version: string): string {
  return `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
}

function remoteArtifactFilename(resolved: string): string | undefined {
  const parsed = parseHttpUrl(resolved);
  const encodedFilename = parsed?.pathname.split("/").pop();
  if (!encodedFilename) {
    return undefined;
  }
  try {
    return decodeURIComponent(encodedFilename);
  } catch {
    return encodedFilename;
  }
}

function unsupportedRemoteEcosystemEvidence(input: {
  node: DependencyNode;
  reason?: string;
}): LicenseEvidence {
  const warning = input.reason
    ?? (input.node.resolved
      ? `Unsupported resolved artifact specifier: ${safeUrlForErrorDetails(input.node.resolved)}`
      : `Remote package evidence is not configured for the ${input.node.ecosystem} ecosystem.`);
  return {
    packageId: input.node.id,
    files: [],
    source: "unavailable",
    warnings: [warning]
  };
}

function npmRegistryPackageUrl(name: string, registryUrl?: string): string {
  const baseUrl = (registryUrl ?? "https://registry.npmjs.org").replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(name).replace(/^%40/, "@")}`;
}

function readRegistryTarballUrl(metadata: unknown, version: string): string | undefined {
  const versionMetadata = readRegistryVersionMetadata(metadata, version);
  if (!versionMetadata) {
    return undefined;
  }

  const dist = versionMetadata.dist;
  if (isRecord(dist) && typeof dist.tarball === "string") {
    return dist.tarball;
  }

  return undefined;
}

function readRegistryVersionMetadata(
  metadata: unknown,
  version: string
): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  if (metadata.version === version || !isRecord(metadata.versions)) {
    return metadata;
  }

  const versions = metadata.versions;
  const versionMetadata = versions[version];
  return isRecord(versionMetadata) ? versionMetadata : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
