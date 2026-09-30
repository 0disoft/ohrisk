import { createHash, timingSafeEqual } from "node:crypto";
import { recordArtifactCheck } from "./artifact-capture";
import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { normalizeUrlHostname, type ArtifactHostResolver } from "./artifact-transport";
import { parseHttpUrl } from "./artifact-url";
import { collectMavenJarEvidence } from "./maven-jar";
import { MAVEN_LICENSE_PARENT_MAX_DEPTH, mavenCoordinateKey, parseMavenPackageCoordinates, parseMavenPomLicenseMetadata, type MavenPomLicenseMetadata } from "./maven-package";
import type { LicenseEvidence } from "./types";
import { createError, type OhriskError } from "../shared/errors";
import { mavenPomRepositoryPath, type MavenCoordinates } from "../shared/maven-repository";
import { err, ok, type Result } from "../shared/result";
import { readRemoteArtifactBytes } from "./remote-artifact-reader";
import { type MavenEvidenceCollector, type MavenRepositoryEndpoint, type MavenPomLookup, MAVEN_CENTRAL_BASE_URL, MAVEN_CENTRAL_HOSTS, MAVEN_CHECKSUM_MAX_BYTES } from "./collection-runtime";

export function createMavenEvidenceCollector(input: {
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  jarMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
  repositoryUrls: string[];
}): MavenEvidenceCollector {
  const repositories = mavenRepositoryEndpoints(input.repositoryUrls, input.allowedHosts);
  const pomRequests = new Map<
    string,
    Promise<Result<MavenPomLookup, OhriskError>>
  >();

  const loadPom = (
    coordinates: MavenCoordinates
  ): Promise<Result<MavenPomLookup, OhriskError>> => {
    const key = mavenCoordinateKey(coordinates);
    const existing = pomRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = loadMavenPomFromRepositories({
      coordinates,
      repositories,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      pomMaxBytes: input.pomMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
    pomRequests.set(key, request);
    return request;
  };

  return async (node) => {
    const requested = parseMavenPackageCoordinates(node.name, node.version);
    if (!requested) {
      return err(createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "unsupported_input",
        message: "Maven dependency did not contain safe exact repository coordinates.",
        details: {
          packageId: node.id,
          coordinates: node.name,
          version: node.version
        }
      }));
    }

    const visited = new Set<string>();
    let current = requested;
    let artifactRepository: MavenRepositoryEndpoint | undefined;
    for (let depth = 0; depth <= MAVEN_LICENSE_PARENT_MAX_DEPTH; depth += 1) {
      const coordinateKey = mavenCoordinateKey(current);
      if (visited.has(coordinateKey)) {
        return err(createError({
          code: "REGISTRY_METADATA_FETCH_FAILED",
          category: "unsupported_input",
          message: "Maven Central POM license inheritance contains a parent cycle.",
          details: {
            packageId: node.id,
            coordinates: coordinateKey,
            reason: "parent_cycle"
          }
        }));
      }
      visited.add(coordinateKey);

      const metadata = await loadPom(current);
      if (!metadata.ok) {
        return metadata;
      }
      if (depth === 0) {
        artifactRepository = metadata.value.repository;
      }
      if (metadata.value.metadata.licenses.length > 0) {
        return ok({
          packageId: node.id,
          metadataLicense: metadata.value.metadata.licenses.join(" OR "),
          metadataSource: depth === 0
            ? `${metadata.value.repository.label} pom.xml`
            : `${metadata.value.repository.label} parent pom.xml (${coordinateKey})`,
          files: [],
          source: "tarball",
          warnings: []
        });
      }
      if (!metadata.value.metadata.parent) {
        const jarEvidence = artifactRepository
          ? await collectRemoteMavenJarEvidence({
              packageId: node.id,
              coordinates: requested,
              repository: artifactRepository,
              fetchArtifact: input.fetchArtifact,
              resolveArtifactHost: input.resolveArtifactHost,
              fetchTimeoutMs: input.fetchTimeoutMs,
              jarMaxBytes: input.jarMaxBytes,
              offline: input.offline,
              artifactCache: input.artifactCache,
              signal: input.signal,
              allowedHosts: input.allowedHosts
            })
          : ok(undefined);
        if (!jarEvidence.ok) {
          return jarEvidence;
        }
        if (jarEvidence.value) {
          return ok(jarEvidence.value);
        }
        return ok({
          packageId: node.id,
          files: [],
          source: "tarball",
          warnings: [
            `${metadata.value.repository.label} POM and its resolvable parent chain did not declare license names.`
          ]
        });
      }

      current = metadata.value.metadata.parent;
    }

    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven Central POM license inheritance exceeded the maximum supported parent depth.",
      details: {
        packageId: node.id,
        coordinates: mavenCoordinateKey(current),
        reason: "parent_depth",
        maxParentDepth: MAVEN_LICENSE_PARENT_MAX_DEPTH
      }
    }));
  };
}

