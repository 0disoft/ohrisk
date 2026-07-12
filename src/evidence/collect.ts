import { createHash, timingSafeEqual } from "node:crypto";
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
import { collectRegisteredEcosystemEvidence } from "../ecosystems/registry";
import { collectLocalPackageEvidence } from "./local-package";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import { collectZipPackageEvidence } from "./zip-package";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
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
type ArtifactLookupOptions = number | {
  all?: boolean;
  family?: number;
};
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
  const baseFetchArtifact = input.fetchArtifact ?? createDefaultArtifactFetcher(allowedHosts);
  const fetchArtifact = withRegistryAuthorization(baseFetchArtifact, input.registryAuthTokens);
  const resolveArtifactHost =
    input.resolveArtifactHost ??
    (input.fetchArtifact ? undefined : defaultArtifactHostResolver);
  const artifactCache = input.cacheDir ? createArtifactCache(input.cacheDir) : undefined;
  const fetchTimeoutMs = input.fetchTimeoutMs ?? ARTIFACT_FETCH_TIMEOUT_MS;
  const registryMetadataMaxBytes = input.registryMetadataMaxBytes ?? REGISTRY_METADATA_MAX_BYTES;
  const tarballMaxBytes = input.tarballMaxBytes ?? PACKAGE_TARBALL_MAX_BYTES;
  const installedPackageJsonMaxBytes =
    input.installedPackageJsonMaxBytes ?? INSTALLED_PACKAGE_JSON_MAX_BYTES;

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
        ...(workspaceRoot.value ? { workspaceRoot: workspaceRoot.value } : {}),
        fetchArtifact,
        resolveArtifactHost,
        fetchTimeoutMs,
        registryMetadataMaxBytes,
        tarballMaxBytes,
        installedPackageJsonMaxBytes,
        offline: input.offline ?? false,
        artifactCache,
        npmRegistryUrl: input.npmRegistryUrl,
        allowedHosts
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
  workspaceRoot?: string;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  installedPackageJsonMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const ecosystemEvidence = collectRegisteredEcosystemEvidence({
    node: input.node,
    projectRoot: input.projectRoot
  });
  if (ecosystemEvidence) {
    return ecosystemEvidence;
  }

  const explicitLocalPath = input.node.resolved
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

  const nodeModulesPath = findNodeModulesPackage({
    node: input.node,
    projectRoot: input.projectRoot,
    packageJsonMaxBytes: input.installedPackageJsonMaxBytes
  });
  if (nodeModulesPath) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  const yarnCacheEvidence = collectYarnCachePackageEvidence({
    node: input.node,
    projectRoot: input.projectRoot,
    zipMaxBytes: input.tarballMaxBytes
  });
  if (!yarnCacheEvidence.ok) {
    return err(yarnCacheEvidence.error);
  }

  if (yarnCacheEvidence.value) {
    return ok(yarnCacheEvidence.value);
  }

  if (!input.node.resolved) {
    return collectRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      npmRegistryUrl: input.npmRegistryUrl,
      allowedHosts: input.allowedHosts
    });
  }

  if (isHttpUrl(input.node.resolved)) {
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
      allowedHosts: input.allowedHosts
    });
  }

  return ok({
    packageId: input.node.id,
    files: [],
    source: "unavailable",
    warnings: [`Unsupported resolved artifact specifier: ${safeUrlForErrorDetails(input.node.resolved)}`]
  });
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

