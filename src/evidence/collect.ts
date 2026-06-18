import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { collectLocalPackageEvidence } from "./local-package";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
}): Result<LicenseEvidence[], OhriskError> {
  const evidence: LicenseEvidence[] = [];

  for (const node of input.graph.nodes) {
    const collected = collectNodeEvidence({
      node,
      projectRoot: input.projectRoot
    });

    if (!collected.ok) {
      return collected;
    }

    evidence.push(collected.value);
  }

  return ok(evidence);
}

function collectNodeEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
}): Result<LicenseEvidence, OhriskError> {
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
    return ok({
      packageId: input.node.id,
      files: [],
      source: "unavailable",
      warnings: ["Remote registry artifact fetching is not implemented in this slice."]
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
