import { recordArtifactBytes } from "./artifact-capture";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactBodyLimitDetails } from "./artifact-response";
import { safeOptionalUrlForErrorDetails, safeUrlForErrorDetails } from "./artifact-url";
import { collectLocalPackageEvidence } from "./local-package";
import { resolveExistingLocalArtifactPath } from "./local-artifact-path";
import { verifyPackageIntegrity } from "./package-integrity";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import { collectZipPackageEvidence } from "./zip-package";
import type { DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { addIntegrityWarningWhenUnverified } from "./evidence-failure";
import { isRecord } from "./registry-metadata";
import { type YarnCacheIndex, type YarnCacheIndexLoader, LOCAL_ARTIFACT_READ_CHUNK_BYTES } from "./collection-runtime";

export function collectLocalPathEvidence(input: {
  node: DependencyNode;
  projectRoot: string;
  workspaceRoot: string | undefined;
  localPath: string;
  tarballMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  if (!existsSync(input.localPath)) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Resolved package artifact does not exist.",
        details: {
          packageId: input.node.id,
          resolved: safeOptionalUrlForErrorDetails(input.node.resolved),
          artifactPath: safeUrlForErrorDetails(input.localPath)
        }
      })
    );
  }

  const trustedLocalPath = resolveExistingLocalArtifactPath({
    packageId: input.node.id,
    resolved: input.node.resolved,
    integrity: input.node.integrity,
    projectRoot: input.projectRoot,
    workspaceRoot: input.workspaceRoot,
    artifactPath: input.localPath
  });

  if (!trustedLocalPath.ok) {
    return err(trustedLocalPath.error);
  }

  const artifactStats = readLocalArtifactStats({
    filePath: trustedLocalPath.value,
    packageId: input.node.id,
    resolved: input.node.resolved
  });

  if (!artifactStats.ok) {
    return err(artifactStats.error);
  }

  if (artifactStats.value.isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: trustedLocalPath.value
    });
  }

  if (artifactStats.value.size > input.tarballMaxBytes) {
    return err(localArtifactTooLargeError({
      packageId: input.node.id,
      resolved: input.node.resolved,
      artifactPath: trustedLocalPath.value,
      maxBytes: input.tarballMaxBytes,
      observedBytes: artifactStats.value.size
    }));
  }

  const tarball = readLocalArtifactFileWithLimit({
    filePath: trustedLocalPath.value,
    packageId: input.node.id,
    resolved: input.node.resolved,
    maxBytes: input.tarballMaxBytes
  });

  if (!tarball.ok) {
    return err(tarball.error);
  }

  const verified = verifyPackageIntegrity({
    packageId: input.node.id,
    resolvedDetail: safeOptionalUrlForErrorDetails(input.node.resolved),
    integrity: input.node.integrity,
    artifact: tarball.value
  });

  if (!verified.ok) {
    return err(verified.error);
  }

  const evidence = collectTarballEvidence({
    packageId: input.node.id,
    tarball: tarball.value
  });

  if (!evidence.ok) {
    return err(evidence.error);
  }

  return ok(addIntegrityWarningWhenUnverified({
    evidence: evidence.value,
    integrity: input.node.integrity
  }));
}

function readLocalArtifactStats(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
}): Result<Stats, OhriskError> {
  try {
    return ok(statSync(input.filePath));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to inspect resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      })
    );
  }
}

function readLocalArtifactFileWithLimit(input: {
  filePath: string;
  packageId: string;
  resolved: string | undefined;
  maxBytes: number;
}): Result<Buffer, OhriskError> {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(input.filePath, "r");

    while (true) {
      const readSize = Math.min(
        LOCAL_ARTIFACT_READ_CHUNK_BYTES,
        Math.max(1, input.maxBytes + 1 - observedBytes)
      );
      const chunk = Buffer.alloc(readSize);
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        const bytes = Buffer.concat(chunks, observedBytes);
        recordArtifactBytes({ packageId: input.packageId, bytes, retrieval: "local" });
        return ok(bytes);
      }

      observedBytes += bytesRead;
      if (observedBytes > input.maxBytes) {
        return err(localArtifactTooLargeError({
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          maxBytes: input.maxBytes,
          observedBytes
        }));
      }

      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read resolved package artifact.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          artifactPath: safeUrlForErrorDetails(input.filePath),
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      })
    );
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the primary read or size error.
      }
    }
  }
}

