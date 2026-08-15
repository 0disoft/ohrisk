import path from "node:path";

import type { GitRefFileReader } from "../git/ref-file";
import type { DependencyGraph } from "../graph/types";
import type { OhriskError } from "../shared/errors";
import { isErr, ok, type Result } from "../shared/result";
import { collectLocalPackageEvidenceFromSnapshot } from "./local-package";

export function hasGitRefLocalNpmPackage(graph: DependencyGraph): boolean {
  return graph.nodes.some((node) =>
    node.ecosystem === "npm" && localPackageSpecifier(node.resolved) !== undefined
  );
}

export function attachGitRefLocalNpmEvidence(input: {
  graph: DependencyGraph;
  lockfileRelativePath: string;
  baselineRef: string;
  baselineFiles: ReadonlySet<string>;
  projectRoot: string;
  snapshotRoot: string;
  readRefFile: GitRefFileReader;
}): Result<DependencyGraph, OhriskError> {
  const evidenceByPackageId = new Map(
    (input.graph.embeddedEvidence ?? []).map((evidence) => [evidence.packageId, evidence])
  );

  for (const node of input.graph.nodes) {
    if (node.ecosystem !== "npm" || evidenceByPackageId.has(node.id)) {
      continue;
    }
    const specifier = localPackageSpecifier(node.resolved);
    if (specifier === undefined) {
      continue;
    }
    const packageDir = resolveLocalPackageDirectory({
      projectRoot: input.projectRoot,
      snapshotRoot: input.snapshotRoot,
      lockfileRelativePath: input.lockfileRelativePath,
      specifier
    });
    if (packageDir === undefined) {
      continue;
    }

    const evidence = collectLocalPackageEvidenceFromSnapshot({
      packageId: node.id,
      packageDir,
      files: input.baselineFiles,
      readFile: (relativePath) => input.readRefFile({
        projectRoot: input.snapshotRoot,
        ref: input.baselineRef,
        relativePath
      })
    });
    if (isErr(evidence)) {
      return evidence;
    }
    if (evidence.value) {
      evidenceByPackageId.set(node.id, evidence.value);
    }
  }

  const { embeddedEvidence: _embeddedEvidence, ...graphWithoutEmbeddedEvidence } = input.graph;
  return ok(evidenceByPackageId.size > 0
    ? {
        ...graphWithoutEmbeddedEvidence,
        embeddedEvidence: [...evidenceByPackageId.values()]
      }
    : graphWithoutEmbeddedEvidence);
}

function localPackageSpecifier(resolved: string | undefined): string | undefined {
  if (!resolved || resolved.startsWith("file://")) {
    return undefined;
  }

  let value: string | undefined;
  if (resolved.startsWith("file:")) {
    value = resolved.slice("file:".length);
  } else if (resolved.startsWith("workspace:")) {
    const workspaceValue = resolved.slice("workspace:".length);
    value = workspaceValue.startsWith(".") ? workspaceValue : undefined;
  } else if (resolved.startsWith(".")) {
    value = resolved;
  }

  if (value === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function resolveLocalPackageDirectory(input: {
  projectRoot: string;
  snapshotRoot: string;
  lockfileRelativePath: string;
  specifier: string;
}): string | undefined {
  if (
    input.specifier.includes("\0") ||
    path.posix.isAbsolute(input.specifier) ||
    path.win32.isAbsolute(input.specifier)
  ) {
    return undefined;
  }

  const lockfileDirectory = path.dirname(
    path.resolve(input.projectRoot, input.lockfileRelativePath)
  );
  const absolutePackageDirectory = path.resolve(lockfileDirectory, input.specifier);
  const snapshotRelativePath = path.relative(input.snapshotRoot, absolutePackageDirectory);
  if (
    snapshotRelativePath === ".." ||
    snapshotRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(snapshotRelativePath)
  ) {
    return undefined;
  }
  return snapshotRelativePath === ""
    ? ""
    : snapshotRelativePath.replace(/\\/g, "/");
}
