import { createHash, timingSafeEqual } from "node:crypto";
import type { LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  type Stats
} from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  artifactCacheMetadataFromHeaders,
  createArtifactCache,
  type ArtifactCache,
  type ArtifactCacheEntry,
  type ArtifactCacheResponseMetadata
} from "./cache";
import { collectCargoCrateEvidence } from "./cargo-crate";
import { collectRegisteredEcosystemEvidence } from "../ecosystems/registry";
import { collectGoModuleZipEvidence } from "./go-module-zip";
import { collectLocalPackageEvidence } from "./local-package";
import { collectMavenJarEvidence } from "./maven-jar";
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
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import { collectZipPackageEvidence } from "./zip-package";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { parseSpdxExpression } from "../license/spdx";
import { createError, type OhriskError } from "../shared/errors";
import {
  mavenPomRepositoryPath,
  type MavenCoordinates
} from "../shared/maven-repository";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";

type ArtifactFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url?: string;
  headers?: {
    get: (name: string) => string | null;
  };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type ArtifactFetchOptions = {
  signal?: AbortSignal;
  redirect?: "manual";
  headers?: Record<string, string>;
};

type RemoteArtifactRead = {
  bytes: Buffer;
  cacheMetadata: ArtifactCacheResponseMetadata;
  notModified: boolean;
};

type ArtifactFetcher = (
  url: string,
  options?: ArtifactFetchOptions
) => Promise<ArtifactFetchResponse>;

type ArtifactHostResolution = {
  address: string;
  family: number;
};

type ArtifactHostResolver = (hostname: string) => Promise<ArtifactHostResolution[]>;
type ArtifactLookupOptions = number | LookupOptions;
type SecureArtifactLookupSelection = {
  all: true;
  resolutions: ArtifactHostResolution[];
} | {
  all: false;
  address: string;
  family: number;
};
type Ipv6Hextets = [number, number, number, number, number, number, number, number];
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

const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;
const REGISTRY_METADATA_MAX_BYTES = 10 * 1024 * 1024;
const PACKAGE_TARBALL_MAX_BYTES = 100 * 1024 * 1024;
const INSTALLED_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const LOCAL_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;
const MAX_ARTIFACT_REDIRECTS = 5;
const DEFAULT_EVIDENCE_CONCURRENCY = 8;
const PYPI_METADATA_HOSTS = new Set(["pypi.org"]);
const PYPI_DISTRIBUTION_HOSTS = new Set(["files.pythonhosted.org"]);
const MAVEN_CENTRAL_BASE_URL = "https://repo.maven.apache.org/maven2";
const MAVEN_CENTRAL_HOSTS = new Set(["repo.maven.apache.org"]);
const MAVEN_JAR_MAX_BYTES = 32 * 1024 * 1024;
const MAVEN_CHECKSUM_MAX_BYTES = 256;
const GO_MODULE_PROXY_BASE_URL = "https://proxy.golang.org";
const GO_MODULE_PROXY_HOSTS = new Set(["proxy.golang.org", "storage.googleapis.com"]);
const GO_MODULE_TRANSIENT_FETCH_ATTEMPTS = 2;
const GO_MODULE_TRANSIENT_RETRY_DELAY_MS = 200;
const CARGO_CRATES_IO_SOURCES = new Set([
  "registry+https://github.com/rust-lang/crates.io-index",
  "registry+https://index.crates.io/"
]);
const CARGO_CRATE_BASE_URL = "https://static.crates.io/crates";
const CARGO_CRATE_HOSTS = new Set(["static.crates.io"]);
const ARTIFACT_HOST_RESOLUTION_CACHE_TTL_MS = 60_000;
const ARTIFACT_HOST_RESOLUTION_CACHE_MAX_ENTRIES = 256;

const SUPPORTED_INTEGRITY_DIGEST_BYTES = {
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64
} as const;

type SupportedIntegrityAlgorithm = keyof typeof SUPPORTED_INTEGRITY_DIGEST_BYTES;

export async function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
  workspaceRoot?: string;
  allowLocalProjectEvidence?: boolean;
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
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const evidence = new Array<LicenseEvidence>(input.graph.nodes.length);
  const total = input.graph.nodes.length;
  if (total === 0) {
    return ok([]);
  }

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
    allowedHosts,
    repositoryUrls: input.graph.mavenRepositoryUrls ?? []
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
        npmRegistryUrl: input.npmRegistryUrl,
        allowedHosts,
        loadYarnCacheIndex,
        collectMavenEvidence
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
        if (!previousFailure || index < previousFailure.index) {
          failure = {
            index,
            error: collected.error
          };
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

  await Promise.all(Array.from({ length: workerCount }, () => collectNext()));
  artifactCache?.maintain();

  if (failure) {
    return err(failure.error);
  }

  return ok(evidence);
}