function localArtifactTooLargeError(input: {
  packageId: string;
  resolved: string | undefined;
  artifactPath: string;
  maxBytes: number;
  observedBytes: number;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: "Resolved package artifact exceeded the maximum supported size.",
    details: {
      packageId: input.packageId,
      resolved: safeOptionalUrlForErrorDetails(input.resolved),
      artifactPath: safeUrlForErrorDetails(input.artifactPath),
      ...artifactBodyLimitDetails({
        maxBytes: input.maxBytes,
        observedBytes: input.observedBytes
      })
    }
  });
}

export function resolveLocalArtifact(input: {
  packageId: string;
  resolved: string;
  integrity: string | undefined;
  projectRoot: string;
  workspaceRoot: string | undefined;
}): Result<string | undefined, OhriskError> {
  let localPath: string | undefined;

  if (input.resolved.startsWith("file://")) {
    const filePath = resolveFileUrl(input.resolved);
    if (filePath) {
      localPath = filePath;
    }
  }

  if (!localPath && input.resolved.startsWith("file:")) {
    const specifier = decodeFilePathSpecifier(input.resolved.slice("file:".length));
    localPath = path.resolve(input.projectRoot, specifier);
  }

  if (!localPath && input.resolved.startsWith("workspace:")) {
    const specifier = decodeFilePathSpecifier(input.resolved.slice("workspace:".length));
    if (isWorkspaceLocalPathSpecifier(specifier)) {
      localPath = path.resolve(input.projectRoot, specifier);
    }
  }

  if (!localPath && (input.resolved.startsWith(".") || path.isAbsolute(input.resolved))) {
    localPath = path.resolve(input.projectRoot, input.resolved);
  }

  if (!localPath) {
    return ok(undefined);
  }

  const artifactPath = path.resolve(localPath);
  // Containment is checked after existence with canonical paths in
  // resolveExistingLocalArtifactPath. A lexical check here misclassifies
  // macOS /var -> /private/var aliases and other filesystem aliases.
  return ok(artifactPath);
}

function resolveFileUrl(value: string): string | undefined {
  try {
    return fileURLToPath(value);
  } catch {
    return undefined;
  }
}

