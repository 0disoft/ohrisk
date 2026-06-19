import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  type Stats
} from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectLocalPackageEvidence } from "./local-package";
import { collectTarballEvidence } from "./tarball";
import type { LicenseEvidence } from "./types";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { createError, type OhriskError } from "../shared/errors";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";

type ArtifactFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get: (name: string) => string | null;
  };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type ArtifactFetchOptions = {
  signal?: AbortSignal;
  redirect?: "manual";
};

type ArtifactFetcher = (
  url: string,
  options?: ArtifactFetchOptions
) => Promise<ArtifactFetchResponse>;

type ArtifactHostResolution = {
  address: string;
  family: number;
};

type ArtifactHostResolver = (hostname: string) => Promise<ArtifactHostResolution[]>;
type Ipv6Hextets = [number, number, number, number, number, number, number, number];

const ARTIFACT_FETCH_TIMEOUT_MS = 30_000;
const REGISTRY_METADATA_MAX_BYTES = 10 * 1024 * 1024;
const PACKAGE_TARBALL_MAX_BYTES = 100 * 1024 * 1024;
const INSTALLED_PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const LOCAL_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;

const SUPPORTED_INTEGRITY_DIGEST_BYTES = {
  sha1: 20,
  sha256: 32,
  sha384: 48,
  sha512: 64
} as const;

type SupportedIntegrityAlgorithm = keyof typeof SUPPORTED_INTEGRITY_DIGEST_BYTES;

