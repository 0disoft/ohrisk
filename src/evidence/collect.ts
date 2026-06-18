import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { collectLocalPackageEvidence } from "./local-package";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

type ArtifactFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type ArtifactFetcher = (url: string) => Promise<ArtifactFetchResponse>;

export async function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
  fetchArtifact?: ArtifactFetcher;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const evidence: LicenseEvidence[] = [];

  for (const node of input.graph.nodes) {
    const collected = await collectNodeEvidence({
      node,
      projectRoot: input.projectRoot,
      fetchArtifact: input.fetchArtifact ?? defaultArtifactFetcher
    });

    if (!collected.ok) {
      return collected;
    }

    evidence.push(collected.value);
  }

  return ok(evidence);
}

async function collectNodeEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  fetchArtifact: ArtifactFetcher;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const explicitLocalPath = input.node.resolved
    ? resolveLocalArtifact(input.node.resolved, input.projectRoot)
    : undefined;

  if (explicitLocalPath) {
    return collectLocalPathEvidence({
      node: input.node,
      localPath: explicitLocalPath
    });
  }

  const nodeModulesPath = resolveNodeModulesPackage(input.node.name, input.projectRoot);
  if (existsSync(nodeModulesPath) && statSync(nodeModulesPath).isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  if (!input.node.resolved) {
    return collectRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact
    });
  }

  if (isHttpUrl(input.node.resolved)) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      fetchArtifact: input.fetchArtifact
    });
  }

  return ok({
    packageId: input.node.id,
    files: [],
    source: "unavailable",
    warnings: [`Unsupported resolved artifact specifier: ${input.node.resolved}`]
  });
}

function collectLocalPathEvidence(input: {
  node: DependencyNode;
  localPath: string;
}): Result<LicenseEvidence, OhriskError> {
  if (!existsSync(input.localPath)) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Resolved package artifact does not exist.",
        details: {
          packageId: input.node.id,
          resolved: input.node.resolved,
          artifactPath: input.localPath
        }
      })
    );
  }

  if (statSync(input.localPath).isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: input.localPath
    });
  }

  return collectTarballEvidence({
    packageId: input.node.id,
    tarball: readFileSync(input.localPath)
  });
}

async function collectRegistryTarballEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = npmRegistryPackageUrl(input.node.name);

  try {
    const response = await input.fetchArtifact(metadataUrl);

    if (!response.ok) {
      return err(
        createError({
          code: "REGISTRY_METADATA_FETCH_FAILED",
          category: "network",
          message: "Failed to fetch npm registry metadata.",
          details: {
            packageId: input.node.id,
            registryUrl: metadataUrl,
            status: response.status,
            statusText: response.statusText
          }
        })
      );
    }

    const metadata = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8")) as unknown;
    const tarballUrl = readRegistryTarballUrl(metadata, input.node.version);

    if (!tarballUrl) {
      return err(
        createError({
          code: "REGISTRY_METADATA_FETCH_FAILED",
          category: "unsupported_input",
          message: "npm registry metadata did not include a tarball for the requested version.",
          details: {
            packageId: input.node.id,
            registryUrl: metadataUrl,
            version: input.node.version
          }
        })
      );
    }

    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: tarballUrl,
      fetchArtifact: input.fetchArtifact
    });
  } catch (cause) {
    return err(
      createError({
        code: "REGISTRY_METADATA_FETCH_FAILED",
        category: "network",
        message: "Failed to read npm registry metadata.",
        details: {
          packageId: input.node.id,
          registryUrl: metadataUrl,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function resolveLocalArtifact(resolved: string, projectRoot: string): string | undefined {
  if (resolved.startsWith("file:")) {
    const specifier = resolved.slice("file:".length);
    return path.resolve(projectRoot, specifier);
  }

  if (resolved.startsWith(".") || path.isAbsolute(resolved)) {
    return path.resolve(projectRoot, resolved);
  }

  return undefined;
}

function resolveNodeModulesPackage(packageName: string, projectRoot: string): string {
  return path.join(projectRoot, "node_modules", ...packageName.split("/"));
}

async function collectRemoteTarballEvidence(input: {
  packageId: string;
  resolved: string;
  fetchArtifact: ArtifactFetcher;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  if (!isHttpUrl(input.resolved)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [`Unsupported resolved artifact specifier: ${input.resolved}`]
    });
  }

  try {
    const response = await input.fetchArtifact(input.resolved);

    if (!response.ok) {
      return err(
        createError({
          code: "TARBALL_FETCH_FAILED",
          category: "network",
          message: "Failed to fetch package tarball.",
          details: {
            packageId: input.packageId,
            resolved: input.resolved,
            status: response.status,
            statusText: response.statusText
          }
        })
      );
    }

    return collectTarballEvidence({
      packageId: input.packageId,
      tarball: Buffer.from(await response.arrayBuffer())
    });
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_FETCH_FAILED",
        category: "network",
        message: "Failed to fetch package tarball.",
        details: {
          packageId: input.packageId,
          resolved: input.resolved,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

function npmRegistryPackageUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}`;
}

function readRegistryTarballUrl(metadata: unknown, version: string): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const versions = metadata.versions;
  if (!isRecord(versions)) {
    return undefined;
  }

  const versionMetadata = versions[version];
  if (!isRecord(versionMetadata)) {
    return undefined;
  }

  const dist = versionMetadata.dist;
  if (!isRecord(dist) || typeof dist.tarball !== "string") {
    return undefined;
  }

  return dist.tarball;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultArtifactFetcher(url: string): Promise<ArtifactFetchResponse> {
  return fetch(url);
}
