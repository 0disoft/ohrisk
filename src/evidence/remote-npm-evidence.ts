import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, type Result } from "../shared/result";
import { yarnCacheOnlyIntegrityWarning } from "./evidence-failure";
import { parseRegistryMetadata, npmRegistryPackageVersionUrl, readRegistryTarballUrl } from "./registry-metadata";
import { collectRemoteTarballEvidence } from "./remote-package-evidence";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";

export async function collectNpmRegistryTarballEvidence(input: {
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
    ...(input.node.yarnCacheChecksum
      ? { unverifiedIntegrityWarning: yarnCacheOnlyIntegrityWarning() }
      : {}),
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
