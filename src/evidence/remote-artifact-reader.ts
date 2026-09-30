import { recordArtifactBytes } from "./artifact-capture";
import { artifactCacheMetadataFromHeaders, type ArtifactCache, type ArtifactCacheEntry } from "./cache";
import { artifactBodyLimitDetails, cancelReadableBody, readResponseBodyWithLimit, type ArtifactFetchResponse, type ArtifactFetcher } from "./artifact-response";
import { BlockedArtifactRemoteAddressError, blockedRemoteArtifactHostReason, isExplicitlyAllowedArtifactHost, normalizeUrlHostname, shouldResolveRemoteArtifactHost, type ArtifactHostResolution, type ArtifactHostResolver } from "./artifact-transport";
import { parseHttpUrl, redactUrlCredentialsInDetails, safeErrorCauseForDetails, safeUrlForErrorDetails } from "./artifact-url";
import { abortableDelay, isAbortErrorLike, isCollectionAbortedError } from "./cancellation";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { type RemoteArtifactRead, type RemoteArtifactFetchPolicy, MAX_ARTIFACT_REDIRECTS } from "./collection-runtime";

export async function readRemoteArtifactBytes(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  url: string;
  blockedMessage: string;
  resolveFailureMessage: string;
  fetchFailureMessage: string;
  tooLargeMessage: string;
  unreadableMessage: string;
  offlineMissMessage: string;
  details: Record<string, unknown>;
  maxBytes: number;
  fetchArtifact: ArtifactFetcher;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  fetchTimeoutMs: number;
  offline: boolean;
  artifactCache: ArtifactCache | undefined;
  allowedHosts: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
  urlDetailKey: "registryUrl" | "resolved";
  transientFetchAttempts?: number;
  transientRetryDelayMs?: number;
  signal: AbortSignal;
}): Promise<Result<Buffer, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.url,
    message: input.blockedMessage,
    details: input.details,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!urlValidation.ok) {
    return err(urlValidation.error);
  }

  if (input.signal.aborted) {
    return err(collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    }));
  }

  const cached = input.artifactCache?.read(input.url, input.maxBytes);
  if (cached && (!cached.stale || input.offline)) {
    recordArtifactBytes({ packageId: input.packageId, bytes: cached.bytes, requestedOrigin: input.url, retrieval: "cache" });
    return ok(cached.bytes);
  }

  if (input.offline) {
    return err(createError({
      code: input.code,
      category: "network",
      message: input.offlineMissMessage,
      details: {
        packageId: input.packageId,
        ...redactUrlCredentialsInDetails(input.details),
        reason: "offline_cache_miss"
      }
    }));
  }

  const preflight = await preflightRemoteArtifactFetchTarget({
    code: input.code,
    packageId: input.packageId,
    resolved: input.url,
    message: input.blockedMessage,
    resolveFailureMessage: input.resolveFailureMessage,
    details: input.details,
    resolveArtifactHost: input.resolveArtifactHost,
    timeoutMs: input.fetchTimeoutMs,
    allowedHosts: input.allowedHosts,
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
  });
  if (!preflight.ok) {
    return err(preflight.error);
  }

  const requestHeaders = conditionalArtifactRequestHeaders(cached);
  const artifact = await readTransientRemoteArtifactWithRetry({
    attempts: input.transientFetchAttempts ?? 1,
    retryDelayMs: input.transientRetryDelayMs ?? 0,
    signal: input.signal,
    createAbortError: () => collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    }),
    read: () => readArtifactWithTimeout<RemoteArtifactRead>({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      ...(requestHeaders ? { requestHeaders } : {}),
      timeoutMs: input.fetchTimeoutMs,
      signal: input.signal,
      createAbortError: () => collectionAbortedRemoteError({
        code: input.code,
        details: input.details
      }),
      redirectPolicy: {
        code: input.code,
        packageId: input.packageId,
        message: input.blockedMessage,
        resolveFailureMessage: input.resolveFailureMessage,
        details: input.details,
        resolveArtifactHost: input.resolveArtifactHost,
        allowedHosts: input.allowedHosts,
        ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
      },
      createFailureError: (cause) => createRemoteArtifactExceptionError({
        code: input.code,
        message: input.fetchFailureMessage,
        blockedMessage: input.blockedMessage,
        details: {
          packageId: input.packageId,
          [input.urlDetailKey]: safeUrlForErrorDetails(input.url),
          ...input.details
        },
        cause
      }),
      readResponse: async (response, signal) => {
        const cacheMetadata = artifactCacheMetadataFromHeaders(response.headers);
        if (response.status === 304) {
          cancelReadableBody(response.body);
          if (!cached) {
            return err(createError({
              code: input.code,
              category: "network",
              message: input.fetchFailureMessage,
              details: {
                packageId: input.packageId,
                [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
                status: response.status,
                statusText: response.statusText,
                reason: "not_modified_without_cache_entry"
              }
            }));
          }
          return ok({
            bytes: cached.bytes,
            cacheMetadata,
            notModified: true
          });
        }

        if (!response.ok) {
          cancelReadableBody(response.body);
          return err(createError({
            code: input.code,
            category: "network",
            message: input.fetchFailureMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
              status: response.status,
              statusText: response.statusText
            }
          }));
        }

        const bytes = await readResponseBodyWithLimit({
          response,
          signal,
          maxBytes: input.maxBytes,
          createTooLargeError: (limit) => createError({
            code: input.code,
            category: "unsupported_input",
            message: input.tooLargeMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url),
              ...artifactBodyLimitDetails(limit)
            }
          }),
          createUnreadableBodyError: () => createError({
            code: input.code,
            category: "unsupported_input",
            message: input.unreadableMessage,
            details: {
              packageId: input.packageId,
              [input.urlDetailKey]: safeUrlForErrorDetails(response.url ?? input.url)
            }
          })
        });
        return bytes.ok
          ? ok({ bytes: bytes.value, cacheMetadata, notModified: false })
          : bytes;
      }
    })
  });
  if (!artifact.ok) {
    return artifact;
  }

  if (artifact.value.notModified) {
    if (artifact.value.cacheMetadata.cacheable) {
      input.artifactCache?.revalidate(input.url, artifact.value.cacheMetadata);
    } else {
      input.artifactCache?.remove(input.url);
    }
  } else if (artifact.value.cacheMetadata.cacheable) {
    input.artifactCache?.write(
      input.url,
      artifact.value.bytes,
      artifact.value.cacheMetadata
    );
  } else {
    input.artifactCache?.remove(input.url);
  }
  recordArtifactBytes({ packageId: input.packageId, bytes: artifact.value.bytes, requestedOrigin: input.url,
    retrieval: artifact.value.notModified ? "revalidated-cache" : "network" });
  return ok(artifact.value.bytes);
}