async function collectRegistryTarballEvidence(input: {
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
  projectRoot: string;
  zipMaxBytes: number;
}): Result<LicenseEvidence | undefined, OhriskError> {
  const cacheDir = path.join(input.projectRoot, ".yarn", "cache");
  if (!existsSync(cacheDir) || !isReadableDirectory(cacheDir)) {
    return ok(undefined);
  }

  const filenamePrefix = yarnCacheFilenamePrefix(input.node);
  if (!filenamePrefix) {
    return ok(undefined);
  }

  let entries;
  try {
    entries = readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) =>
        entry.isFile()
        && entry.name.startsWith(filenamePrefix)
        && entry.name.endsWith(".zip")
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read Yarn package cache directory.",
        details: {
          packageId: input.node.id,
          cacheDir,
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      })
    );
  }

  for (const entry of entries) {
    const cachePath = path.join(cacheDir, entry.name);
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
  urlDetailKey: "registryUrl" | "resolved";
  skipPreflight?: boolean;
}): Promise<Result<Buffer, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.url,
    message: input.blockedMessage,
    details: input.details,
    allowedHosts: input.allowedHosts
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

  if (!input.skipPreflight) {
    const preflight = await preflightRemoteArtifactFetchTarget({
      code: input.code,
      packageId: input.packageId,
      resolved: input.url,
      message: input.blockedMessage,
      resolveFailureMessage: input.resolveFailureMessage,
      details: input.details,
      resolveArtifactHost: input.resolveArtifactHost,
      allowedHosts: input.allowedHosts
    });
    if (!preflight.ok) {
      return err(preflight.error);
    }
  }

  const artifact = await readArtifactWithTimeout<RemoteArtifactRead>({
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
      allowedHosts: input.allowedHosts
    },
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
  readResponse: (
    response: ArtifactFetchResponse,
    signal: AbortSignal
  ) => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timeoutError = new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`);
      controller.abort();
      reject(timeoutError);
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
      .then(async (response) => {
        if (!response.ok) {
          return err(response.error);
        }

        const result = await input.readResponse(response.value, controller.signal);
        if (timeoutError) {
          throw timeoutError;
        }

        return result;
      });
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
  allowedHosts?: ReadonlySet<string>;
}): Promise<Result<void, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: input.message,
    details: input.details,
    ...(input.allowedHosts ? { allowedHosts: input.allowedHosts } : {})
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
  const explicitlyAllowed = isExplicitlyAllowedArtifactHost(
    artifactHost,
    input.allowedHosts
  );
  if (explicitlyAllowed) {
    return ok(undefined);
  }
  if (!shouldResolveRemoteArtifactHost(artifactHost)) {
    return ok(undefined);
  }

  let resolutions: ArtifactHostResolution[];
  try {
    resolutions = await input.resolveArtifactHost(artifactHost);
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
    if (url.username === "" && url.password === "") {
      return redactUrlCredentialsInText(value);
    }

    if (url.username !== "") {
      url.username = "redacted";
    }
    if (url.password !== "") {
      url.password = "redacted";
    }

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

function npmRegistryPackageUrl(name: string, registryUrl?: string): string {
  const baseUrl = (registryUrl ?? "https://registry.npmjs.org").replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(name).replace(/^%40/, "@")}`;
}

function readRegistryTarballUrl(metadata: unknown, version: string): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const dist = metadata.dist;
  if (isRecord(dist) && typeof dist.tarball === "string") {
    return dist.tarball;
  }

  const versions = metadata.versions;
  if (!isRecord(versions)) {
    return undefined;
  }

  const versionMetadata = versions[version];
  if (!isRecord(versionMetadata)) {
    return undefined;
  }

  const versionDist = versionMetadata.dist;
  if (!isRecord(versionDist) || typeof versionDist.tarball !== "string") {
    return undefined;
  }

  return versionDist.tarball;
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
  allowedHosts: ReadonlySet<string>
): ArtifactFetcher {
  return (url, options) => defaultArtifactFetcher(url, options, allowedHosts);
}

function defaultArtifactFetcher(
  url: string,
  options: ArtifactFetchOptions | undefined,
  allowedHosts: ReadonlySet<string>
): Promise<ArtifactFetchResponse> {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl || parsedUrl.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported artifact URL: ${safeUrlForErrorDetails(url)}`));
  }

  return new Promise((resolve, reject) => {
    const normalizedHost = normalizeUrlHostname(parsedUrl.hostname);
    const explicitlyAllowed = allowedHosts.has(normalizedHost);
    const req = httpsRequest(parsedUrl, {
      method: "GET",
      signal: options?.signal,
      headers: options?.headers,
      ...(explicitlyAllowed ? {} : { lookup: secureArtifactLookup as import("node:net").LookupFunction })
    }, (response) => {
      const socketAddress = explicitlyAllowed
        ? ok(undefined)
        : validateArtifactSocketRemoteAddress(
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
  defaultArtifactHostResolver(hostname)
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
  const family = typeof options === "number" ? options : options?.family;
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
