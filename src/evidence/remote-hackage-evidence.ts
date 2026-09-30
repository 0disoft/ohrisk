import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { safeUrlForErrorDetails } from "./artifact-url";
import { collectHackageCabalEvidence } from "./hackage-package";
import { verifyPackageIntegrity } from "./package-integrity";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { isPackageIntegrityMismatch, unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { HACKAGE_CABAL_HOSTS, HACKAGE_CABAL_MAX_HISTORICAL_REVISIONS } from "./collection-runtime";

export async function collectRemoteHackageCabalEvidence(input: {
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