async function readTransientRemoteArtifactWithRetry<T>(input: {
  attempts: number;
  retryDelayMs: number;
  signal?: AbortSignal;
  createAbortError: () => OhriskError;
  read: () => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const attempts = Math.max(1, Math.trunc(input.attempts));
  let result = await input.read();
  for (let attempt = 1; attempt < attempts && !result.ok; attempt += 1) {
    if (!isRetryableTransientRemoteError(result.error)) {
      return result;
    }
    if (input.signal?.aborted) {
      return err(input.createAbortError());
    }
    if (input.retryDelayMs > 0) {
      await abortableDelay(input.retryDelayMs, input.signal);
      if (input.signal?.aborted) {
        return err(input.createAbortError());
      }
    }
    result = await input.read();
  }
  return result;
}

function isRetryableTransientRemoteError(error: OhriskError): boolean {
  if (isCollectionAbortedError(error)) {
    return false;
  }
  if (error.category !== "network") {
    return false;
  }
  const status = error.details?.status;
  if (typeof status === "number") {
    return status === 408
      || status === 425
      || status === 429
      || status === 500
      || status === 502
      || status === 503
      || status === 504;
  }
  const cause = error.details?.cause;
  return typeof cause !== "string" || !cause.toLowerCase().includes("timed out");
}

function collectionAbortedRemoteError(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  details: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: input.code,
    category: "network",
    message: "Evidence collection was aborted.",
    details: {
      ...redactUrlCredentialsInDetails(input.details),
      reason: "aborted"
    }
  });
}

