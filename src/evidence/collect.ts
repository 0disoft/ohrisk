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
  if (!input.node.resolved) {
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: ["Lockfile entry has no resolved package artifact."]
    });
  }

  const localPath = resolveLocalArtifact(input.node.resolved, input.projectRoot);

  if (!localPath) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      fetchArtifact: input.fetchArtifact
    });
  }

  if (!existsSync(localPath)) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Resolved package artifact does not exist.",
        details: {
          packageId: input.node.id,
          resolved: input.node.resolved,
          artifactPath: localPath
        }
      })
    );
  }

  if (statSync(localPath).isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: localPath
    });
  }

  return collectTarballEvidence({
    packageId: input.node.id,
    tarball: readFileSync(localPath)
  });
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

function defaultArtifactFetcher(url: string): Promise<ArtifactFetchResponse> {
  return fetch(url);
}
