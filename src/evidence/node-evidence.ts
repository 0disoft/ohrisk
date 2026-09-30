import { type ArtifactCache } from "./cache";
import { type ArtifactFetcher } from "./artifact-response";
import { type ArtifactHostResolver } from "./artifact-transport";
import { safeUrlForErrorDetails } from "./artifact-url";
import { collectRegisteredEcosystemEvidence } from "../ecosystems/registry";
import { collectHexTarballEvidence } from "./hex-tarball";
import { collectLocalPackageEvidence } from "./local-package";
import { collectNixGitHubArchiveEvidence, collectNixTarXzArchiveEvidence, isVerifiedNixGitHubNode, isVerifiedNixReleaseTarballNode, NIX_GITHUB_ARCHIVE_HOSTS, NIX_RELEASE_ARCHIVE_HOSTS } from "./nix-github";
import { pythonDistributionArchiveFormat } from "./pypi-package";
import { collectPubTarballEvidence } from "./tarball";
import { collectRemoteZigTarballEvidence } from "./zig-package";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import { parseZigHash } from "../graph/zig-zon";
import { type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { unsupportedRemoteEcosystemEvidence } from "./evidence-failure";
import { collectRemoteCargoCrateEvidence } from "./remote-cargo-evidence";
import { collectRemoteHackageCabalEvidence } from "./remote-hackage-evidence";
import { shouldCollectNpmRegistryEvidence, remoteArtifactFilename } from "./registry-metadata";
import { collectLocalPathEvidence, resolveLocalArtifact, findNodeModulesPackage, collectYarnCachePackageEvidence } from "./local-package-evidence";
import { collectRemoteNugetPackageEvidence } from "./remote-nuget-evidence";
import { collectRemoteRubyGemEvidence } from "./remote-ruby-evidence";
import { collectRemoteGoModuleEvidence, collectVerifiedRemoteGoModuleRequirements } from "./remote-go-evidence";
import { collectNpmRegistryTarballEvidence } from "./remote-npm-evidence";
import { collectPyPiReleaseEvidence, collectRemotePythonDistributionEvidence } from "./remote-python-evidence";
import { collectRemoteTarballEvidence } from "./remote-package-evidence";
import { isHttpUrl } from "./remote-artifact-reader";
import { type YarnCacheIndexLoader, type MavenEvidenceCollector, type NugetServiceIndexLoader, PUB_DEV_ARCHIVE_HOSTS, HEX_PM_TARBALL_HOSTS, HACKAGE_CABAL_MAX_BYTES, type CargoGitHubArchiveEvidenceCache } from "./collection-runtime";

export async function collectNodeEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  allowLocalProjectEvidence: boolean;
  allowProjectContainedGoReplacementEvidence: boolean;
  workspaceRoot?: string;
  fetchArtifact: ArtifactFetcher;
  npmFetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  installedPackageJsonMaxBytes: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  signal: AbortSignal;
  npmRegistryUrl: string | undefined;
  allowedHosts: ReadonlySet<string>;
  loadYarnCacheIndex: YarnCacheIndexLoader;
  collectMavenEvidence: MavenEvidenceCollector;
  loadNugetServiceIndex: NugetServiceIndexLoader;
  cargoGitHubArchiveEvidenceCache: CargoGitHubArchiveEvidenceCache;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (input.node.artifactIdentityConflict) {
    return ok({
      packageId: input.node.id, source: "unavailable", files: [],
      artifactIdentityConflict: true,
      warnings: ["Conflicting artifact identities were declared for this package; resolve the input conflict before collecting evidence."]
    });
  }
  const projectContainedGoReplacementEvidence =
    !input.allowLocalProjectEvidence
    && input.allowProjectContainedGoReplacementEvidence
    && input.node.ecosystem === "go"
    && input.node.resolved !== undefined
    && !input.node.resolved.startsWith("go-module:")
      ? collectRegisteredEcosystemEvidence({
          node: input.node,
          projectRoot: input.projectRoot
        })
      : undefined;
  if (projectContainedGoReplacementEvidence) {
    return projectContainedGoReplacementEvidence;
  }

  const hasVerifiedPubArchive = input.node.ecosystem === "pub"
    && input.node.resolved !== undefined
    && input.node.integrity !== undefined;
  const ecosystemEvidence = input.allowLocalProjectEvidence && !hasVerifiedPubArchive
    ? collectRegisteredEcosystemEvidence({
        node: input.node,
        projectRoot: input.projectRoot
      })
    : undefined;
  if (ecosystemEvidence) {
    if (
      input.node.ecosystem === "go"
      && ecosystemEvidence.ok
      && ecosystemEvidence.value.source !== "unavailable"
      && ecosystemEvidence.value.goModuleRequirements === undefined
    ) {
      return collectVerifiedRemoteGoModuleRequirements({
        node: input.node,
        evidence: ecosystemEvidence.value,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }
    if (
      (
        input.node.ecosystem !== "maven"
        && input.node.ecosystem !== "go"
        && input.node.ecosystem !== "cargo"
        && input.node.ecosystem !== "nuget"
        && input.node.ecosystem !== "gem"
        && input.node.ecosystem !== "hackage"
        && input.node.ecosystem !== "hex"
        && input.node.ecosystem !== "nix"
        && input.node.ecosystem !== "zig"
      )
      || !ecosystemEvidence.ok
      || ecosystemEvidence.value.source !== "unavailable"
    ) {
      return ecosystemEvidence;
    }
  }

  const explicitLocalPath = input.allowLocalProjectEvidence && input.node.resolved
    ? resolveLocalArtifact({
      packageId: input.node.id,
      resolved: input.node.resolved,
      integrity: input.node.integrity,
      projectRoot: input.projectRoot,
      workspaceRoot: input.workspaceRoot
    })
    : ok(undefined);

  if (!explicitLocalPath.ok) {
    return err(explicitLocalPath.error);
  }

  if (explicitLocalPath.value) {
    return collectLocalPathEvidence({
      node: input.node,
      projectRoot: input.projectRoot,
      workspaceRoot: input.workspaceRoot,
      localPath: explicitLocalPath.value,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  const nodeModulesPath = input.allowLocalProjectEvidence
    ? findNodeModulesPackage({
        node: input.node,
        projectRoot: input.projectRoot,
        packageJsonMaxBytes: input.installedPackageJsonMaxBytes
      })
    : undefined;
  if (nodeModulesPath) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  const yarnCacheEvidence = input.allowLocalProjectEvidence
    ? collectYarnCachePackageEvidence({
        node: input.node,
        loadYarnCacheIndex: input.loadYarnCacheIndex,
        zipMaxBytes: input.tarballMaxBytes
      })
    : ok(undefined);
  if (!yarnCacheEvidence.ok) {
    return err(yarnCacheEvidence.error);
  }

  if (yarnCacheEvidence.value) {
    return ok(yarnCacheEvidence.value);
  }

  if (input.node.ecosystem === "pypi") {
    if (!input.node.resolved) {
      return collectPyPiReleaseEvidence({
        node: input.node,
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        registryMetadataMaxBytes: input.registryMetadataMaxBytes,
        artifactMaxBytes: input.tarballMaxBytes,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }

    if (isHttpUrl(input.node.resolved)) {
      const artifactFilename = remoteArtifactFilename(input.node.resolved);
      if (!artifactFilename || !pythonDistributionArchiveFormat(artifactFilename)) {
        return ok(unsupportedRemoteEcosystemEvidence({
          node: input.node,
          reason: "The resolved Python package URL did not identify a supported wheel or source distribution."
        }));
      }

      return collectRemotePythonDistributionEvidence({
        node: input.node,
        resolved: input.node.resolved,
        artifactFilename,
        ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
        fetchArtifact: input.fetchArtifact,
        resolveArtifactHost: input.resolveArtifactHost,
        fetchTimeoutMs: input.fetchTimeoutMs,
        artifactMaxBytes: input.tarballMaxBytes,
        offline: input.offline,
        artifactCache: input.artifactCache,
        signal: input.signal,
        allowedHosts: input.allowedHosts
      });
    }

    return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
  }

  if (input.node.ecosystem === "maven") {
    return input.collectMavenEvidence(input.node);
  }

  if (input.node.ecosystem === "gem") {
    return collectRemoteRubyGemEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "go") {
    return collectRemoteGoModuleEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  if (input.node.ecosystem === "cargo") {
    return collectRemoteCargoCrateEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      cargoGitHubArchiveEvidenceCache: input.cargoGitHubArchiveEvidenceCache
    });
  }

  if (input.node.ecosystem === "nuget") {
    return collectRemoteNugetPackageEvidence({
      node: input.node,
      allowLocalProjectEvidence: input.allowLocalProjectEvidence,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      artifactMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      loadServiceIndex: input.loadNugetServiceIndex
    });
  }

  if (
    input.node.ecosystem === "hackage"
    && input.node.resolved
    && input.node.integrity
  ) {
    return collectRemoteHackageCabalEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      metadataMaxBytes: Math.min(input.registryMetadataMaxBytes, HACKAGE_CABAL_MAX_BYTES),
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  const nixResolved = input.node.resolved;
  const nixIntegrity = input.node.integrity;
  if (
    input.node.ecosystem === "nix"
    && nixResolved !== undefined
    && nixIntegrity !== undefined
    && isVerifiedNixReleaseTarballNode(input.node)
  ) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: nixResolved,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: NIX_RELEASE_ARCHIVE_HOSTS,
      integrity: nixIntegrity,
      skipIntegrityCheck: true,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "NixOS release source archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the fixed NixOS release archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(nixResolved)
        }
      },
      collectEvidence: (tarball) => collectNixTarXzArchiveEvidence({
        packageId: input.node.id,
        tarball,
        expectedNarHash: nixIntegrity,
        signal: input.signal
      })
    });
  }

  if (input.node.ecosystem === "pub" && input.node.resolved) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: PUB_DEV_ARCHIVE_HOSTS,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Dart pub package archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the pub.dev package archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(input.node.resolved)
        }
      },
      collectEvidence: (tarball) => collectPubTarballEvidence({
        packageId: input.node.id,
        packageName: input.node.name,
        version: input.node.version,
        tarball
      })
    });
  }

  if (
    input.node.ecosystem === "nix"
    && nixResolved !== undefined
    && nixIntegrity !== undefined
    && isVerifiedNixGitHubNode(input.node)
  ) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: nixResolved,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: NIX_GITHUB_ARCHIVE_HOSTS,
      integrity: nixIntegrity,
      skipIntegrityCheck: true,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Nix GitHub source archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the fixed GitHub source archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(nixResolved)
        }
      },
      collectEvidence: (tarball) => collectNixGitHubArchiveEvidence({
        packageId: input.node.id,
        tarball,
        expectedNarHash: nixIntegrity
      })
    });
  }

  if (
    input.node.ecosystem === "hex"
    && input.node.resolved
    && input.node.integrity
  ) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      integrity: input.node.integrity,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      permittedHosts: HEX_PM_TARBALL_HOSTS,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Hex package archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the public Hex package host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(input.node.resolved)
        }
      },
      collectEvidence: (tarball) => collectHexTarballEvidence({
        packageId: input.node.id,
        packageName: input.node.name,
        version: input.node.version,
        tarball,
        artifactMaxBytes: input.tarballMaxBytes
      })
    });
  }

  if (
    input.node.ecosystem === "zig"
    && input.node.resolved
    && input.node.integrity
    && parseZigHash(input.node.integrity) !== null
  ) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts,
      integrity: input.node.integrity,
      skipIntegrityCheck: true,
      urlError: {
        code: "TARBALL_FETCH_FAILED",
        message: "Zig package archive URL targets an unsupported or blocked host.",
        resolveFailureMessage: "Failed to resolve the Zig package archive host.",
        details: {
          packageId: input.node.id,
          resolved: safeUrlForErrorDetails(input.node.resolved)
        }
      },
      collectEvidence: (tarball) => collectRemoteZigTarballEvidence({
        packageId: input.node.id,
        packageName: input.node.name,
        tarball,
        expectedHash: input.node.integrity!
      })
    });
  }

  if (input.node.ecosystem === "npm" && shouldCollectNpmRegistryEvidence({
    node: input.node,
    npmRegistryUrl: input.npmRegistryUrl
  })) {
    return collectNpmRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.npmFetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      npmRegistryUrl: input.npmRegistryUrl,
      allowedHosts: input.allowedHosts
    });
  }

  const resolved = input.node.resolved;
  if (input.node.ecosystem === "npm" && resolved && isHttpUrl(resolved)) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved,
      ...(input.node.integrity ? { integrity: input.node.integrity } : {}),
      fetchArtifact: input.npmFetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      offline: input.offline,
      artifactCache: input.artifactCache,
      signal: input.signal,
      allowedHosts: input.allowedHosts
    });
  }

  return ok(unsupportedRemoteEcosystemEvidence({ node: input.node }));
}
