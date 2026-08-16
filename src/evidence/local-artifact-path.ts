import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  safeOptionalUrlForErrorDetails,
  safeUrlForErrorDetails
} from "./artifact-url";
import { parseSupportedIntegrityEntries } from "./package-integrity";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export function resolveExistingLocalArtifactPath(input: {
  packageId: string;
  resolved: string | undefined;
  integrity: string | undefined;
  projectRoot: string;
  workspaceRoot: string | undefined;
  artifactPath: string;
}): Result<string, OhriskError> {
  const allowedRoots = realpathLocalArtifactRoots({
    projectRoot: input.projectRoot,
    workspaceRoot: input.workspaceRoot
  });
  if (!allowedRoots.ok) {
    return err(allowedRoots.error);
  }

  const artifactPath = realpathSync(input.artifactPath);

  if (
    !isPathInsideAnyRoot(artifactPath, allowedRoots.value)
    && !isVerifiableExternalLocalTarball({
      artifactPath,
      integrity: input.integrity
    })
  ) {
    return err(localArtifactOutsideProjectError({
      packageId: input.packageId,
      resolved: input.resolved,
      artifactPath: input.artifactPath
    }));
  }

  return ok(artifactPath);
}

export function resolveTrustedWorkspaceRoot(
  workspaceRoot: string
): Result<string, OhriskError> {
  const resolvedPath = path.resolve(workspaceRoot);
  try {
    const realPath = realpathSync(resolvedPath);
    if (!statSync(realPath).isDirectory()) {
      return err(workspaceRootInvalidError(workspaceRoot, resolvedPath));
    }

    return ok(realPath);
  } catch {
    return err(workspaceRootInvalidError(workspaceRoot, resolvedPath));
  }
}

function localArtifactOutsideProjectError(input: {
  packageId: string;
  resolved: string | undefined;
  artifactPath: string;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Resolved package artifact must stay inside the project, repository root, or explicit workspace root.",
    details: {
      packageId: input.packageId,
      resolved: safeOptionalUrlForErrorDetails(input.resolved),
      artifactPath: safeUrlForErrorDetails(input.artifactPath)
    }
  });
}

function isVerifiableExternalLocalTarball(input: {
  artifactPath: string;
  integrity: string | undefined;
}): boolean {
  return input.integrity !== undefined
    && parseSupportedIntegrityEntries(input.integrity).length > 0
    && isSupportedLocalTarballPath(input.artifactPath);
}

function isSupportedLocalTarballPath(artifactPath: string): boolean {
  const normalizedPath = artifactPath.replace(/\\/g, "/").toLowerCase();
  return normalizedPath.endsWith(".tgz") || normalizedPath.endsWith(".tar.gz");
}

function workspaceRootInvalidError(workspaceRoot: string, resolvedPath: string): OhriskError {
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "--workspace-root must point to an existing directory.",
    details: {
      workspaceRoot,
      resolvedPath
    }
  });
}

function realpathLocalArtifactRoots(input: {
  projectRoot: string;
  workspaceRoot: string | undefined;
}): Result<string[], OhriskError> {
  const workspaceRoot = input.workspaceRoot
    ? resolveTrustedWorkspaceRoot(input.workspaceRoot)
    : ok(undefined);
  if (!workspaceRoot.ok) {
    return err(workspaceRoot.error);
  }

  return ok([
    realpathSync(resolveLocalArtifactRoot(input.projectRoot)),
    ...(workspaceRoot.value ? [workspaceRoot.value] : [])
  ]);
}

function resolveLocalArtifactRoot(projectRoot: string): string {
  return findNearestGitRoot(projectRoot) ?? path.resolve(projectRoot);
}

function findNearestGitRoot(startPath: string): string | undefined {
  let currentPath = path.resolve(startPath);

  while (true) {
    if (existsSync(path.join(currentPath, ".git"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isPathInsideAnyRoot(childPath: string, parentPaths: string[]): boolean {
  return parentPaths.some((parentPath) => isPathInsideOrEqual(childPath, parentPath));
}