function mavenRepositoryEndpoints(
  repositoryUrls: string[],
  allowedHosts: ReadonlySet<string>
): MavenRepositoryEndpoint[] {
  const endpoints: MavenRepositoryEndpoint[] = [{
    baseUrl: MAVEN_CENTRAL_BASE_URL,
    label: "Maven Central",
    permittedHosts: MAVEN_CENTRAL_HOSTS
  }];
  const seen = new Set([MAVEN_CENTRAL_BASE_URL]);

  for (const rawUrl of repositoryUrls) {
    const parsed = parseHttpUrl(rawUrl);
    if (
      !parsed
      || parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
    ) {
      continue;
    }
    const host = normalizeUrlHostname(parsed.hostname);
    if (!allowedHosts.has(host)) {
      continue;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    const baseUrl = parsed.toString().replace(/\/$/u, "");
    if (seen.has(baseUrl)) {
      continue;
    }
    seen.add(baseUrl);
    endpoints.push({
      baseUrl,
      label: `Maven repository ${host}`,
      permittedHosts: new Set([host])
    });
  }

  return endpoints;
}

async function loadMavenPomFromRepositories(input: {
  coordinates: MavenCoordinates;
  repositories: MavenRepositoryEndpoint[];
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<MavenPomLookup, OhriskError>> {
  let firstNetworkError: OhriskError | undefined;
  for (const repository of input.repositories) {
    const loaded = await loadMavenPomFromRepository({
      ...input,
      repository
    });
    if (loaded.ok) {
      return ok({ metadata: loaded.value, repository });
    }
    if (loaded.error.category !== "network") {
      return loaded;
    }
    firstNetworkError ??= loaded.error;
  }

  return err(firstNetworkError ?? createError({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    category: "network",
    message: "Failed to fetch Maven POM metadata.",
    details: {
      coordinates: mavenCoordinateKey(input.coordinates),
      reason: "no_permitted_repository"
    }
  }));
}

async function loadMavenPomFromRepository(input: {
  coordinates: MavenCoordinates;
  repository: MavenRepositoryEndpoint;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  pomMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<MavenPomLicenseMetadata, OhriskError>> {
  const repositoryPath = mavenPomRepositoryPath(input.coordinates);
  const coordinateKey = mavenCoordinateKey(input.coordinates);
  if (!repositoryPath) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven POM coordinates were not safe exact repository coordinates.",
      details: { packageId: coordinateKey, coordinates: coordinateKey }
    }));
  }

  const pomUrl = `${input.repository.baseUrl}/${repositoryPath}`;
  const central = input.repository.baseUrl === MAVEN_CENTRAL_BASE_URL;
  const pomBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: coordinateKey,
    url: pomUrl,
    blockedMessage: "Maven POM URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: central
      ? "Failed to fetch Maven Central POM metadata."
      : "Failed to fetch Maven repository POM metadata.",
    tooLargeMessage: "Maven POM response exceeded the maximum supported size.",
    unreadableMessage: "Maven POM response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find Maven POM metadata in the artifact cache.",
    details: { registryUrl: pomUrl, coordinates: coordinateKey },
    maxBytes: input.pomMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "registryUrl"
  });
  if (!pomBytes.ok) {
    return pomBytes;
  }

  return parseMavenPomLicenseMetadata({
    packageId: coordinateKey,
    requested: input.coordinates,
    source: pomUrl,
    text: pomBytes.value.toString("utf8")
  });
}

