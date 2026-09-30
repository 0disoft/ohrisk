import { safeUrlForErrorDetails } from "./artifact-url";
import { isCollectionAbortedError } from "./cancellation";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";

export function isRecoverableRemoteEvidenceError(error: OhriskError): boolean {
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

export function unavailableRemoteEvidence(input: {
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

export function isPackageIntegrityMismatch(error: OhriskError): boolean {
  return Array.isArray(error.details?.computed);
}

export function isPackageTarballTooLargeError(error: OhriskError): boolean {
  return (
    error.code === "TARBALL_FETCH_FAILED"
    && error.message === "Package tarball response exceeded the maximum supported size."
  ) || (
    error.code === "TARBALL_PARSE_FAILED"
    && error.message === "Failed to decompress package tarball evidence."
    && typeof error.details?.maxUnpackedBytes === "number"
  );
}

export function isPackageArtifactTooLargeError(error: OhriskError): boolean {
  return isPackageTarballTooLargeError(error) || (
    error.code === "TARBALL_FETCH_FAILED"
    && error.message === "Python distribution response exceeded the maximum supported size."
  );
}

export function unavailableOversizedTarballEvidence(packageId: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Package tarball evidence exceeded Ohrisk's size limit and was not scanned."
    ]
  };
}

export function unavailableRemoteArchiveLimitEvidence(
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

export function addIntegrityWarningWhenUnverified(input: {
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

export function unavailableUnverifiedRemoteTarballEvidence(
  packageId: string,
  warning = "Remote package artifact integrity was not available in the lockfile; tarball contents were not trusted."
): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [
      warning
    ]
  };
}

export function yarnCacheOnlyIntegrityWarning(): string {
  return "Yarn Berry checksum covers its cache ZIP, not the npm tarball; remote bytes were not trusted. Commit .yarn/cache or scan an installed checkout.";
}

export function unsupportedRemoteEcosystemEvidence(input: {
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