export async function collectGraphEvidence(input: {
  graph: DependencyGraph;
  projectRoot: string;
  fetchArtifact?: ArtifactFetcher;
  fetchTimeoutMs?: number;
  registryMetadataMaxBytes?: number;
  tarballMaxBytes?: number;
  installedPackageJsonMaxBytes?: number;
  resolveArtifactHost?: ArtifactHostResolver;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const evidence: LicenseEvidence[] = [];
  const fetchArtifact = input.fetchArtifact ?? defaultArtifactFetcher;
  const resolveArtifactHost =
    input.resolveArtifactHost ??
    (input.fetchArtifact ? undefined : defaultArtifactHostResolver);
  const fetchTimeoutMs = input.fetchTimeoutMs ?? ARTIFACT_FETCH_TIMEOUT_MS;
  const registryMetadataMaxBytes = input.registryMetadataMaxBytes ?? REGISTRY_METADATA_MAX_BYTES;
  const tarballMaxBytes = input.tarballMaxBytes ?? PACKAGE_TARBALL_MAX_BYTES;
  const installedPackageJsonMaxBytes =
    input.installedPackageJsonMaxBytes ?? INSTALLED_PACKAGE_JSON_MAX_BYTES;

  for (const node of input.graph.nodes) {
    const collected = await collectNodeEvidence({
      node,
      projectRoot: input.projectRoot,
      fetchArtifact,
      resolveArtifactHost,
      fetchTimeoutMs,
      registryMetadataMaxBytes,
      tarballMaxBytes,
      installedPackageJsonMaxBytes
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
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
  installedPackageJsonMaxBytes: number;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const explicitLocalPath = input.node.resolved
    ? resolveLocalArtifact(input.node.resolved, input.projectRoot)
    : undefined;

  if (explicitLocalPath) {
    return collectLocalPathEvidence({
      node: input.node,
      localPath: explicitLocalPath,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  const nodeModulesPath = findNodeModulesPackage({
    node: input.node,
    projectRoot: input.projectRoot,
    packageJsonMaxBytes: input.installedPackageJsonMaxBytes
  });
  if (nodeModulesPath) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: nodeModulesPath
    });
  }

  if (!input.node.resolved) {
    return collectRegistryTarballEvidence({
      node: input.node,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      registryMetadataMaxBytes: input.registryMetadataMaxBytes,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  if (isHttpUrl(input.node.resolved)) {
    return collectRemoteTarballEvidence({
      packageId: input.node.id,
      resolved: input.node.resolved,
      integrity: input.node.integrity,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes
    });
  }

  return ok({
    packageId: input.node.id,
    files: [],
    source: "unavailable",
    warnings: [`Unsupported resolved artifact specifier: ${safeUrlForErrorDetails(input.node.resolved)}`]
  });
}

function collectLocalPathEvidence(input: {
  node: DependencyNode;
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

  const artifactStats = readLocalArtifactStats({
    filePath: input.localPath,
    packageId: input.node.id,
    resolved: input.node.resolved
  });

  if (!artifactStats.ok) {
    return err(artifactStats.error);
  }

  if (artifactStats.value.isDirectory()) {
    return collectLocalPackageEvidence({
      packageId: input.node.id,
      packageDir: input.localPath
    });
  }

  if (artifactStats.value.size > input.tarballMaxBytes) {
    return err(localArtifactTooLargeError({
      packageId: input.node.id,
      resolved: input.node.resolved,
      artifactPath: input.localPath,
      maxBytes: input.tarballMaxBytes,
      observedBytes: artifactStats.value.size
    }));
  }

  const tarball = readLocalArtifactFileWithLimit({
    filePath: input.localPath,
    packageId: input.node.id,
    resolved: input.node.resolved,
    maxBytes: input.tarballMaxBytes
  });

  if (!tarball.ok) {
    return err(tarball.error);
  }

  const verified = verifyPackageIntegrity({
    packageId: input.node.id,
    resolved: input.node.resolved,
    integrity: input.node.integrity,
    tarball: tarball.value
  });

  if (!verified.ok) {
    return err(verified.error);
  }

  return collectTarballEvidence({
    packageId: input.node.id,
    tarball: tarball.value
  });
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
        return ok(Buffer.concat(chunks, observedBytes));
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

async function collectRegistryTarballEvidence(input: {
  node: DependencyNode;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  registryMetadataMaxBytes: number;
  tarballMaxBytes: number;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const metadataUrl = npmRegistryPackageUrl(input.node.name);

  const metadataUrlPreflight = await preflightRemoteArtifactFetchTarget({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    packageId: input.node.id,
    resolved: metadataUrl,
    message: "npm registry metadata URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve npm registry metadata host.",
    details: {
      registryUrl: metadataUrl
    },
    resolveArtifactHost: input.resolveArtifactHost
  });

  if (!metadataUrlPreflight.ok) {
    return err(metadataUrlPreflight.error);
  }

  try {
    const metadataText = await readArtifactWithTimeout({
      fetchArtifact: input.fetchArtifact,
      url: metadataUrl,
      timeoutMs: input.fetchTimeoutMs,
      readResponse: async (response, signal) => {
        if (!response.ok) {
          cancelReadableBody(response.body);
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

        const metadataBody = await readResponseBodyWithLimit({
          response,
          signal,
          maxBytes: input.registryMetadataMaxBytes,
          createTooLargeError: (limit) => createError({
            code: "REGISTRY_METADATA_FETCH_FAILED",
            category: "unsupported_input",
            message: "npm registry metadata response exceeded the maximum supported size.",
            details: {
              packageId: input.node.id,
              registryUrl: metadataUrl,
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: "REGISTRY_METADATA_FETCH_FAILED",
            category: "unsupported_input",
            message: "npm registry metadata response did not expose a readable body stream.",
            details: {
              packageId: input.node.id,
              registryUrl: metadataUrl
            }
          })
        });

        if (!metadataBody.ok) {
          return err(metadataBody.error);
        }

        return ok(metadataBody.value.toString("utf8"));
      }
    });

    if (!metadataText.ok) {
      return err(metadataText.error);
    }

    const metadata = parseRegistryMetadata({
      packageId: input.node.id,
      registryUrl: metadataUrl,
      text: metadataText.value
    });
    if (!metadata.ok) {
      return err(metadata.error);
    }

    const tarballUrl = readRegistryTarballUrl(metadata.value, input.node.version);

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
      integrity: input.node.integrity,
      fetchArtifact: input.fetchArtifact,
      resolveArtifactHost: input.resolveArtifactHost,
      fetchTimeoutMs: input.fetchTimeoutMs,
      tarballMaxBytes: input.tarballMaxBytes,
      urlError: {
        code: "REGISTRY_METADATA_FETCH_FAILED",
        message: "npm registry metadata included an unsupported tarball URL.",
        resolveFailureMessage: "Failed to resolve registry tarball host.",
        details: {
          registryUrl: metadataUrl,
          version: input.node.version,
          tarballUrl
        }
      }
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
          cause: safeErrorCauseForDetails(cause)
        }
      })
    );
  }
}

function parseRegistryMetadata(input: {
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

function resolveLocalArtifact(resolved: string, projectRoot: string): string | undefined {
  if (resolved.startsWith("file://")) {
    const filePath = resolveFileUrl(resolved);
    if (filePath) {
      return filePath;
    }
  }

  if (resolved.startsWith("file:")) {
    const specifier = decodeFilePathSpecifier(resolved.slice("file:".length));
    return path.resolve(projectRoot, specifier);
  }

  if (resolved.startsWith(".") || path.isAbsolute(resolved)) {
    return path.resolve(projectRoot, resolved);
  }

  return undefined;
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

function findNodeModulesPackage(input: {
  node: DependencyNode;
  projectRoot: string;
  packageJsonMaxBytes: number;
}): string | undefined {
  const packageNames = [...new Set([...(input.node.installNames ?? []), input.node.name])];

  for (const packageName of packageNames) {
    const packagePath = resolveNodeModulesPackage(packageName, input.projectRoot);
    if (!packagePath) {
      continue;
    }

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

  return undefined;
}

function resolveNodeModulesPackage(packageName: string, projectRoot: string): string | undefined {
  const segments = nodeModulesPackageSegments(packageName);
  if (!segments) {
    return undefined;
  }

  return path.join(projectRoot, "node_modules", ...segments);
}

function nodeModulesPackageSegments(packageName: string): string[] | undefined {
  if (packageName === "" || packageName.includes("\\") || packageName.includes(":")) {
    return undefined;
  }

  const segments = packageName.split("/");
  if (segments.length === 1) {
    return isSafeNodeModulesSegment(segments[0]) && !segments[0].startsWith("@")
      ? segments
      : undefined;
  }

  if (
    segments.length === 2
    && segments[0].startsWith("@")
    && segments[0].length > 1
    && isSafeNodeModulesSegment(segments[0])
    && isSafeNodeModulesSegment(segments[1])
  ) {
    return segments;
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

async function collectRemoteTarballEvidence(input: {
  packageId: string;
  resolved: string;
  integrity?: string;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  tarballMaxBytes: number;
  urlError?: {
    code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
    message: string;
    resolveFailureMessage: string;
    details: Record<string, unknown>;
  };
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const urlError = input.urlError ?? {
    code: "TARBALL_FETCH_FAILED" as const,
    message: "Package tarball URL targets an unsupported or blocked host.",
    resolveFailureMessage: "Failed to resolve package tarball host.",
    details: {
      resolved: safeUrlForErrorDetails(input.resolved)
    }
  };

  const urlPreflight = await preflightRemoteArtifactFetchTarget({
    code: urlError.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: urlError.message,
    resolveFailureMessage: urlError.resolveFailureMessage,
    details: urlError.details,
    resolveArtifactHost: input.resolveArtifactHost
  });

  if (!urlPreflight.ok) {
    return err(urlPreflight.error);
  }

  if (!isHttpUrl(input.resolved)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [`Unsupported resolved artifact specifier: ${safeUrlForErrorDetails(input.resolved)}`]
    });
  }

  try {
    const tarball = await readArtifactWithTimeout({
      fetchArtifact: input.fetchArtifact,
      url: input.resolved,
      timeoutMs: input.fetchTimeoutMs,
      readResponse: async (response, signal) => {
        if (!response.ok) {
          cancelReadableBody(response.body);
          return err(
            createError({
              code: "TARBALL_FETCH_FAILED",
              category: "network",
              message: "Failed to fetch package tarball.",
              details: {
                packageId: input.packageId,
                resolved: safeUrlForErrorDetails(input.resolved),
                status: response.status,
                statusText: response.statusText
              }
            })
          );
        }

        return readResponseBodyWithLimit({
          response,
          signal,
          maxBytes: input.tarballMaxBytes,
          createTooLargeError: (limit) => createError({
            code: "TARBALL_FETCH_FAILED",
            category: "unsupported_input",
            message: "Package tarball response exceeded the maximum supported size.",
            details: {
              packageId: input.packageId,
              resolved: safeUrlForErrorDetails(input.resolved),
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: "TARBALL_FETCH_FAILED",
            category: "unsupported_input",
            message: "Package tarball response did not expose a readable body stream.",
            details: {
              packageId: input.packageId,
              resolved: safeUrlForErrorDetails(input.resolved)
            }
          })
        });
      }
    });

    if (!tarball.ok) {
      return err(tarball.error);
    }

    const verified = verifyPackageIntegrity({
      packageId: input.packageId,
      resolved: input.resolved,
      integrity: input.integrity,
      tarball: tarball.value
    });

    if (!verified.ok) {
      return err(verified.error);
    }

    return collectTarballEvidence({
      packageId: input.packageId,
      tarball: tarball.value
    });
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_FETCH_FAILED",
        category: "network",
        message: "Failed to fetch package tarball.",
        details: {
          packageId: input.packageId,
          resolved: safeUrlForErrorDetails(input.resolved),
          cause: safeErrorCauseForDetails(cause)
        }
      })
    );
  }
}

type ArtifactBodyLimit = {
  maxBytes: number;
  observedBytes: number;
  contentLength?: number;
};

function artifactBodyLimitDetails(limit: ArtifactBodyLimit): Record<string, unknown> {
  return limit.contentLength === undefined
    ? {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes
      }
    : {
        maxBytes: limit.maxBytes,
        observedBytes: limit.observedBytes,
        contentLength: limit.contentLength
      };
}

async function readResponseBodyWithLimit(input: {
  response: ArtifactFetchResponse;
  signal: AbortSignal;
  maxBytes: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
  createUnreadableBodyError: () => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const contentLength = readContentLength(input.response.headers);
  if (contentLength !== undefined && contentLength > input.maxBytes) {
    cancelReadableBody(input.response.body);
    return err(
      input.createTooLargeError({
        maxBytes: input.maxBytes,
        observedBytes: contentLength,
        contentLength
      })
    );
  }

  if (input.response.body) {
    return readStreamBodyWithLimit({
      body: input.response.body,
      signal: input.signal,
      maxBytes: input.maxBytes,
      ...(contentLength === undefined ? {} : { contentLength }),
      createTooLargeError: input.createTooLargeError
    });
  }

  return err(input.createUnreadableBodyError());
}

function cancelReadableBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  if (!body) {
    return;
  }

  void body.cancel().catch(() => undefined);
}

async function readStreamBodyWithLimit(input: {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  maxBytes: number;
  contentLength?: number;
  createTooLargeError: (limit: ArtifactBodyLimit) => OhriskError;
}): Promise<Result<Buffer, OhriskError>> {
  const reader = input.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  const chunks: Buffer[] = [];
  let observedBytes = 0;

  try {
    if (input.signal.aborted) {
      cancelReader();
    } else {
      input.signal.addEventListener("abort", cancelReader, { once: true });
    }

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return ok(Buffer.concat(chunks, observedBytes));
      }

      observedBytes += chunk.value.byteLength;
      if (observedBytes > input.maxBytes) {
        cancelReader();
        return err(
          input.createTooLargeError({
            maxBytes: input.maxBytes,
            observedBytes,
            ...(input.contentLength === undefined ? {} : { contentLength: input.contentLength })
          })
        );
      }

      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    input.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}

function readContentLength(headers: ArtifactFetchResponse["headers"]): number | undefined {
  const value = headers?.get("content-length");
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return undefined;
  }

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readArtifactWithTimeout<T>(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  timeoutMs: number;
  readResponse: (response: ArtifactFetchResponse, signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timeoutError = new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`);
      controller.abort();
      reject(timeoutError);
    }, input.timeoutMs);
  });

  try {
    const readPromise = input
      .fetchArtifact(input.url, {
        signal: controller.signal,
        redirect: "manual"
      })
      .then((response) => input.readResponse(response, controller.signal))
      .then((result) => {
        if (timeoutError) {
          throw timeoutError;
        }

        return result;
      });
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isHttpUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return url !== undefined;
}

function validateRemoteArtifactUrl(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  details: Record<string, unknown>;
}): Result<void, OhriskError> {
  const url = parseHttpUrl(input.resolved);
  if (!url) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          reason: "unsupported_or_invalid_url"
        }
      })
    );
  }

  if (url.username !== "" || url.password !== "") {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: "url_credentials_not_supported"
        }
      })
    );
  }

  const blockedHostReason = blockedRemoteArtifactHostReason(url.hostname);
  if (blockedHostReason) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: blockedHostReason
        }
      })
    );
  }

  return ok(undefined);
}

async function preflightRemoteArtifactFetchTarget(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  resolveFailureMessage: string;
  details: Record<string, unknown>;
  resolveArtifactHost: ArtifactHostResolver | undefined;
}): Promise<Result<void, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: input.message,
    details: input.details
  });

  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (!input.resolveArtifactHost) {
    return ok(undefined);
  }

  const url = parseHttpUrl(input.resolved);
  if (!url) {
    return ok(undefined);
  }

  const artifactHost = normalizeUrlHostname(url.hostname);
  if (!shouldResolveRemoteArtifactHost(artifactHost)) {
    return ok(undefined);
  }

  let resolutions: ArtifactHostResolution[];
  try {
    resolutions = await input.resolveArtifactHost(artifactHost);
  } catch (cause) {
    return err(
      createError({
        code: input.code,
        category: "network",
        message: input.resolveFailureMessage,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost,
          cause: safeErrorCauseForDetails(cause)
        }
      })
    );
  }

  if (resolutions.length === 0) {
    return err(
      createError({
        code: input.code,
        category: "network",
        message: input.resolveFailureMessage,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost,
          reason: "empty_dns_response"
        }
      })
    );
  }

  for (const resolution of resolutions) {
    const resolvedAddress = normalizeUrlHostname(resolution.address);
    const blockedHostReason = blockedRemoteArtifactHostReason(resolvedAddress);
    if (blockedHostReason) {
      return err(
        createError({
          code: input.code,
          category: "unsupported_input",
          message: input.message,
          details: {
            packageId: input.packageId,
            ...redactUrlCredentialsInDetails(input.details),
            artifactHost,
            resolvedAddress,
            reason: blockedHostReason
          }
        })
      );
    }
  }

  return ok(undefined);
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function redactUrlCredentialsInDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...details };
  for (const key of ["registryUrl", "resolved", "tarballUrl", "artifactPath"]) {
    const value = redacted[key];
    if (typeof value === "string") {
      redacted[key] = safeUrlForErrorDetails(value);
    }
  }

  return redacted;
}

function safeOptionalUrlForErrorDetails(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeUrlForErrorDetails(value);
}

function safeErrorCauseForDetails(cause: unknown): string {
  return safeUrlForErrorDetails(cause instanceof Error ? cause.message : String(cause));
}

function safeUrlForErrorDetails(value: string): string {
  try {
    const url = new URL(value);
    if (url.username === "" && url.password === "") {
      return redactUrlCredentialsInText(value);
    }

    if (url.username !== "") {
      url.username = "redacted";
    }
    if (url.password !== "") {
      url.password = "redacted";
    }

    return url.toString();
  } catch {
    return redactUrlCredentialsInText(value);
  }
}

function redactUrlCredentialsInText(value: string): string {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    )
    .replace(
      /([a-z][a-z0-9+.-]{1,}:\\+)([^@/?#\s\\]*)(@)/gi,
      "$1redacted$3"
    );
}

function blockedRemoteArtifactHostReason(hostname: string): string | undefined {
  const host = normalizeUrlHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "localhost";
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return blockedIpv4HostReason(host);
  }

  if (ipVersion === 6) {
    return blockedIpv6HostReason(host);
  }

  return undefined;
}

function shouldResolveRemoteArtifactHost(hostname: string): boolean {
  return isIP(hostname) === 0 && blockedRemoteArtifactHostReason(hostname) === undefined;
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function blockedIpv4HostReason(host: string): string | undefined {
  const octets = host.split(".").map((part) => Number(part));
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return "invalid_ipv4";
  }

  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return "unspecified_ipv4";
  if (a === 10) return "private_ipv4";
  if (a === 100 && b >= 64 && b <= 127) return "shared_address_ipv4";
  if (a === 127) return "loopback_ipv4";
  if (a === 169 && b === 254) return "link_local_ipv4";
  if (a === 172 && b >= 16 && b <= 31) return "private_ipv4";
  if (a === 192 && b === 168) return "private_ipv4";
  if (a === 192 && b === 0 && c === 2) return "documentation_ipv4";
  if (a === 192 && b === 0) return "non_public_ipv4";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking_ipv4";
  if (a === 198 && b === 51 && c === 100) return "documentation_ipv4";
  if (a === 203 && b === 0 && c === 113) return "documentation_ipv4";
  if (a >= 224) return "multicast_or_reserved_ipv4";

  return undefined;
}

function blockedIpv6HostReason(host: string): string | undefined {
  if (host === "::") return "unspecified_ipv6";
  if (host === "::1") return "loopback_ipv6";

  const embeddedIpv4 = embeddedIpv4FromIpv6Host(host);
  if (embeddedIpv4) {
    return blockedIpv4HostReason(embeddedIpv4);
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return "invalid_ipv6";
  }

  const [firstHextet, secondHextet, thirdHextet, fourthHextet] = hextets;

  if (
    firstHextet === 0x0064
    && secondHextet === 0xff9b
    && thirdHextet === 0x0001
  ) {
    return "local_nat64_ipv6";
  }

  if (
    firstHextet === 0x0100
    && secondHextet === 0
    && thirdHextet === 0
    && fourthHextet === 0
  ) {
    return "discard_ipv6";
  }

  if ((firstHextet & 0xfe00) === 0xfc00) return "unique_local_ipv6";
  if ((firstHextet & 0xffc0) === 0xfe80) return "link_local_ipv6";
  if ((firstHextet & 0xff00) === 0xff00) return "multicast_ipv6";

  if (firstHextet === 0x2001 && secondHextet === 0) return "teredo_ipv6";
  if (
    firstHextet === 0x2001
    && secondHextet === 0x0002
    && thirdHextet === 0
  ) {
    return "benchmarking_ipv6";
  }
  if (
    firstHextet === 0x2001
    && ((secondHextet & 0xfff0) === 0x0010 || (secondHextet & 0xfff0) === 0x0020)
  ) {
    return "orchid_ipv6";
  }
  if (firstHextet === 0x2001 && secondHextet === 0x0db8) return "documentation_ipv6";

  return undefined;
}

function embeddedIpv4FromIpv6Host(host: string): string | undefined {
  const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted?.[1]) {
    return dotted[1];
  }

  const hextets = expandIpv6Hextets(host);
  if (!hextets) {
    return undefined;
  }

  if (
    hextets.slice(0, 5).every((hextet) => hextet === 0)
    && hextets[5] === 0xffff
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets.slice(0, 6).every((hextet) => hextet === 0)
    && (hextets[6] !== 0 || hextets[7] > 1)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (
    hextets[0] === 0x0064
    && hextets[1] === 0xff9b
    && hextets.slice(2, 6).every((hextet) => hextet === 0)
  ) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (hextets[0] === 0x2002) {
    return ipv4FromHextets(hextets[1], hextets[2]);
  }

  return undefined;
}

function ipv4FromHextets(high: number, low: number): string {
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join(".");
}

function expandIpv6Hextets(host: string): Ipv6Hextets | undefined {
  if (host.includes(".")) {
    return undefined;
  }

  const [left = "", right = "", extra] = host.split("::");
  if (extra !== undefined) {
    return undefined;
  }

  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === "" ? [] : right.split(":");
  const hasCompression = host.includes("::");
  const missingCount = hasCompression ? 8 - leftParts.length - rightParts.length : 0;
  if ((!hasCompression && leftParts.length !== 8) || missingCount < 0) {
    return undefined;
  }

  const parts = [
    ...leftParts,
    ...Array.from({ length: missingCount }, () => "0"),
    ...rightParts
  ];
  if (parts.length !== 8) {
    return undefined;
  }

  const hextets = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return undefined;
    }

    const value = Number.parseInt(part, 16);
    return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : undefined;
  });

  return hextets.every((hextet): hextet is number => hextet !== undefined)
    ? hextets as Ipv6Hextets
    : undefined;
}

function verifyPackageIntegrity(input: {
  packageId: string;
  resolved: string | undefined;
  integrity: string | undefined;
  tarball: Buffer;
}): Result<void, OhriskError> {
  if (!input.integrity) {
    return ok(undefined);
  }

  const supported = parseSupportedIntegrityEntries(input.integrity);
  if (supported.length === 0) {
    return err(
      createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: "Package artifact integrity could not be verified because no supported digest was found.",
        details: {
          packageId: input.packageId,
          resolved: safeOptionalUrlForErrorDetails(input.resolved),
          integrity: input.integrity,
          supportedAlgorithms: ["sha512", "sha384", "sha256", "sha1"]
        }
      })
    );
  }

  const computed: string[] = [];
  for (const entry of supported) {
    const actualDigest = createHash(entry.algorithm).update(input.tarball).digest();
    const actual = `${entry.algorithm}-${actualDigest.toString("base64")}`;
    computed.push(actual);

    if (
      actualDigest.byteLength === entry.digest.byteLength
      && timingSafeEqual(actualDigest, entry.digest)
    ) {
      return ok(undefined);
    }
  }

  return err(
    createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Package artifact integrity did not match the lockfile digest.",
      details: {
        packageId: input.packageId,
        resolved: safeOptionalUrlForErrorDetails(input.resolved),
        integrity: input.integrity,
        computed
      }
    })
  );
}

function parseSupportedIntegrityEntries(
  integrity: string
): Array<{ algorithm: SupportedIntegrityAlgorithm; digest: Buffer }> {
  return integrity
    .split(/\s+/)
    .map((entry) => {
      const separatorIndex = entry.indexOf("-");
      if (separatorIndex <= 0) {
        return undefined;
      }

      const algorithm = entry.slice(0, separatorIndex);
      const digest = entry.slice(separatorIndex + 1);
      if (!isSupportedIntegrityAlgorithm(algorithm) || digest === "") {
        return undefined;
      }

      const decoded = decodeIntegrityDigest({ algorithm, digest });
      if (!decoded) {
        return undefined;
      }

      return {
        algorithm,
        digest: decoded
      };
    })
    .filter((entry): entry is {
      algorithm: SupportedIntegrityAlgorithm;
      digest: Buffer;
    } => entry !== undefined);
}

function isSupportedIntegrityAlgorithm(value: string): value is SupportedIntegrityAlgorithm {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_INTEGRITY_DIGEST_BYTES, value);
}

function decodeIntegrityDigest(input: {
  algorithm: SupportedIntegrityAlgorithm;
  digest: string;
}): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.digest)) {
    return undefined;
  }

  const paddingStart = input.digest.indexOf("=");
  if (paddingStart !== -1 && !/^=+$/.test(input.digest.slice(paddingStart))) {
    return undefined;
  }

  if (input.digest.length % 4 === 1) {
    return undefined;
  }

  const decoded = Buffer.from(input.digest, "base64");
  if (decoded.byteLength !== SUPPORTED_INTEGRITY_DIGEST_BYTES[input.algorithm]) {
    return undefined;
  }

  const normalizedInput = input.digest.replace(/=+$/, "");
  const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
  return normalizedDecoded === normalizedInput ? decoded : undefined;
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

function defaultArtifactFetcher(
  url: string,
  options?: ArtifactFetchOptions
): Promise<ArtifactFetchResponse> {
  return fetch(url, {
    ...(options?.signal ? { signal: options.signal } : {}),
    redirect: options?.redirect ?? "manual"
  });
}

async function defaultArtifactHostResolver(hostname: string): Promise<ArtifactHostResolution[]> {
  return lookup(hostname, {
    all: true,
    verbatim: true
  });
}