async function collectRemoteMavenJarEvidence(input: {
  packageId: string;
  coordinates: MavenCoordinates;
  repository: MavenRepositoryEndpoint;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  jarMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  allowedHosts: ReadonlySet<string>;
}): Promise<Result<LicenseEvidence | undefined, OhriskError>> {
  const pomPath = mavenPomRepositoryPath(input.coordinates);
  if (!pomPath) {
    return err(createError({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "Maven JAR coordinates were not safe exact repository coordinates.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates)
      }
    }));
  }
  const jarPath = pomPath.replace(/\.pom$/u, ".jar");
  const jarUrl = `${input.repository.baseUrl}/${jarPath}`;
  const checksumUrl = `${jarUrl}.sha256`;
  const checksumBytes = await readRemoteArtifactBytes({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.packageId,
    url: checksumUrl,
    blockedMessage: "Maven JAR checksum URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: "Failed to fetch Maven JAR SHA-256 checksum.",
    tooLargeMessage: "Maven JAR SHA-256 checksum response exceeded the maximum supported size.",
    unreadableMessage: "Maven JAR SHA-256 checksum response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Maven JAR SHA-256 checksum in the artifact cache.",
    details: { registryUrl: checksumUrl, coordinates: mavenCoordinateKey(input.coordinates) },
    maxBytes: MAVEN_CHECKSUM_MAX_BYTES,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "registryUrl"
  });
  if (!checksumBytes.ok) {
    return checksumBytes.error.category === "network"
      ? ok(undefined)
      : checksumBytes;
  }
  const checksum = checksumBytes.value.toString("utf8").trim();
  if (!/^[a-f0-9]{64}$/iu.test(checksum)) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Maven JAR SHA-256 checksum response was malformed.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates),
        reason: "maven_jar_checksum_malformed"
      }
    }));
  }

  const jarBytes = await readRemoteArtifactBytes({
    code: "TARBALL_FETCH_FAILED",
    packageId: input.packageId,
    url: jarUrl,
    blockedMessage: "Maven JAR URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve Maven repository host.",
    fetchFailureMessage: "Failed to fetch Maven JAR evidence.",
    tooLargeMessage: "Maven JAR response exceeded the maximum supported size.",
    unreadableMessage: "Maven JAR response did not expose a readable body stream.",
    offlineMissMessage: "Offline mode could not find the Maven JAR in the artifact cache.",
    details: { resolved: jarUrl, coordinates: mavenCoordinateKey(input.coordinates) },
    maxBytes: input.jarMaxBytes,
    fetchArtifact: input.fetchArtifact,
    resolveArtifactHost: input.resolveArtifactHost,
    fetchTimeoutMs: input.fetchTimeoutMs,
    offline: input.offline,
    artifactCache: input.artifactCache,
    signal: input.signal,
    allowedHosts: input.allowedHosts,
    permittedHosts: input.repository.permittedHosts,
    urlDetailKey: "resolved"
  });
  if (!jarBytes.ok) {
    return jarBytes.error.category === "network" ? ok(undefined) : jarBytes;
  }
  const expected = Buffer.from(checksum, "hex");
  const observed = createHash("sha256").update(jarBytes.value).digest();
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Maven JAR did not match its repository SHA-256 checksum.",
      details: {
        packageId: input.packageId,
        coordinates: mavenCoordinateKey(input.coordinates),
        reason: "maven_jar_checksum_mismatch"
      }
    }));
  }

  recordArtifactCheck({ packageId: input.packageId, bytes: jarBytes.value, kind: "maven-sha256", value: observed.toString("hex") });
  return collectMavenJarEvidence({
    packageId: input.packageId,
    coordinates: input.coordinates,
    jar: jarBytes.value
  });
}
