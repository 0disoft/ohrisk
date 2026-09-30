import { recordArtifactCheck } from "./artifact-capture";
import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { collectGoModuleZipEvidence, readChecksumVerifiedGoModuleRequirements } from "./go-module-zip";
import { GO_MODULE_PROXY_BASE_URL, goModuleProxyModUrl, goModuleProxyZipUrl, remoteGoModuleCoordinates } from "./go-proxy-url";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import { unavailableRemoteEvidence, unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { GO_MODULE_PROXY_HOSTS, GO_MODULE_MOD_MAX_BYTES, GO_MODULE_TRANSIENT_FETCH_ATTEMPTS, GO_MODULE_TRANSIENT_RETRY_DELAY_MS } from "./collection-runtime";

export async function collectRemoteGoModuleEvidence(input: {
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

export async function collectVerifiedRemoteGoModuleRequirements(input: {
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
  if (requirements !== undefined) recordArtifactCheck({ packageId: input.node.id, bytes: goMod.value, kind: "go-mod-h1", value: goModChecksum });
  return ok(requirements === undefined
    ? input.evidence
    : { ...input.evidence, goModuleRequirements: requirements });
}
