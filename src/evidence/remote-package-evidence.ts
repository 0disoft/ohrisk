import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { safeOptionalUrlForErrorDetails, safeUrlForErrorDetails } from "./artifact-url";
import { verifyPackageIntegrity } from "./package-integrity";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import { type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { isPackageTarballTooLargeError, unavailableOversizedTarballEvidence, addIntegrityWarningWhenUnverified, unavailableUnverifiedRemoteTarballEvidence } from "./evidence-failure";
import { readRemoteArtifactBytes, validateRemoteArtifactUrl, preflightRemoteArtifactFetchTarget, createRemoteArtifactExceptionError } from "./remote-artifact-reader";

export function isGzipBytes(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function collectRemoteTarballEvidence(input: {
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
  collectEvidence?: (
    tarball: Buffer
  ) => Result<LicenseEvidence, OhriskError> | Promise<Result<LicenseEvidence, OhriskError>>;
  urlError?: {
    code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
    message: string;
    resolveFailureMessage: string;
    details: Record<string, unknown>;
  };
  skipIntegrityCheck?: boolean;
  unverifiedIntegrityWarning?: string;
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
    return ok(unavailableUnverifiedRemoteTarballEvidence(
      input.packageId,
      input.unverifiedIntegrityWarning
    ));
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
      ? await input.collectEvidence(tarball.value)
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