function isRecoverableRemoteEvidenceError(error: OhriskError): boolean {
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
  return {
    packageId: input.packageId,
    files: [],
    source: "unavailable",
    warnings: [
      `Package evidence could not be fetched (${input.error.code}): ${input.error.message}`
    ]
  };
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
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
  loadYarnCacheIndex: YarnCacheIndexLoader;
  collectMavenEvidence: MavenEvidenceCollector;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const ecosystemEvidence = input.allowLocalProjectEvidence
    ? collectRegisteredEcosystemEvidence({
        node: input.node,
        projectRoot: input.projectRoot
      })
    : undefined;
  if (ecosystemEvidence) {
    if (
      (
        input.node.ecosystem !== "maven"
        && input.node.ecosystem !== "go"
        && input.node.ecosystem !== "cargo"
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
        allowedHosts: input.allowedHosts
      });
    }

    return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
  }

  if (input.node.ecosystem === "maven") {
    return input.collectMavenEvidence(input.node);
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
      allowedHosts: input.allowedHosts
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
      npmRegistryUrl: input.npmRegistryUrl,
      allowedHosts: input.allowedHosts,
      preferRegistryMetadata: !input.node.direct
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
      allowedHosts: input.allowedHosts
    });
  }

  return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
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
    resolved: input.node.resolved,
    integrity: input.node.integrity,
    tarball: tarball.value
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

async function collectRemoteGoModuleEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
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
  if (!input.node.integrity || !/^h1:[A-Za-z0-9+/]{43}=$/u.test(input.node.integrity)) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [
        "Go module source was not fetched because go.sum did not contain an exact h1 checksum for the module zip."
      ]
    });
  }

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
    allowedHosts: input.allowedHosts,
    permittedHosts: GO_MODULE_PROXY_HOSTS,
    urlDetailKey: "resolved",
    transientFetchAttempts: GO_MODULE_TRANSIENT_FETCH_ATTEMPTS,
    transientRetryDelayMs: GO_MODULE_TRANSIENT_RETRY_DELAY_MS
  });
  if (!zip.ok) {
    return zip;
  }

  return collectGoModuleZipEvidence({
    packageId: input.node.id,
    modulePath: coordinates.modulePath,
    version: coordinates.version,
    checksum: input.node.integrity,
    zip: zip.value,
    artifactMaxBytes: input.artifactMaxBytes
  });
}

async function collectRemoteCargoCrateEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
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

function remoteGoModuleCoordinates(node: DependencyNode): {
  modulePath: string;
  version: string;
} | undefined {
  if (!node.resolved) {
    return { modulePath: node.name, version: node.version };
  }
  if (!node.resolved.startsWith("go-module:")) {
    return undefined;
  }
  const specifier = node.resolved.slice("go-module:".length);
  const separator = specifier.lastIndexOf("@");
  if (separator <= 0 || separator === specifier.length - 1) {
    return undefined;
  }
  return {
    modulePath: specifier.slice(0, separator),
    version: specifier.slice(separator + 1)
  };
}

export function goModuleProxyZipUrl(modulePath: string, version: string): string | undefined {
  const escapedModulePath = escapeGoProxyModulePath(modulePath);
  const escapedVersion = escapeGoProxyVersion(version);
  return escapedModulePath && escapedVersion
    ? `${GO_MODULE_PROXY_BASE_URL}/${escapedModulePath}/@v/${escapedVersion}.zip`
    : undefined;
}

function escapeGoProxyModulePath(modulePath: string): string | undefined {
  if (
    modulePath === ""
    || modulePath.startsWith("/")
    || modulePath.endsWith("/")
    || !/^[A-Za-z0-9.!_~+\-/]+$/u.test(modulePath)
  ) {
    return undefined;
  }
  const segments = modulePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return escapeGoProxyText(modulePath);
}

function escapeGoProxyVersion(version: string): string | undefined {
  return /^v[A-Za-z0-9.!_~+\-]+$/u.test(version) ? escapeGoProxyText(version) : undefined;
}

