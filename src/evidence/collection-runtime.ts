import { type ArtifactCacheResponseMetadata } from "./cache";
import { type ArtifactHostResolver } from "./artifact-transport";
import { type CargoGitHubPackageRequest, type CargoGitHubSource } from "./cargo-git";
import { type NugetServiceEndpoints } from "./nuget-registry";
import type { MissingExternalMavenPom } from "../graph/java-maven-pom";
import { type MavenPomLicenseMetadata } from "./maven-package";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { type OhriskError } from "../shared/errors";
import { type Result } from "../shared/result";

export type RemoteArtifactRead = {
  bytes: Buffer;
  cacheMetadata: ArtifactCacheResponseMetadata;
  notModified: boolean;
};

export type RemoteArtifactFetchPolicy = {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  message: string;
  resolveFailureMessage: string;
  details: Record<string, unknown>;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
};

export type YarnCacheIndex = {
  cacheDir: string;
  filenames: string[];
};

export type YarnCacheIndexLoader = () => Result<YarnCacheIndex | undefined, OhriskError>;
export type MavenEvidenceCollector = (
  node: DependencyNode
) => Promise<Result<LicenseEvidence, OhriskError>>;
export type NugetServiceIndexLoader = (
  packageId: string
) => Promise<Result<NugetServiceEndpoints, OhriskError>>;

export type MavenRepositoryEndpoint = {
  baseUrl: string;
  label: string;
  permittedHosts: ReadonlySet<string>;
};

export type MavenPomLookup = {
  metadata: MavenPomLicenseMetadata;
  repository: MavenRepositoryEndpoint;
};

export type EvidenceCollectionProgress = {
  completed: number;
  total: number;
  packageId: string;
  concurrency: number;
};

export type RemoteMavenModelPom = MissingExternalMavenPom & {
  source: string;
  text: string;
};

export const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;
export const REGISTRY_METADATA_MAX_BYTES = 10 * 1024 * 1024;
export const PACKAGE_TARBALL_MAX_BYTES = 100 * 1024 * 1024;
export const INSTALLED_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
export const LOCAL_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;
export const MAX_ARTIFACT_REDIRECTS = 5;
export const DEFAULT_EVIDENCE_CONCURRENCY = 8;
export const PYPI_METADATA_HOSTS = new Set(["pypi.org"]);
export const PYPI_DISTRIBUTION_HOSTS = new Set(["files.pythonhosted.org"]);
export const RUBYGEMS_ORG_HOSTS = new Set(["rubygems.org"]);
export const PUB_DEV_ARCHIVE_HOSTS = new Set(["pub.dev"]);
export const HEX_PM_TARBALL_HOSTS = new Set(["repo.hex.pm"]);
export const NUGET_SERVICE_INDEX_URL = "https://api.nuget.org/v3/index.json";
export const NUGET_ORG_HOSTS = new Set(["api.nuget.org"]);
export const MAVEN_CENTRAL_BASE_URL = "https://repo.maven.apache.org/maven2";
export const MAVEN_CENTRAL_HOSTS = new Set(["repo.maven.apache.org"]);
export const MAVEN_JAR_MAX_BYTES = 32 * 1024 * 1024;
export const MAVEN_CHECKSUM_MAX_BYTES = 256;
export const GO_MODULE_PROXY_HOSTS = new Set(["proxy.golang.org", "storage.googleapis.com"]);
export const GO_MODULE_MOD_MAX_BYTES = 2 * 1024 * 1024;
export const GO_MODULE_TRANSIENT_FETCH_ATTEMPTS = 2;
export const GO_MODULE_TRANSIENT_RETRY_DELAY_MS = 200;

export const CARGO_CRATES_IO_SOURCES = new Set([
  "registry+https://github.com/rust-lang/crates.io-index",
  "registry+https://index.crates.io/"
]);
export const CARGO_CRATE_BASE_URL = "https://static.crates.io/crates";
export const CARGO_CRATE_HOSTS = new Set(["static.crates.io"]);
export const HACKAGE_CABAL_HOSTS = new Set(["hackage.haskell.org"]);
export const HACKAGE_CABAL_MAX_HISTORICAL_REVISIONS = 64;
export const HACKAGE_CABAL_MAX_BYTES = 1024 * 1024;

export type CargoGitHubArchiveEvidenceCacheEntry = {
  source: CargoGitHubSource;
  packages: CargoGitHubPackageRequest[];
  result?: Promise<Result<ReadonlyMap<string, LicenseEvidence>, OhriskError>>;
};

export type CargoGitHubArchiveEvidenceCache = ReadonlyMap<string, CargoGitHubArchiveEvidenceCacheEntry>;
