import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { collectRubyGemArchiveEvidence, parseRubyGemsVersionMetadata, rubyGemsVersionMetadataUrl } from "./rubygems-package";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import { unavailableRemoteArchiveLimitEvidence, unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { RUBYGEMS_ORG_HOSTS } from "./collection-runtime";

export async function collectRemoteRubyGemEvidence(input: {
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