function escapeGoProxyText(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "!") {
      escaped += "!!";
    } else if (character >= "A" && character <= "Z") {
      escaped += `!${character.toLowerCase()}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
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
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
  preferRegistryMetadata: boolean;
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

  const registryEvidence = readNpmRegistryLicenseEvidence({
    node: input.node,
    metadata: metadata.value
  });
  if (input.preferRegistryMetadata && registryEvidence) {
    return ok(registryEvidence);
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

function readNpmRegistryLicenseEvidence(input: {
  node: DependencyNode;
  metadata: unknown;
}): LicenseEvidence | undefined {
  const versionMetadata = readRegistryVersionMetadata(input.metadata, input.node.version);
  if (!versionMetadata) {
    return undefined;
  }

  const license = versionMetadata.license;
  if (typeof license !== "string" || license.trim() === "") {
    return undefined;
  }

  const parsed = parseSpdxExpression(license);
  if (parsed.malformed || parsed.choices.length === 0) {
    return undefined;
  }

  return {
    packageId: input.node.id,
    metadataLicense: license,
    metadataSource: "npm registry metadata",
    files: [],
    source: "registry",
    warnings: []
  };
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
    ...(release.value.metadataLicense
      ? { registryMetadataLicense: release.value.metadataLicense }
      : {}),
    yanked: release.value.artifact.yanked,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    artifactMaxBytes: input.artifactMaxBytes,
    offline: input.offline,
    artifactCache: input.artifactCache,
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
  registryMetadataLicense?: string;
  yanked?: boolean;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
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
      resolved: input.resolved,
      integrity: input.integrity,
      tarball: artifact.value
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
      ...(input.registryMetadataLicense
        ? { registryMetadataLicense: input.registryMetadataLicense }
        : {}),
      ...(input.yanked !== undefined ? { yanked: input.yanked } : {})
    });
    if (!collected.ok && collected.error.code === "ARCHIVE_LIMIT_EXCEEDED") {
      return ok(unavailableRemoteArchiveLimitEvidence(input.node.id, collected.error));
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
  allowedHosts: ReadonlySet<string>;
  urlError?: {
    code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
    message: string;
    resolveFailureMessage: string;
    details: Record<string, unknown>;
  };
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
    allowedHosts: input.allowedHosts
  });
  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (!input.integrity) {
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
        allowedHosts: input.allowedHosts
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
      allowedHosts: input.allowedHosts,
      urlDetailKey: "resolved"
    });

    if (!tarball.ok) {
      if (isPackageTarballTooLargeError(tarball.error)) {
        return ok(unavailableOversizedTarballEvidence(input.packageId));
      }
      return err(tarball.error);
    }

    const verified = verifyPackageIntegrity({
      packageId: input.packageId,
      resolved: input.resolved,
      integrity: input.integrity,
      tarball: tarball.value
    });
    if (!verified.ok) {
      return err(verified.error);
    }

    const evidence = collectTarballEvidence({
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

  const artifact = await readTransientRemoteArtifactWithRetry({
    attempts: input.transientFetchAttempts ?? 1,
    retryDelayMs: input.transientRetryDelayMs ?? 0,
    read: () => readArtifactWithTimeout<RemoteArtifactRead>({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      requestHeaders: conditionalArtifactRequestHeaders(cached),
      timeoutMs: input.fetchTimeoutMs,
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
  read: () => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const attempts = Math.max(1, Math.trunc(input.attempts));
  let result = await input.read();
  for (let attempt = 1; attempt < attempts && !result.ok; attempt += 1) {
    if (!isRetryableTransientRemoteError(result.error)) {
      return result;
    }
    if (input.retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.retryDelayMs));
    }
    result = await input.read();
  }
  return result;
}

function isRetryableTransientRemoteError(error: OhriskError): boolean {
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
  error: OhriskError
): LicenseEvidence {
  const limit = typeof error.details?.limit === "string"
    ? ` (${error.details.limit})`
    : "";
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [
      `Remote Python distribution exceeded Ohrisk's bounded archive inspection limit${limit}; its contents were not used as license evidence.`
    ]
  };
}

function resolveExistingLocalArtifactPath(input: {
  packageId: string;
  resolved: string | undefined;
  integrity: string | undefined;
  projectRoot: string;
  workspaceRoot: string | undefined;
  artifactPath: string;
}): Result<string, OhriskError> {
  const allowedRoots = realpathLocalArtifactRoots({
    projectRoot: input.projectRoot,
    workspaceRoot: input.workspaceRoot
  });
  if (!allowedRoots.ok) {
    return err(allowedRoots.error);
  }

  const artifactPath = realpathSync(input.artifactPath);

  if (
    !isPathInsideAnyRoot(artifactPath, allowedRoots.value)
    && !isVerifiableExternalLocalTarball({
      artifactPath,
      integrity: input.integrity
    })
  ) {
    return err(localArtifactOutsideProjectError({
      packageId: input.packageId,
      resolved: input.resolved,
      artifactPath: input.artifactPath
    }));
  }

  return ok(artifactPath);
}

function localArtifactOutsideProjectError(input: {
  packageId: string;
  resolved: string | undefined;
  artifactPath: string;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Resolved package artifact must stay inside the project, repository root, or explicit workspace root.",
    details: {
      packageId: input.packageId,
      resolved: safeOptionalUrlForErrorDetails(input.resolved),
      artifactPath: safeUrlForErrorDetails(input.artifactPath)
    }
  });
}

