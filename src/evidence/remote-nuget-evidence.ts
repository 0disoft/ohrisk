import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { safeUrlForErrorDetails } from "./artifact-url";
import { collectNugetNupkgEvidence } from "./nuget-nupkg";
import { parseSupportedIntegrityEntries } from "./package-integrity";
import { normalizeNugetVersion, parseNugetCatalogPackage, parseNugetPackageVersions, parseNugetRegistrationIndex, parseNugetRegistrationPage, parseNugetServiceIndex, type NugetServiceEndpoints } from "./nuget-registry";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { isGzipBytes } from "./remote-package-evidence";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { type NugetServiceIndexLoader, NUGET_SERVICE_INDEX_URL, NUGET_ORG_HOSTS } from "./collection-runtime";

export function createNugetServiceIndexLoader(input: {
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): NugetServiceIndexLoader {
  let pending: Promise<Result<NugetServiceEndpoints, OhriskError>> | undefined;
  return (packageId) => {
    pending ??= (async () => {
      const bytes = await readNugetRegistryBytes({
        packageId,
        url: NUGET_SERVICE_INDEX_URL,
        label: "service index",
        maxBytes: input.registryMetadataMaxBytes,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
      return bytes.ok
        ? parseNugetServiceIndex({ packageId, text: bytes.value.toString("utf8") })
        : bytes;
    })();
    return pending;
  };
}

export async function collectRemoteNugetPackageEvidence(input: {
  node: DependencyNode;
  allowLocalProjectEvidence: boolean;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  artifactMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  loadServiceIndex: NugetServiceIndexLoader;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(input.node.name)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "NuGet package ID was not safe for the public nuget.org V3 API."
    }));
  }
  if (!normalizeNugetVersion(input.node.version)) {
    return ok(unsupportedRemoteEcosystemEvidence({
      node: input.node,
      reason: "NuGet dependency version was not a safe exact version."
    }));
  }
  const lockDigest = input.node.integrity
    ? parseSupportedIntegrityEntries(input.node.integrity)
      .find((entry) => entry.algorithm === "sha512")?.digest
    : undefined;
  if (!lockDigest) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [nugetMissingIntegrityWarning(input.allowLocalProjectEvidence)]
    });
  }

  const service = await input.loadServiceIndex(input.node.id);
  if (!service.ok) {
    return service;
  }
  const lowerName = input.node.name.toLowerCase();
  const encodedName = encodeURIComponent(lowerName);
  const versionsUrl = `${service.value.packageBaseUrl}${encodedName}/index.json`;
  const versionsBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: versionsUrl,
    label: "package version index",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!versionsBytes.ok) {
    return versionsBytes;
  }
  const normalizedVersion = parseNugetPackageVersions({
    packageId: input.node.id,
    packageName: input.node.name,
    requestedVersion: input.node.version,
    text: versionsBytes.value.toString("utf8")
  });
  if (!normalizedVersion.ok) {
    return normalizedVersion;
  }

  const encodedVersion = encodeURIComponent(normalizedVersion.value);
  const packageContentUrl = `${service.value.packageBaseUrl}${encodedName}/${encodedVersion}/${encodedName}.${encodedVersion}.nupkg`;
  const registrationUrl = `${service.value.registrationsBaseUrl}${encodedName}/index.json`;
  const registrationBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: registrationUrl,
    label: "registration index",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!registrationBytes.ok) {
    return registrationBytes;
  }
  const lookup = parseNugetRegistrationIndex({
    packageId: input.node.id,
    packageName: input.node.name,
    normalizedVersion: normalizedVersion.value,
    expectedPackageContentUrl: packageContentUrl,
    text: registrationBytes.value.toString("utf8")
  });
  if (!lookup.ok) {
    return lookup;
  }

  let registrationLeaf;
  if (lookup.value.kind === "leaf") {
    registrationLeaf = lookup.value.leaf;
  } else {
    const pageBytes = await readNugetRegistryBytes({
      packageId: input.node.id,
      url: lookup.value.pageUrl,
      label: "registration page",
      maxBytes: input.registryMetadataMaxBytes,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
    if (!pageBytes.ok) {
      return pageBytes;
    }
    const page = parseNugetRegistrationPage({
      packageId: input.node.id,
      packageName: input.node.name,
      normalizedVersion: normalizedVersion.value,
      expectedPackageContentUrl: packageContentUrl,
      text: pageBytes.value.toString("utf8")
    });
    if (!page.ok) {
      return page;
    }
    registrationLeaf = page.value;
  }

  const catalogBytes = await readNugetRegistryBytes({
    packageId: input.node.id,
    url: registrationLeaf.catalogUrl,
    label: "catalog leaf",
    maxBytes: input.registryMetadataMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts
  });
  if (!catalogBytes.ok) {
    return catalogBytes;
  }
  const catalog = parseNugetCatalogPackage({
    packageId: input.node.id,
    packageName: input.node.name,
    normalizedVersion: normalizedVersion.value,
    text: catalogBytes.value.toString("utf8")
  });
  if (!catalog.ok) {
    return catalog;
  }
  const catalogDigest = Buffer.from(catalog.value.packageHash, "base64");
  if (
    catalogDigest.length !== lockDigest.length
    || !timingSafeEqual(catalogDigest, lockDigest)
  ) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "NuGet catalog package hash did not match the selected dependency input.",
      details: {
        packageId: input.node.id,
        packageName: input.node.name,
        version: normalizedVersion.value,
        reason: "nuget_catalog_lock_hash_mismatch"
      }
    }));
  }
  if (catalog.value.packageSize > input.artifactMaxBytes) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: [
        "NuGet package source was not fetched because the catalog-declared package size exceeded the configured artifact limit."
      ]
    });
  }

  const nupkg = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.node.id,
    url: registrationLeaf.packageContentUrl,
    blockedMessage: "NuGet package content URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve the nuget.org package content host.",
    fetchFailureMessage: "Failed to fetch NuGet package content.",
    tooLargeMessage: "NuGet package content exceeded the maximum supported size.",
    unreadableMessage: "NuGet package content did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find NuGet package content in the artifact cache.",
    details: {
      packageName: input.node.name,
      version: normalizedVersion.value
    },
    maxBytes: Math.min(input.artifactMaxBytes, catalog.value.packageSize),
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: NUGET_ORG_HOSTS,
    urlDetailKey: "resolved"
  });
  if (!nupkg.ok) {
    return nupkg;
  }
  return collectNugetNupkgEvidence({
    packageId: input.node.id,
    packageName: input.node.name,
    version: input.node.version,
    normalizedVersion: normalizedVersion.value,
    expectedSha512: catalog.value.packageHash,
    expectedSize: catalog.value.packageSize,
    nupkg: nupkg.value,
    artifactMaxBytes: input.artifactMaxBytes
  });
}