function decodeFilePathSpecifier(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWorkspaceLocalPathSpecifier(value: string): boolean {
  return value.startsWith(".")
    || value.startsWith("/")
    || value.includes("/")
    || value.includes("\\");
}

export function findNodeModulesPackage(input: {
  node: DependencyNode;
  projectRoot: string;
  packageJsonMaxBytes: number;
}): string | undefined {
  const packageNames = [...new Set([...(input.node.installNames ?? []), input.node.name])];

  for (const packageName of packageNames) {
    for (const packagePath of resolveNodeModulesPackageCandidates({
      packageName,
      version: input.node.version,
      projectRoot: input.projectRoot
    })) {
      if (
        existsSync(packagePath)
        && isReadableDirectory(packagePath)
        && installedPackageMatchesNode({
          node: input.node,
          packagePath,
          maxBytes: input.packageJsonMaxBytes
        })
      ) {
        return packagePath;
      }
    }
  }

  return undefined;
}

function resolveNodeModulesPackageCandidates(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string[] {
  const segments = nodeModulesPackageSegments(input.packageName);
  if (!segments) {
    return [];
  }

  const candidates = [path.join(input.projectRoot, "node_modules", ...segments)];
  const bunStoreSegment = bunIsolatedStoreSegment(input.packageName, input.version);
  if (bunStoreSegment) {
    candidates.push(path.join(
      input.projectRoot,
      "node_modules",
      ".bun",
      bunStoreSegment,
      "node_modules",
      ...segments
    ));
  }
  return candidates;
}

function bunIsolatedStoreSegment(packageName: string, version: string): string | undefined {
  if (
    version === ""
    || version === "."
    || version === ".."
    || version.includes("/")
    || version.includes("\\")
    || version.includes(":")
  ) {
    return undefined;
  }
  return `${packageName.replaceAll("/", "+")}@${version}`;
}

function nodeModulesPackageSegments(packageName: string): string[] | undefined {
  if (packageName === "" || packageName.includes("\\") || packageName.includes(":")) {
    return undefined;
  }

  const segments = packageName.split("/");
  if (segments.length === 1) {
    const [name] = segments;
    return name && isSafeNodeModulesSegment(name) && !name.startsWith("@")
      ? segments
      : undefined;
  }

  if (segments.length === 2) {
    const [scope, name] = segments;
    if (
      scope
      && name
      && scope.startsWith("@")
      && scope.length > 1
      && isSafeNodeModulesSegment(scope)
      && isSafeNodeModulesSegment(name)
    ) {
      return segments;
    }
  }

  return undefined;
}

function isSafeNodeModulesSegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== "..";
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function installedPackageMatchesNode(input: {
  node: DependencyNode;
  packagePath: string;
  maxBytes: number;
}): boolean {
  try {
    const packageJsonText = readTextFileWithLimit({
      filePath: path.join(input.packagePath, "package.json"),
      maxBytes: input.maxBytes
    });

    if (!packageJsonText.ok) {
      return false;
    }

    const packageJson = JSON.parse(packageJsonText.value) as unknown;

    return isRecord(packageJson)
      && packageJson.name === input.node.name
      && packageJson.version === input.node.version;
  } catch {
    return false;
  }
}

export function collectYarnCachePackageEvidence(input: {
  node: DependencyNode;
  loadYarnCacheIndex: YarnCacheIndexLoader;
  zipMaxBytes: number;
}): Result<LicenseEvidence | undefined, OhriskError> {
  const filenamePrefix = yarnCacheFilenamePrefix(input.node);
  if (!filenamePrefix) {
    return ok(undefined);
  }

  const loadedIndex = input.loadYarnCacheIndex();
  if (!loadedIndex.ok) {
    return err(loadedIndex.error);
  }
  if (!loadedIndex.value) {
    return ok(undefined);
  }

  for (const filename of loadedIndex.value.filenames) {
    if (!filename.startsWith(filenamePrefix)) {
      continue;
    }
    const cachePath = path.join(loadedIndex.value.cacheDir, filename);
    const stats = readLocalArtifactStats({
      filePath: cachePath,
      packageId: input.node.id,
      resolved: undefined
    });
    if (!stats.ok) {
      return err(stats.error);
    }

    if (stats.value.size > input.zipMaxBytes) {
      return err(localArtifactTooLargeError({
        packageId: input.node.id,
        resolved: undefined,
        artifactPath: cachePath,
        maxBytes: input.zipMaxBytes,
        observedBytes: stats.value.size
      }));
    }

    const zip = readLocalArtifactFileWithLimit({
      filePath: cachePath,
      packageId: input.node.id,
      resolved: undefined,
      maxBytes: input.zipMaxBytes
    });
    if (!zip.ok) {
      return err(zip.error);
    }

    const evidence = collectZipPackageEvidence({
      packageId: input.node.id,
      packageName: input.node.name,
      packageVersion: input.node.version,
      zip: zip.value
    });
    if (!evidence.ok) {
      return err(evidence.error);
    }

    if (evidence.value) {
      return ok(evidence.value);
    }
  }

  return ok(undefined);
}

export function createYarnCacheIndexLoader(projectRoot: string): YarnCacheIndexLoader {
  let loaded: Result<YarnCacheIndex | undefined, OhriskError> | undefined;
  return () => {
    if (loaded) {
      return loaded;
    }

    const cacheDir = path.join(projectRoot, ".yarn", "cache");
    if (!existsSync(cacheDir) || !isReadableDirectory(cacheDir)) {
      loaded = ok(undefined);
      return loaded;
    }

    try {
      loaded = ok({
        cacheDir,
        filenames: readdirSync(cacheDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right))
      });
    } catch (cause) {
      loaded = err(createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to read Yarn package cache directory.",
        details: {
          cacheDir,
          cause: safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause))
        }
      }));
    }
    return loaded;
  };
}

function yarnCacheFilenamePrefix(node: DependencyNode): string | undefined {
  const slug = yarnCachePackageSlug(node.name);
  return slug ? `${slug}-npm-${node.version}-` : undefined;
}

function yarnCachePackageSlug(packageName: string): string | undefined {
  const segments = nodeModulesPackageSegments(packageName);
  return segments ? segments.join("-") : undefined;
}