function isVerifiableExternalLocalTarball(input: {
  artifactPath: string;
  integrity: string | undefined;
}): boolean {
  return input.integrity !== undefined
    && parseSupportedIntegrityEntries(input.integrity).length > 0
    && isSupportedLocalTarballPath(input.artifactPath);
}

function isSupportedLocalTarballPath(artifactPath: string): boolean {
  const normalizedPath = artifactPath.replace(/\\/g, "/").toLowerCase();
  return normalizedPath.endsWith(".tgz") || normalizedPath.endsWith(".tar.gz");
}

function resolveTrustedWorkspaceRoot(workspaceRoot: string): Result<string, OhriskError> {
  const resolvedPath = path.resolve(workspaceRoot);
  try {
    const realPath = realpathSync(resolvedPath);
    if (!statSync(realPath).isDirectory()) {
      return err(workspaceRootInvalidError(workspaceRoot, resolvedPath));
    }

    return ok(realPath);
  } catch {
    return err(workspaceRootInvalidError(workspaceRoot, resolvedPath));
  }
}

function workspaceRootInvalidError(workspaceRoot: string, resolvedPath: string): OhriskError {
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "--workspace-root must point to an existing directory.",
    details: {
      workspaceRoot,
      resolvedPath
    }
  });
}

function realpathLocalArtifactRoots(input: {
  projectRoot: string;
  workspaceRoot: string | undefined;
}): Result<string[], OhriskError> {
  const workspaceRoot = input.workspaceRoot
    ? resolveTrustedWorkspaceRoot(input.workspaceRoot)
    : ok(undefined);
  if (!workspaceRoot.ok) {
    return err(workspaceRoot.error);
  }

  return ok([
    realpathSync(resolveLocalArtifactRoot(input.projectRoot)),
    ...(workspaceRoot.value ? [workspaceRoot.value] : [])
  ]);
}

function resolveLocalArtifactRoot(projectRoot: string): string {
  return findNearestGitRoot(projectRoot) ?? path.resolve(projectRoot);
}

