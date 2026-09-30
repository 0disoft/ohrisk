import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { collectCargoCrateEvidence } from "./cargo-crate";
import { CARGO_GITHUB_ARCHIVE_HOSTS, collectCargoGitHubArchiveEvidenceBatch, parseCargoGitHubSource } from "./cargo-git";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import { unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { CARGO_CRATES_IO_SOURCES, CARGO_CRATE_BASE_URL, CARGO_CRATE_HOSTS, type CargoGitHubArchiveEvidenceCacheEntry, type CargoGitHubArchiveEvidenceCache } from "./collection-runtime";

export function createCargoGitHubArchiveEvidenceCache(
  nodes: readonly DependencyNode[]
): CargoGitHubArchiveEvidenceCache {
  const cache = new Map<string, CargoGitHubArchiveEvidenceCacheEntry>();
  for (const node of nodes) {
    if (node.ecosystem !== "cargo") {
      continue;
    }
    const source = parseCargoGitHubSource(node.resolved);
    if (!source) {
      continue;
    }
    const existing = cache.get(source.archiveUrl);
    const requestedPackage = {
      packageId: node.id,
      packageName: node.name,
      version: node.version
    };
    if (existing) {
      existing.packages.push(requestedPackage);
    } else {
      cache.set(source.archiveUrl, {
        source,
        packages: [requestedPackage]
      });
    }
  }
  return cache;
}

export async function collectRemoteCargoCrateEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  cargoGitHubArchiveEvidenceCache: CargoGitHubArchiveEvidenceCache;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const gitHubSource = parseCargoGitHubSource(input.node.resolved);
  if (gitHubSource) {
    const cacheEntry = input.cargoGitHubArchiveEvidenceCache.get(gitHubSource.archiveUrl);
    if (!cacheEntry) {
      return ok(unsupportedRemoteEcosystemEvidence({
        node: input.node,
        reason: "Commit-pinned Cargo Git source was not registered in the current evidence batch."
      }));
    }
    cacheEntry.result ??= collectCargoGitHubArchiveEvidenceIndex({
      cacheEntry,
      representativeNode: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      artifactMaxBytes: input.artifactMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
    const collected = await cacheEntry.result;
    if (!collected.ok) {
      return collected;
    }
    return ok(collected.value.get(input.node.id) ?? unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "Commit-pinned Cargo Git archive did not produce evidence for the locked package."
    }));
  }

  if (!input.node.resolved || !CARGO_CRATES_IO_SOURCES.has(input.node.resolved)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "Cargo path, non-GitHub Git, non-commit-pinned Git, and non-crates.io registry sources are not fetched during a remote repository scan."
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

async function collectCargoGitHubArchiveEvidenceIndex(input: {
  cacheEntry: CargoGitHubArchiveEvidenceCacheEntry;
  representativeNode: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<ReadonlyMap<string, LicenseEvidence>, OhriskError>> {
    const archive = await readRemoteArtifactBytes({
      code: "TARBALL_FETCH_FAILED",
      packageId: input.representativeNode.id,
      url: input.cacheEntry.source.archiveUrl,
      blockedMessage: "Cargo GitHub archive URL targets an unsupported or blocked host.",
      resolveFailureMessage: "Failed to resolve the Cargo GitHub archive host.",
      fetchFailureMessage: "Failed to fetch the commit-pinned Cargo GitHub archive.",
      tooLargeMessage: "Cargo GitHub archive response exceeded the maximum supported size.",
      unreadableMessage: "Cargo GitHub archive response did not expose a readable body stream.",
      offlineMissMessage: "Offline mode could not find the Cargo GitHub archive in the artifact cache.",
      details: {
        owner: input.cacheEntry.source.owner,
        repository: input.cacheEntry.source.repository,
        commit: input.cacheEntry.source.commit
      },
      maxBytes: input.artifactMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: CARGO_GITHUB_ARCHIVE_HOSTS,
      urlDetailKey: "resolved"
    });
    if (!archive.ok) {
      return archive;
    }
    return collectCargoGitHubArchiveEvidenceBatch({
      packages: input.cacheEntry.packages,
      source: input.cacheEntry.source,
      archive: archive.value,
      artifactMaxBytes: input.artifactMaxBytes
    });
}