function nugetMissingIntegrityWarning(allowLocalProjectEvidence: boolean): string {
  if (allowLocalProjectEvidence) {
    return "NuGet package source was not fetched because the selected dependency input did not contain an exact SHA-512 package content hash. Restore the project, then rerun Ohrisk against the local checkout; use --lockfile obj/project.assets.json or a generated packages.lock.json when available.";
  }

  return "NuGet package source was not fetched because this non-local input did not contain an exact SHA-512 package content hash. For a repository URL, commit a generated packages.lock.json with contentHash entries; otherwise clone or extract, restore, and scan the local checkout.";
}

async function readNugetRegistryBytes(input: {
  packageId: string;
  url: string;
  label: string;
  maxBytes: number;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<Buffer, OhriskError>> {
  const response = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.packageId,
    url: input.url,
    blockedMessage: `NuGet ${input.label} URL targets an unsupported or blocked host.`,
    resolveFailureMessage: `Failed to resolve the nuget.org ${input.label} host.`,
    fetchFailureMessage: `Failed to fetch NuGet ${input.label}.`,
    tooLargeMessage: `NuGet ${input.label} exceeded the maximum supported size.`,
    unreadableMessage: `NuGet ${input.label} did not expose a readable body stream.`,
    offlineMissMessage: `Offline mode could not find NuGet ${input.label} in the artifact cache.`,
    details: { registryUrl: input.url },
    maxBytes: input.maxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: NUGET_ORG_HOSTS,
    urlDetailKey: "registryUrl"
  });
  if (!response.ok || !isGzipBytes(response.value)) {
    return response;
  }
  try {
    return ok(gunzipSync(response.value, { maxOutputLength: input.maxBytes }));
  } catch (cause) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: `NuGet ${input.label} gzip response was malformed or exceeded the maximum supported size.`,
      details: {
        packageId: input.packageId,
        registryUrl: safeUrlForErrorDetails(input.url),
        maxBytes: input.maxBytes,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }
}