function findNearestGitRoot(startPath: string): string | undefined {
  let currentPath = path.resolve(startPath);

  while (true) {
    if (existsSync(path.join(currentPath, ".git"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isPathInsideAnyRoot(childPath: string, parentPaths: string[]): boolean {
  return parentPaths.some((parentPath) => isPathInsideOrEqual(childPath, parentPath));
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

type ArtifactBodyLimit = {
  maxBytes: number;
  observedBytes: number;
  contentLength?: number;
};

function artifactBodyLimitDetails(limit: ArtifactBodyLimit): Record<string, unknown> {
  return limit.contentLength === undefined
    ? {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes
      }
    : {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes,
        contentLength: limit.contentLength
      };
}

async function readResponseBodyWithLimit(input: {
  response: ArtifactFetchResponse;
  signal: AbortSignal;
  maxBytes: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
  createUnreadableBodyError: () => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const contentLength = readContentLength(input.response.headers);
  if (contentLength !== undefined && contentLength > input.maxBytes) {
    cancelReadableBody(input.response.body);
    return err(
      input.createTooLargeError({
        maxBytes: input.maxBytes,
        observedBytes: contentLength,
        contentLength
      })
    );
  }

  if (input.response.body) {
    return readStreamBodyWithLimit({
      body: input.response.body,
      signal: input.signal,
      maxBytes: input.maxBytes,
      ...(contentLength === undefined ? {} : { contentLength }),
      createTooLargeError: input.createTooLargeError
    });
  }

  return err(input.createUnreadableBodyError());
}

function cancelReadableBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (!body) {
    return;
  }

  void body.cancel().catch(() => undefined);
}

async function readStreamBodyWithLimit(input: {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  maxBytes: number;
  contentLength?: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const reader = input.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  const chunks: Buffer[] = [];
  let observedBytes = 0;

  try {
    if (input.signal.aborted) {
      cancelReader();
    } else {
      input.signal.addEventListener("abort", cancelReader, { once: true });
    }

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return ok(Buffer.concat(chunks, observedBytes));
      }

      observedBytes += chunk.value.byteLength;
      if (observedBytes > input.maxBytes) {
        cancelReader();
        return err(
          input.createTooLargeError({
            maxBytes: input.maxBytes,
            observedBytes,
            ...(input.contentLength === undefined ? {} : { contentLength: input.contentLength })
          })
        );
      }

      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    input.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function readContentLength(headers: ArtifactFetchResponse["headers"]): number | undefined {
  const value = headers?.get("content-length");
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return undefined;
  }

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readArtifactWithTimeout<T>(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  requestHeaders?: Record<string, string>;
  timeoutMs: number;
  redirectPolicy: RemoteArtifactFetchPolicy;
  createFailureError: (cause: unknown) => OhriskError;
  readResponse: (
    response: ArtifactFetchResponse,
    signal: AbortSignal
  ) => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;

  const timeoutPromise = new Promise<Result<T, OhriskError>>((resolve) => {
    timeout = setTimeout(() => {
      timeoutError = new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`);
      controller.abort();
      resolve(err(input.createFailureError(timeoutError)));
    }, input.timeoutMs);
  });

  try {
    const readPromise = fetchArtifactWithManualRedirects({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      signal: controller.signal,
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
      .catch((cause): Result<T, OhriskError> => err(input.createFailureError(cause)));
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
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
    const responseWithUrl = {
      ...response,
      url: currentUrl
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
      timeoutMs: input.timeoutMs
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

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function redactUrlCredentialsInDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...details };
  for (const key of [
    "registryUrl",
    "resolved",
    "tarballUrl",
    "artifactPath",
    "redirectFrom",
    "redirectUrl",
    "redirectLocation"
  ]) {
    const value = redacted[key];
    if (typeof value === "string") {
      redacted[key] = safeUrlForErrorDetails(value);
    }
  }

  return redacted;
}

function safeOptionalUrlForErrorDetails(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeUrlForErrorDetails(value);
}

function safeErrorCauseForDetails(cause: unknown): string {
  return safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause));
}

class BlockedArtifactRemoteAddressError extends Error {
  readonly hostname: string;
  readonly remoteAddress: string;
  readonly reason: string;

  constructor(input: {
    hostname: string;
    remoteAddress: string;
    reason: string;
  }) {
    super(
      `Blocked artifact socket remote address for ${input.hostname}: ${input.remoteAddress} (${input.reason}).`
    );
    this.name = "BlockedArtifactRemoteAddressError";
    this.hostname = input.hostname;
    this.remoteAddress = input.remoteAddress;
    this.reason = input.reason;
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

function safeUrlForErrorDetails(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
    ) {
      return redactUrlCredentialsInText(value);
    }

    if (url.username !== "") {
      url.username = "redacted";
    }
    if (url.password !== "") {
      url.password = "redacted";
    }

    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return redactUrlCredentialsInText(value);
  }
}

function redactUrlCredentialsInText(value: string): string {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    )
    .replace(
      /([a-z][a-z0-9+.-]{1,}:\\+)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    );
}

function isExplicitlyAllowedArtifactHost(
  hostname: string,
  allowedHosts: ReadonlySet<string> | undefined
): boolean {
  const host = normalizeUrlHostname(hostname);
  if (!allowedHosts?.has(host)) {
    return false;
  }

  // Explicit trust is limited to DNS hostnames. Literal addresses and localhost
  // remain blocked even when supplied through a malformed configuration value.
  return isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost");
}

function blockedRemoteArtifactHostReason(hostname: string): string | undefined {
  const host = normalizeUrlHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "localhost";
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return blockedIpv4HostReason(host);
  }

  if (ipVersion === 6) {
    return blockedIpv6HostReason(host);
  }

  return undefined;
}

function shouldResolveRemoteArtifactHost(hostname: string): boolean {
  return isIP(hostname) === 0 && blockedRemoteArtifactHostReason(hostname) === undefined;
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function blockedIpv4HostReason(host: string): string | undefined {
  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return "invalid_ipv4";
  }

  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return "unspecified_ipv4";
  if (a === 10) return "private_ipv4";
  if (a === 100 && b >= 64 && b <= 127) return "shared_address_ipv4";
  if (a === 127) return "loopback_ipv4";
  if (a === 169 && b === 254) return "link_local_ipv4";
  if (a === 172 && b >= 16 && b <= 31) return "private_ipv4";
  if (a === 192 && b === 168) return "private_ipv4";
  if (a === 192 && b === 0 && c === 2) return "documentation_ipv4";
  if (a === 192 && b === 0) return "non_public_ipv4";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking_ipv4";
  if (a === 198 && b === 51 && c === 100) return "documentation_ipv4";
  if (a === 203 && b === 0 && c === 113) return "documentation_ipv4";
  if (a >= 224) return "multicast_or_reserved_ipv4";

  return undefined;
}

function blockedIpv6HostReason(host: string): string | undefined {
  if (host === "::") return "unspecified_ipv6";
  if (host === "::1") return "loopback_ipv6";

  const embeddedIpv4 = embeddedIpv4FromIpv6Host(host);
  if (embeddedIpv4) {
    return blockedIpv4HostReason(embeddedIpv4);
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return "invalid_ipv6";
  }

  const [firstHextet, secondHextet, thirdHextet, fourthHextet] = hextets;

  if (
    firstHextet === 0x0064
    && secondHextet === 0xff9b
    && thirdHextet === 0x0001
  ) {
    return "local_nat64_ipv6";
  }

  if (
    firstHextet === 0x0100
    && secondHextet === 0
    && thirdHextet === 0
    && fourthHextet === 0
  ) {
    return "discard_ipv6";
  }

  if ((firstHextet & 0xfe00) === 0xfc00) return "unique_local_ipv6";
  if ((firstHextet & 0xffc0) === 0xfe80) return "link_local_ipv6";
  if ((firstHextet & 0xff00) === 0xff00) return "multicast_ipv6";

  if (firstHextet === 0x2001 && secondHextet === 0) return "teredo_ipv6";
  if (
    firstHextet === 0x2001
    && secondHextet === 0x0002
    && thirdHextet === 0
  ) {
    return "benchmarking_ipv6";
  }
  if (
    firstHextet === 0x2001
    && ((secondHextet & 0xfff0) === 0x0010 || (secondHextet & 0xfff0) === 0x0020)
  ) {
    return "orchid_ipv6";
  }
  if (firstHextet === 0x2001 && secondHextet === 0x0db8) return "documentation_ipv6";

  return undefined;
}

function embeddedIpv4FromIpv6Host(host: string): string | undefined {
  const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) {
    return dotted[1];
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return undefined;
  }

  if (
    hextets.slice(0, 5).every((hextet) => hextet === 0)
    && hextets[5] === 0xffff
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets.slice(0, 6).every((hextet) => hextet === 0)
    && (hextets[6] !== 0 || hextets[7] > 1)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets[0] === 0x0064
    && hextets[1] === 0xff9b
    && hextets.slice(2, 6).every((hextet) => hextet === 0)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (hextets[0] === 0x2002) {
    return ipv4FromHextets(hextets[1], hextets[2]);
  }

  return undefined;
}

function ipv4FromHextets(high: number, low: number): string {
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join(".");
}

function expandIpv6Hextets(host: string): Ipv6Hextets | undefined {
  if (host.includes(".")) {
    return undefined;
  }

  const [left = "", right = "", extra] = host.split("::");
  if (extra !== undefined) {
    return undefined;
  }

  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === "" ? [] : right.split(":");
  const hasCompression = host.includes("::");
  const missingCount = hasCompression ? 8 - leftParts.length - rightParts.length : 0;
  if ((!hasCompression && leftParts.length !== 8) || missingCount < 0) {
    return undefined;
  }

  const parts = [
    ...leftParts,
    ...Array.from({ length: missingCount }, () => "0"),
    ...rightParts
  ];
  if (parts.length !== 8) {
    return undefined;
  }

  const hextets = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    const value = Number.parseInt(part, 16);
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
  });

  return hextets.every((hextet): hextet is number => hextet !== undefined)
    ? hextets as Ipv6Hextets
    : undefined;
}

function verifyPackageIntegrity(input: {
  packageId: string;
  resolved: string | undefined;
  integrity: string | undefined;
  tarball: Buffer;
}): Result<void, OhriskError> {
  if (!input.integrity) {
    return ok(undefined);
  }

  const supported = parseSupportedIntegrityEntries(input.integrity);
  if (supported.length === 0) {
    return err(
      createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: "Package artifact integrity could not be verified because no supported digest was found.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          integrity: input.integrity,
          supportedAlgorithms: ["sha512", "sha384", "sha256", "sha1"]
        }
      })
    );
  }

  const computed: string[] = [];
  for (const entry of supported) {
    const actualDigest = createHash(entry.algorithm).update(input.tarball).digest();
    const actual = `${entry.algorithm}-${actualDigest.toString("base64")}`;
    computed.push(actual);

    if (
      actualDigest.byteLength === entry.digest.byteLength
      && timingSafeEqual(actualDigest, entry.digest)
    ) {
      return ok(undefined);
    }
  }

  return err(
    createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Package artifact integrity did not match the lockfile digest.",
      details: {
        packageId: input.packageId,
        resolved: safeOptionalUrlForErrorDetails(input.resolved),
        integrity: input.integrity,
        computed
      }
    })
  );
}

function parseSupportedIntegrityEntries(
  integrity: string
): Array<{ algorithm: SupportedIntegrityAlgorithm; digest: Buffer }> {
  return integrity
    .split(/\s+/)
    .map((entry) => {
      const separatorIndex = entry.indexOf("-");
      if (separatorIndex <= 0) {
        return undefined;
      }

      const algorithm = entry.slice(0, separatorIndex);
      const digest = entry.slice(separatorIndex + 1);
      if (!isSupportedIntegrityAlgorithm(algorithm) || digest === "") {
        return undefined;
      }

      const decoded = decodeIntegrityDigest({ algorithm, digest });
      if (!decoded) {
        return undefined;
      }

      return {
        algorithm,
        digest: decoded
      };
    })
    .filter((entry): entry is {
      algorithm: SupportedIntegrityAlgorithm;
      digest: Buffer;
    } => entry !== undefined);
}

function isSupportedIntegrityAlgorithm(value: string): value is SupportedIntegrityAlgorithm {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_INTEGRITY_DIGEST_BYTES, value);
}

function decodeIntegrityDigest(input: {
  algorithm: SupportedIntegrityAlgorithm;
  digest: string;
}): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.digest)) {
    return undefined;
  }

  const paddingStart = input.digest.indexOf("=");
  if (paddingStart !== -1 && !/^=+$/.test(input.digest.slice(paddingStart))) {
    return undefined;
  }

  if (input.digest.length % 4 === 1) {
    return undefined;
  }

  const decoded = Buffer.from(input.digest, "base64");
  if (decoded.byteLength !== SUPPORTED_INTEGRITY_DIGEST_BYTES[input.algorithm]) {
    return undefined;
  }

  const normalizedInput = input.digest.replace(/=+$/, "");
  const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
  return normalizedDecoded === normalizedInput ? decoded : undefined;
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

function sha256HexIntegrity(sha256: string): string {
  return `sha256-${Buffer.from(sha256, "hex").toString("base64")}`;
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

function normalizeAllowedArtifactHosts(
  hosts: Iterable<string> | undefined
): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const host of hosts ?? []) {
    const value = normalizeUrlHostname(host.trim());
    if (value) {
      normalized.add(value);
    }
  }
  return normalized;
}

function withRegistryAuthorization(
  fetchArtifact: ArtifactFetcher,
  tokens: ReadonlyMap<string, string> | undefined
): ArtifactFetcher {
  if (!tokens || tokens.size === 0) {
    return fetchArtifact;
  }

  const normalizedTokens = new Map<string, string>();
  for (const [host, token] of tokens) {
    if (token) {
      normalizedTokens.set(normalizeUrlHostname(host), token);
    }
  }

  return (url, options) => {
    const parsed = parseHttpUrl(url);
    const token = parsed?.protocol === "https:"
      ? normalizedTokens.get(normalizeUrlHostname(parsed.hostname))
      : undefined;
    if (!token) {
      return fetchArtifact(url, options);
    }

    return fetchArtifact(url, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        authorization: `Bearer ${token}`
      }
    });
  };
}

function createDefaultArtifactFetcher(
  resolveArtifactHost: ArtifactHostResolver
): ArtifactFetcher {
  const lookup = createSecureArtifactLookup(resolveArtifactHost);
  return (url, options) => defaultArtifactFetcher(url, options, lookup);
}

function defaultArtifactFetcher(
  url: string,
  options: ArtifactFetchOptions | undefined,
  lookup: import("node:net").LookupFunction = secureArtifactLookup as import("node:net").LookupFunction
): Promise<ArtifactFetchResponse> {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl || parsedUrl.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported artifact URL: ${safeUrlForErrorDetails(url)}`));
  }

  return new Promise((resolve, reject) => {
    const req = httpsRequest(parsedUrl, {
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
      lookup
    }, (response) => {
      const socketAddress = validateArtifactSocketRemoteAddress(
        parsedUrl.hostname,
        response.socket.remoteAddress,
        { allowMissingWhenLookupGuarded: true }
      );
      if (!socketAddress.ok) {
        response.destroy(socketAddress.error);
        reject(socketAddress.error);
        return;
      }

      resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? "",
        url,
        headers: headersForIncomingMessage(response.headers),
        body: Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>,
        arrayBuffer: async () => {
          const buffer = await readIncomingMessageToBuffer(response);
          return Uint8Array.from(buffer).buffer;
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

export function validateArtifactSocketRemoteAddress(
  hostname: string,
  remoteAddress: string | undefined,
  options?: { allowMissingWhenLookupGuarded?: boolean }
): Result<void, Error> {
  if (!remoteAddress) {
    if (options?.allowMissingWhenLookupGuarded) {
      return ok(undefined);
    }

    return err(
      new BlockedArtifactRemoteAddressError({
        hostname: normalizeUrlHostname(hostname),
        remoteAddress: "<missing>",
        reason: "missing_remote_address"
      })
    );
  }

  const normalizedRemoteAddress = normalizeUrlHostname(remoteAddress);
  const blockedReason = blockedRemoteArtifactHostReason(normalizedRemoteAddress);
  if (!blockedReason) {
    return ok(undefined);
  }

  return err(
    new BlockedArtifactRemoteAddressError({
      hostname: normalizeUrlHostname(hostname),
      remoteAddress: normalizedRemoteAddress,
      reason: blockedReason
    })
  );
}

async function defaultArtifactHostResolver(hostname: string): Promise<ArtifactHostResolution[]> {
  return lookup(hostname, {
    all: true,
    verbatim: true
  });
}

export function secureArtifactLookup(
  hostname: string,
  options: ArtifactLookupOptions,
  callback: (
    error: Error | null,
    addressOrAddresses: string | ArtifactHostResolution[],
    family?: number
  ) => void
): void {
  const lookupOptions: LookupOptions = typeof options === "number"
    ? { family: options }
    : options;
  createSecureArtifactLookup(defaultArtifactHostResolver)(hostname, lookupOptions, callback);
}

function createSecureArtifactLookup(
  resolveArtifactHost: ArtifactHostResolver
): import("node:net").LookupFunction {
  return (hostname, options, callback) => {
    resolveArtifactHost(hostname)
    .then((resolutions) => {
      const selection = selectSecureArtifactLookupResponse(hostname, options, resolutions);
      if (!selection.ok) {
        respondToSecureArtifactLookupError(callback, options, selection.error);
        return;
      }

      if (selection.value.all) {
        callback(null, selection.value.resolutions);
        return;
      }

      callback(null, selection.value.address, selection.value.family);
    })
    .catch((cause) => {
      respondToSecureArtifactLookupError(
        callback,
        options,
        cause instanceof Error ? cause : new Error(String(cause))
      );
    });
  };
}

function createCachingArtifactHostResolver(
  resolveArtifactHost: ArtifactHostResolver,
  now: () => number = Date.now
): ArtifactHostResolver {
  const cache = new Map<string, {
    expiresAt: number;
    resolutions: Promise<ArtifactHostResolution[]>;
  }>();

  return async (hostname) => {
    const normalizedHostname = normalizeUrlHostname(hostname);
    const current = cache.get(normalizedHostname);
    const currentTime = now();
    if (current && current.expiresAt > currentTime) {
      return current.resolutions;
    }

    const resolutions = resolveArtifactHost(normalizedHostname);
    cache.delete(normalizedHostname);
    cache.set(normalizedHostname, {
      expiresAt: currentTime + ARTIFACT_HOST_RESOLUTION_CACHE_TTL_MS,
      resolutions
    });
    while (cache.size > ARTIFACT_HOST_RESOLUTION_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }

    try {
      return await resolutions;
    } catch (cause) {
      const cached = cache.get(normalizedHostname);
      if (cached?.resolutions === resolutions) {
        cache.delete(normalizedHostname);
      }
      throw cause;
    }
  };
}

export function selectSecureArtifactLookupResponse(
  hostname: string,
  options: ArtifactLookupOptions | undefined,
  resolutions: ArtifactHostResolution[]
): Result<SecureArtifactLookupSelection, Error> {
  const normalizedOptions = normalizeArtifactLookupOptions(options);
  const normalizedHostname = normalizeUrlHostname(hostname);

  if (resolutions.length === 0) {
    return err(new Error(`Artifact host ${normalizedHostname} returned no DNS addresses.`));
  }

  const familyResolutions = normalizedOptions.family === undefined
    ? resolutions
    : resolutions.filter((resolution) => resolution.family === normalizedOptions.family);

  if (familyResolutions.length === 0) {
    return err(new Error(`Artifact host ${normalizedHostname} returned no matching DNS addresses.`));
  }

  for (const resolution of familyResolutions) {
    const blockedReason = blockedRemoteArtifactHostReason(resolution.address);
    if (blockedReason) {
      return err(
        new Error(
          `Blocked artifact host resolution for ${normalizedHostname}: ${normalizeUrlHostname(resolution.address)} (${blockedReason}).`
        )
      );
    }
  }

  if (normalizedOptions.all) {
    return ok({
      all: true,
      resolutions: familyResolutions
    });
  }

  const selected = familyResolutions[0] as ArtifactHostResolution;
  return ok({
    all: false,
    address: selected.address,
    family: selected.family
  });
}

function normalizeArtifactLookupOptions(options: ArtifactLookupOptions | undefined): {
  all: boolean;
  family: number | undefined;
} {
  const rawFamily = typeof options === "number" ? options : options?.family;
  const family = rawFamily === "IPv4"
    ? 4
    : rawFamily === "IPv6"
      ? 6
      : rawFamily;
  return {
    all: typeof options === "object" && options?.all === true,
    family: family === 4 || family === 6 ? family : undefined
  };
}

function respondToSecureArtifactLookupError(
  callback: (
    error: Error | null,
    addressOrAddresses: string | ArtifactHostResolution[],
    family?: number
  ) => void,
  options: ArtifactLookupOptions | undefined,
  error: Error
): void {
  if (normalizeArtifactLookupOptions(options).all) {
    callback(error, []);
    return;
  }

  callback(error, "", 0);
}

function headersForIncomingMessage(headers: IncomingHttpHeaders): {
  get: (name: string) => string | null;
} {
  return {
    get: (name: string): string | null => {
      const value = headers[name.toLowerCase()];
      if (Array.isArray(value)) {
        return value.join(", ");
      }

      return typeof value === "string" ? value : null;
    }
  };
}

async function readIncomingMessageToBuffer(message: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  }

  return Buffer.concat(chunks);
}