async function readArtifactWithTimeout<T>(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  requestHeaders?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  createAbortError: () => OhriskError;
  redirectPolicy: RemoteArtifactFetchPolicy;
  createFailureError: (cause: unknown) => OhriskError;
  readResponse: (
    response: ArtifactFetchResponse,
    signal: AbortSignal
  ) => Promise<Result<T, OhriskError>>;
}): Promise<Result<T, OhriskError>> {
  const controller = new AbortController();
  const fetchController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: Error | undefined;
  let onExternalAbort: (() => void) | undefined;

  const timeoutPromise = new Promise<Result<T, OhriskError>>((resolve) => {
    timeout = setTimeout(() => {
      timeoutError = new Error(`Artifact fetch timed out after ${input.timeoutMs}ms.`);
      controller.abort();
      fetchController.abort();
      resolve(err(input.createFailureError(timeoutError)));
    }, input.timeoutMs);
  });

  if (input.signal) {
    if (input.signal.aborted) {
      fetchController.abort();
    } else {
      // The batch abort cancels the request and its body stream immediately,
      // while a response that was already obtained still settles its body read
      // through the timeout-only signal so real package fatals can participate
      // in the deterministic lowest-index arbitration.
      onExternalAbort = () => fetchController.abort();
      input.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  try {
    const readPromise = fetchArtifactWithManualRedirects({
      fetchArtifact: input.fetchArtifact,
      url: input.url,
      signal: fetchController.signal,
      ...(input.requestHeaders ? { requestHeaders: input.requestHeaders } : {}),
      redirectPolicy: input.redirectPolicy
    })
      .then(async (response): Promise<Result<T, OhriskError>> => {
        if (!response.ok) {
          return err(response.error);
        }

        const result = await input.readResponse(response.value, controller.signal);
        if (timeoutError) {
          throw timeoutError;
        }

        return result;
      })
      .catch((cause): Result<T, OhriskError> => {
        if (input.signal?.aborted) {
          return err(input.createAbortError());
        }
        return err(input.createFailureError(cause));
      });
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (onExternalAbort) {
      input.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

async function fetchArtifactWithManualRedirects(input: {
  fetchArtifact: ArtifactFetcher;
  url: string;
  signal: AbortSignal;
  requestHeaders?: Record<string, string>;
  redirectPolicy: RemoteArtifactFetchPolicy;
}): Promise<Result<ArtifactFetchResponse, OhriskError>> {
  let currentUrl = input.url;

  for (let redirectCount = 0; redirectCount <= MAX_ARTIFACT_REDIRECTS; redirectCount += 1) {
    const response = await input.fetchArtifact(currentUrl, {
      signal: input.signal,
      redirect: "manual",
      ...(redirectCount === 0 && input.requestHeaders
        ? { headers: input.requestHeaders }
        : {})
    });
    const responseWithUrl: ArtifactFetchResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: currentUrl,
      arrayBuffer: () => response.arrayBuffer(),
      ...(response.headers === undefined ? {} : { headers: response.headers }),
      ...(response.body === undefined ? {} : { body: response.body })
    };

    if (!isRedirectResponse(responseWithUrl)) {
      return ok(responseWithUrl);
    }

    cancelReadableBody(responseWithUrl.body);

    const location = responseWithUrl.headers?.get("location")?.trim();
    if (!location) {
      return ok(responseWithUrl);
    }

    if (redirectCount >= MAX_ARTIFACT_REDIRECTS) {
      return err(
        createError({
          code: input.redirectPolicy.code,
          category: "network",
          message: "Package artifact redirect limit exceeded.",
          details: {
            packageId: input.redirectPolicy.packageId,
            ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
            redirectFrom: safeUrlForErrorDetails(currentUrl),
            redirectCount: redirectCount + 1,
            maxRedirects: MAX_ARTIFACT_REDIRECTS
          }
        })
      );
    }

    const nextUrl = resolveRedirectLocation(currentUrl, location);
    if (!nextUrl) {
      return err(
        createError({
          code: input.redirectPolicy.code,
          category: "unsupported_input",
          message: input.redirectPolicy.message,
          details: {
            packageId: input.redirectPolicy.packageId,
            ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
            redirectFrom: safeUrlForErrorDetails(currentUrl),
            redirectLocation: safeUrlForErrorDetails(location),
            reason: "invalid_redirect_location"
          }
        })
      );
    }

    const redirectPreflight = await preflightRemoteArtifactFetchTarget({
      code: input.redirectPolicy.code,
      packageId: input.redirectPolicy.packageId,
      resolved: nextUrl,
      message: input.redirectPolicy.message,
      resolveFailureMessage: input.redirectPolicy.resolveFailureMessage,
      details: {
        ...input.redirectPolicy.details,
        redirectFrom: currentUrl,
        redirectUrl: nextUrl
      },
      resolveArtifactHost: input.redirectPolicy.resolveArtifactHost,
      ...(input.redirectPolicy.allowedHosts
        ? { allowedHosts: input.redirectPolicy.allowedHosts }
        : {}),
      ...(input.redirectPolicy.permittedHosts
        ? { permittedHosts: input.redirectPolicy.permittedHosts }
        : {})
    });

    if (!redirectPreflight.ok) {
      return err(redirectPreflight.error);
    }

    currentUrl = nextUrl;
  }

  return err(
    createError({
      code: input.redirectPolicy.code,
      category: "network",
      message: "Package artifact redirect limit exceeded.",
      details: {
        packageId: input.redirectPolicy.packageId,
        ...redactUrlCredentialsInDetails(input.redirectPolicy.details),
        redirectFrom: safeUrlForErrorDetails(currentUrl),
        maxRedirects: MAX_ARTIFACT_REDIRECTS
      }
    })
  );
}

function isRedirectResponse(response: ArtifactFetchResponse): boolean {
  return response.status === 301
    || response.status === 302
    || response.status === 303
    || response.status === 307
    || response.status === 308;
}

function conditionalArtifactRequestHeaders(
  cached: ArtifactCacheEntry | undefined
): Record<string, string> | undefined {
  if (!cached?.stale) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  if (cached.etag) {
    headers["if-none-match"] = cached.etag;
  }
  if (cached.lastModified) {
    headers["if-modified-since"] = cached.lastModified;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function resolveRedirectLocation(currentUrl: string, location: string): string | undefined {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return undefined;
  }
}

export function isHttpUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return url !== undefined;
}

export function validateRemoteArtifactUrl(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  details: Record<string, unknown>;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
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

  if (url.protocol !== "https:") {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizeUrlHostname(url.hostname),
          reason: "insecure_http_not_supported"
        }
      })
    );
  }

  const normalizedHost = normalizeUrlHostname(url.hostname);
  if (input.permittedHosts && !input.permittedHosts.has(normalizedHost)) {
    return err(
      createError({
        code: input.code,
        category: "unsupported_input",
        message: input.message,
        details: {
          packageId: input.packageId,
          ...redactUrlCredentialsInDetails(input.details),
          artifactHost: normalizedHost,
          reason: "host_not_permitted"
        }
      })
    );
  }
  const blockedHostReason = isExplicitlyAllowedArtifactHost(normalizedHost, input.allowedHosts)
    ? undefined
    : blockedRemoteArtifactHostReason(normalizedHost);
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

export async function preflightRemoteArtifactFetchTarget(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  packageId: string;
  resolved: string;
  message: string;
  resolveFailureMessage: string;
  details: Record<string, unknown>;
  resolveArtifactHost: ArtifactHostResolver | undefined;
  timeoutMs?: number;
  allowedHosts?: ReadonlySet<string>;
  permittedHosts?: ReadonlySet<string>;
}): Promise<Result<void, OhriskError>> {
  const urlValidation = validateRemoteArtifactUrl({
    code: input.code,
    packageId: input.packageId,
    resolved: input.resolved,
    message: input.message,
    details: input.details,
    ...(input.allowedHosts ? { allowedHosts: input.allowedHosts } : {}),
    ...(input.permittedHosts ? { permittedHosts: input.permittedHosts } : {})
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
    resolutions = await resolveArtifactHostWithTimeout({
      resolveArtifactHost: input.resolveArtifactHost,
      artifactHost,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
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

async function resolveArtifactHostWithTimeout(input: {
  resolveArtifactHost: ArtifactHostResolver;
  artifactHost: string;
  timeoutMs?: number;
}): Promise<ArtifactHostResolution[]> {
  if (input.timeoutMs === undefined) {
    return input.resolveArtifactHost(input.artifactHost);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.resolveArtifactHost(input.artifactHost),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(
            `Artifact host resolution timed out after ${input.timeoutMs}ms.`
          ));
        }, input.timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createRemoteArtifactExceptionError(input: {
  code: "REGISTRY_METADATA_FETCH_FAILED" | "TARBALL_FETCH_FAILED";
  message: string;
  blockedMessage: string;
  details: Record<string, unknown>;
  cause: unknown;
}): OhriskError {
  if (input.cause instanceof BlockedArtifactRemoteAddressError) {
    return createError({
      code: input.code,
      category: "unsupported_input",
      message: input.blockedMessage,
      details: {
        ...redactUrlCredentialsInDetails(input.details),
        artifactHost: input.cause.hostname,
        resolvedAddress: normalizeUrlHostname(input.cause.remoteAddress),
        reason: input.cause.reason
      }
    });
  }

  if (isAbortErrorLike(input.cause)) {
    return collectionAbortedRemoteError({
      code: input.code,
      details: input.details
    });
  }

  return createError({
    code: input.code,
    category: "network",
    message: input.message,
    details: {
      ...redactUrlCredentialsInDetails(input.details),
      cause: safeErrorCauseForDetails(input.cause)
    }
  });
}
