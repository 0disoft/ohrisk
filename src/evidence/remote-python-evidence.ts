import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { safeOptionalUrlForErrorDetails, safeUrlForErrorDetails } from "./artifact-url";
import { sha256HexIntegrity, verifyPackageIntegrity } from "./package-integrity";
import { collectPythonDistributionEvidence, parsePyPiReleaseMetadata } from "./pypi-package";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { isPackageArtifactTooLargeError, unavailableOversizedTarballEvidence, unavailableRemoteArchiveLimitEvidence, unavailableUnverifiedRemoteTarballEvidence } from "./evidence-failure";
import { pypiPackageVersionUrl } from "./registry-metadata";
import { readRemoteArtifactBytes, validateRemoteArtifactUrl, preflightRemoteArtifactFetchTarget, createRemoteArtifactExceptionError } from "./remote-artifact-reader";
import { PYPI_METADATA_HOSTS, PYPI_DISTRIBUTION_HOSTS } from "./collection-runtime";

export async function collectPyPiReleaseEvidence(input: {
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

export async function collectRemotePythonDistributionEvidence(input: {
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
