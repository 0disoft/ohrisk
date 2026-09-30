import { normalizeUrlHostname } from "./artifact-transport";
import { parseHttpUrl, safeErrorCauseForDetails } from "./artifact-url";
import type { DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export function shouldCollectNpmRegistryEvidence(input: {
  node: DependencyNode;
  npmRegistryUrl: string | undefined;
}): boolean {
  if (!input.node.resolved) {
    return true;
  }
  if (input.node.direct) {
    return false;
  }

  const resolvedUrl = parseHttpUrl(input.node.resolved);
  const registryUrl = parseHttpUrl(input.npmRegistryUrl ?? "https://registry.npmjs.org");
  return resolvedUrl?.protocol === "https:"
    && registryUrl?.protocol === "https:"
    && normalizeUrlHostname(resolvedUrl.hostname) === normalizeUrlHostname(registryUrl.hostname);
}

export function parseRegistryMetadata(input: {
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

export function npmRegistryPackageVersionUrl(
  name: string,
  version: string,
  registryUrl?: string
): string {
  return `${npmRegistryPackageUrl(name, registryUrl)}/${encodeURIComponent(version)}`;
}

export function pypiPackageVersionUrl(name: string, version: string): string {
  return `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
}

export function remoteArtifactFilename(resolved: string): string | undefined {
  const parsed = parseHttpUrl(resolved);
  const encodedFilename = parsed?.pathname.split("/").pop();
  if (!encodedFilename) {
    return undefined;
  }
  try {
    return decodeURIComponent(encodedFilename);
  } catch {
    return encodedFilename;
  }
}

function npmRegistryPackageUrl(name: string, registryUrl?: string): string {
  const baseUrl = (registryUrl ?? "https://registry.npmjs.org").replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(name).replace(/^%40/, "@")}`;
}

export function readRegistryTarballUrl(metadata: unknown, version: string): string | undefined {
  const versionMetadata = readRegistryVersionMetadata(metadata, version);
  if (!versionMetadata) {
    return undefined;
  }

  const dist = versionMetadata.dist;
  if (isRecord(dist) && typeof dist.tarball === "string") {
    return dist.tarball;
  }

  return undefined;
}

function readRegistryVersionMetadata(
  metadata: unknown,
  version: string
): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  if (metadata.version === version || !isRecord(metadata.versions)) {
    return metadata;
  }

  const versions = metadata.versions;
  const versionMetadata = versions[version];
  return isRecord(versionMetadata) ? versionMetadata : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
