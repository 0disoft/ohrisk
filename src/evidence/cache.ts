import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { createError, type OhriskError } from "../shared/errors";
import { omitUndefined } from "../shared/object";
import { err, ok, type Result } from "../shared/result";
import { executeCachePrunePlan } from "./cache-prune-executor";
import { planCachePrune } from "./cache-prune-plan";

const CACHE_FORMAT_VERSION = 3;
const LEGACY_CACHE_FORMAT_VERSION = 2;
const CACHE_INDEX_MAX_BYTES = 32 * 1024;
const CACHE_MARKER_FILENAME = ".ohrisk-artifact-cache";
const CACHE_MARKER_CONTENT = "ohrisk artifact cache v3\n";
const CACHE_MAINTENANCE_LOCK_FILENAME = ".ohrisk-artifact-cache-maintenance.lock";
const CACHE_MAINTENANCE_STAMP_FILENAME = ".ohrisk-artifact-cache-maintained";
const CACHE_MAINTENANCE_ATTEMPT_STAMP_FILENAME = ".ohrisk-artifact-cache-maintenance-attempted";
const CACHE_MAINTENANCE_COOLDOWN_MS = 60_000;
const CACHE_MAINTENANCE_LOCK_STALE_MS = 10 * 60_000;
const CACHE_MAINTENANCE_BUDGET_MS = 1_000;
export const DEFAULT_ARTIFACT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ARTIFACT_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_HTTP_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_VALIDATOR_LENGTH = 4 * 1024;

export type ArtifactCacheValidators = {
  etag?: string;
  lastModified?: string;
};

export type ArtifactCacheEntry = ArtifactCacheValidators & {
  bytes: Buffer;
  digest: string;
  fetchedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  stale: boolean;
};

export type ArtifactCacheWriteMetadata = ArtifactCacheValidators & {
  fetchedAt?: number;
  expiresAt?: number;
};

export type ArtifactCacheResponseMetadata = ArtifactCacheWriteMetadata & {
  cacheable: boolean;
};

export type ArtifactCacheStatus = {
  entryCount: number;
  objectCount: number;
  totalBytes: number;
  orphanObjectCount: number;
  orphanBytes: number;
  staleEntryCount: number;
  corruptEntryCount: number;
  oldestAccessedAt?: number;
  newestAccessedAt?: number;
};

export type ArtifactCachePruneOptions = {
  maxSizeBytes?: number;
  maxAgeMs?: number;
  removeExpired?: boolean;
};

export type ArtifactCachePruneResult = {
  before: ArtifactCacheStatus;
  after: ArtifactCacheStatus;
  removedEntryCount: number;
  removedObjectCount: number;
  removedBytes: number;
};

export type ArtifactCacheClearResult = {
  removedEntryCount: number;
  removedObjectCount: number;
  removedBytes: number;
};

export type ArtifactCache = {
  rootDir: string;
  read: (url: string, maxBytes: number) => ArtifactCacheEntry | undefined;
  write: (url: string, bytes: Buffer, metadata?: ArtifactCacheWriteMetadata) => void;
  revalidate: (url: string, metadata?: ArtifactCacheWriteMetadata) => void;
  remove: (url: string) => void;
  maintain: (options?: ArtifactCacheMaintenanceOptions) => void;
  status: () => Result<ArtifactCacheStatus, OhriskError>;
  prune: (options?: ArtifactCachePruneOptions) => Result<ArtifactCachePruneResult, OhriskError>;
  clear: () => Result<ArtifactCacheClearResult, OhriskError>;
};

export type ArtifactCacheMaintenanceOptions = {
  signal?: AbortSignal;
};

type ArtifactCacheIndexV3 = {
  version: typeof CACHE_FORMAT_VERSION;
  key: string;
  sha256: string;
  size: number;
  fetchedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  etag?: string;
  lastModified?: string;
};

type ArtifactCacheIndexV2 = {
  version: typeof LEGACY_CACHE_FORMAT_VERSION;
  key: string;
  sha256: string;
  size: number;
};

type ArtifactCacheIndex = ArtifactCacheIndexV3 | ArtifactCacheIndexV2;

export type CacheIndexRecord = {
  path: string;
  index: ArtifactCacheIndexV3;
};

export type CacheInventory = {
  entries: CacheIndexRecord[];
  objectSizes: Map<string, number>;
  corruptEntryCount: number;
};

type ArtifactCacheOptions = {
  now?: () => number;
  defaultTtlMs?: number;
  maxSizeBytes?: number;
  maintenanceBudgetMs?: number;
  maintenanceClock?: () => number;
};

type CacheMaintenanceGuard = {
  signal?: AbortSignal;
  deadline: number;
  clock: () => number;
};

/**
 * Creates a content-addressed artifact cache. Cache corruption is treated as a
 * miss and cleaned up, so a broken cache cannot silently affect scan results.
 */
export function defaultArtifactCacheDirectory(
  env: Record<string, string | undefined> = process.env,
  homeDirectory: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string {
  const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
  if (xdgCacheHome) {
    return path.resolve(xdgCacheHome, "ohrisk", "artifacts");
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) {
      return path.resolve(localAppData, "Ohrisk", "Cache", "artifacts");
    }
  }

  return path.resolve(homeDirectory, ".cache", "ohrisk", "artifacts");
}

export function createArtifactCache(
  rootDir: string,
  options: ArtifactCacheOptions = {}
): ArtifactCache {
  return createArtifactCacheHandle(rootDir, options, true);
}

export function openArtifactCacheForManagement(
  rootDir: string,
  options: ArtifactCacheOptions = {}
): ArtifactCache {
  return createArtifactCacheHandle(rootDir, options, false);
}

function createArtifactCacheHandle(
  rootDir: string,
  options: ArtifactCacheOptions,
  initializeOwnership: boolean
): ArtifactCache {
  const resolvedRoot = path.resolve(rootDir);
  const now = options.now ?? Date.now;
  const defaultTtlMs = normalizeTtl(options.defaultTtlMs, DEFAULT_ARTIFACT_CACHE_TTL_MS);
  const maxSizeBytes = normalizeMaxSize(
    options.maxSizeBytes,
    DEFAULT_ARTIFACT_CACHE_MAX_BYTES
  );
  const maintenanceBudgetMs = normalizeMaintenanceBudget(options.maintenanceBudgetMs);
  const maintenanceClock = options.maintenanceClock ?? performance.now.bind(performance);
  if (initializeOwnership) {
    ensureCacheMarker(resolvedRoot);
  }
  return {
    rootDir: resolvedRoot,
    read: (url, maxBytes) => readArtifactCacheEntry({
      rootDir: resolvedRoot,
      url,
      maxBytes,
      now: now(),
      defaultTtlMs
    }),
    write: (url, bytes, metadata) => {
      writeArtifactCacheEntry(omitUndefined({
        rootDir: resolvedRoot,
        url,
        bytes,
        now: now(),
        defaultTtlMs,
        metadata
      }));
    },
    revalidate: (url, metadata) => revalidateArtifactCacheEntry(omitUndefined({
      rootDir: resolvedRoot,
      url,
      now: now(),
      defaultTtlMs,
      metadata
    })),
    remove: (url) => {
      withCacheCommitLock(resolvedRoot, now(), (): Result<undefined, OhriskError> => {
        removeArtifactCacheEntry(resolvedRoot, url, now());
        return ok(undefined);
      });
    },
    maintain: (maintenanceOptions = {}) => maintainArtifactCache(
      resolvedRoot,
      maxSizeBytes,
      now(),
      {
        ...(maintenanceOptions.signal ? { signal: maintenanceOptions.signal } : {}),
        deadline: maintenanceClock() + maintenanceBudgetMs,
        clock: maintenanceClock
      }
    ),
    status: () => artifactCacheStatus(resolvedRoot, now()),
    prune: (pruneOptions = {}) => withCacheCommitLock(
      resolvedRoot,
      now(),
      () => pruneArtifactCache(resolvedRoot, pruneOptions, now())
    ),
    clear: () => withCacheCommitLock(
      resolvedRoot,
      now(),
      () => clearArtifactCache(resolvedRoot, now())
    )
  };
}

function maintainArtifactCache(
  rootDir: string,
  maxSizeBytes: number,
  now: number,
  guard: CacheMaintenanceGuard
): void {
  if (
    cacheMaintenanceShouldStop(guard)
    || !hasValidCacheMarker(rootDir)
    || cacheMaintenanceIsRecent(rootDir, now)
  ) {
    return;
  }

  const lockPath = path.join(rootDir, CACHE_MAINTENANCE_LOCK_FILENAME);
  if (!acquireCacheMaintenanceLock(lockPath, now)) {
    return;
  }

  try {
    if (cacheMaintenanceShouldStop(guard) || cacheMaintenanceIsRecent(rootDir, now)) {
      return;
    }
    replaceAtomicBestEffort(
      path.join(rootDir, CACHE_MAINTENANCE_ATTEMPT_STAMP_FILENAME),
      Buffer.from(`${now}\n`, "utf8")
    );
    if (pruneArtifactCacheAutomatically(rootDir, maxSizeBytes, now, guard)) {
      replaceAtomicBestEffort(
        path.join(rootDir, CACHE_MAINTENANCE_STAMP_FILENAME),
        Buffer.from(`${now}\n`, "utf8")
      );
    }
  } finally {
    removeQuietly(lockPath);
  }
}

function pruneArtifactCacheAutomatically(
  rootDir: string,
  maxSizeBytes: number,
  now: number,
  guard: CacheMaintenanceGuard
): boolean {
  try {
    requireCacheMaintenanceBudget(guard);
    requireValidCacheMarker(rootDir);
    const inventory = scanCacheInventory(rootDir, now, guard, false);
    requireCacheMaintenanceBudget(guard);
    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now,
      maxSizeBytes,
      removeExpired: false
    });
    requireCacheMaintenanceBudget(guard);
    const execution = executeCachePrunePlan({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      plan,
      retainState: false,
      shouldStop: () => cacheMaintenanceShouldStop(guard),
      removeEntry: removeQuietly,
      removeObject: (digest) => removeQuietly(cacheObjectPath(rootDir, digest))
    });
    return execution.completed && !cacheMaintenanceShouldStop(guard);
  } catch {
    return false;
  }
}

function cacheMaintenanceShouldStop(guard: CacheMaintenanceGuard): boolean {
  return guard.signal?.aborted === true || guard.clock() >= guard.deadline;
}

function requireCacheMaintenanceBudget(guard: CacheMaintenanceGuard | undefined): void {
  if (guard && cacheMaintenanceShouldStop(guard)) {
    throw new Error("cache_maintenance_interrupted");
  }
}

function cacheMaintenanceIsRecent(rootDir: string, now: number): boolean {
  return [CACHE_MAINTENANCE_STAMP_FILENAME, CACHE_MAINTENANCE_ATTEMPT_STAMP_FILENAME]
    .some((filename) => cacheMaintenanceStampIsRecent(path.join(rootDir, filename), now));
}

function cacheMaintenanceStampIsRecent(stampPath: string, now: number): boolean {
  try {
    const stamp = lstatSync(stampPath);
    const recordedAt = readCacheMaintenanceStampTimestamp(stampPath, stamp.size) ?? stamp.mtimeMs;
    return stamp.isFile()
      && now >= recordedAt
      && now - recordedAt < CACHE_MAINTENANCE_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function readCacheMaintenanceStampTimestamp(stampPath: string, size: number): number | undefined {
  if (size < 2 || size > 32) return undefined;
  try {
    const raw = readFileSync(stampPath, "utf8");
    if (!/^(?:0|[1-9]\d*)\n$/u.test(raw)) return undefined;
    const timestamp = Number(raw.slice(0, -1));
    return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

function acquireCacheMaintenanceLock(lockPath: string, now: number): boolean {
  const create = (): boolean => {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  };
  if (create()) {
    return true;
  }

  try {
    const lock = lstatSync(lockPath);
    if (
      !lock.isFile()
      || now < lock.mtimeMs
      || now - lock.mtimeMs < CACHE_MAINTENANCE_LOCK_STALE_MS
    ) {
      return false;
    }
    removeQuietly(lockPath);
  } catch {
    return false;
  }
  return create();
}

export function artifactCacheMetadataFromHeaders(
  headers: { get: (name: string) => string | null } | undefined,
  options: {
    now?: number;
    defaultTtlMs?: number;
  } = {}
): ArtifactCacheResponseMetadata {
  const now = options.now ?? Date.now();
  const defaultTtlMs = normalizeTtl(options.defaultTtlMs, DEFAULT_ARTIFACT_CACHE_TTL_MS);
  const cacheControl = headers?.get("cache-control")?.trim() ?? "";
  const directives = parseCacheControl(cacheControl);
  const cacheable = !directives.has("no-store");
  let expiresAt = now + defaultTtlMs;

  if (directives.has("no-cache")) {
    expiresAt = now;
  } else {
    const maxAge = directives.get("max-age");
    if (typeof maxAge === "string" && /^\d+$/.test(maxAge)) {
      const seconds = Number(maxAge);
      if (Number.isSafeInteger(seconds)) {
        expiresAt = now + Math.min(seconds * 1000, MAX_HTTP_CACHE_TTL_MS);
      }
    } else {
      const expires = headers?.get("expires")?.trim();
      const parsedExpires = expires ? Date.parse(expires) : Number.NaN;
      if (Number.isFinite(parsedExpires)) {
        expiresAt = Math.max(now, Math.min(parsedExpires, now + MAX_HTTP_CACHE_TTL_MS));
      }
    }
  }

  const etag = normalizeValidator(headers?.get("etag"));
  const lastModified = normalizeHttpDateValidator(headers?.get("last-modified"));
  return {
    cacheable,
    fetchedAt: now,
    expiresAt,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {})
  };
}

function readArtifactCacheEntry(input: {
  rootDir: string;
  url: string;
  maxBytes: number;
  now: number;
  defaultTtlMs: number;
}): ArtifactCacheEntry | undefined {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) {
    return undefined;
  }
  if (!hasValidCacheMarker(input.rootDir)) {
    return undefined;
  }

  const indexPath = cacheIndexPath(input.rootDir, input.url);
  const loaded = readIndexFile(indexPath, cacheUrlKey(input.url), input.now, input.defaultTtlMs);
  if (!loaded) {
    return undefined;
  }
  const index = loaded.index;
  if (index.size > input.maxBytes) {
    return undefined;
  }

  const objectPath = cacheObjectPath(input.rootDir, index.sha256);
  try {
    if (!isRegularFile(objectPath)) {
      removeQuietly(indexPath);
      return undefined;
    }
    const bytes = readFileSync(objectPath);
    if (bytes.byteLength !== index.size) {
      removeQuietly(indexPath);
      return undefined;
    }
    const digest = sha256(bytes);
    if (digest !== index.sha256) {
      removeQuietly(indexPath);
      removeQuietly(objectPath);
      return undefined;
    }

    const touched = updateArtifactCacheIndexUnderCommitLock({
      rootDir: input.rootDir,
      url: input.url,
      now: input.now,
      defaultTtlMs: input.defaultTtlMs,
      expectedSha256: index.sha256,
      update: (current) => ({
        ...current,
        lastAccessedAt: input.now
      })
    }) ?? index;
    return {
      bytes,
      digest,
      fetchedAt: touched.fetchedAt,
      lastAccessedAt: touched.lastAccessedAt,
      expiresAt: touched.expiresAt,
      stale: input.now >= touched.expiresAt,
      ...(touched.etag ? { etag: touched.etag } : {}),
      ...(touched.lastModified ? { lastModified: touched.lastModified } : {})
    };
  } catch {
    removeQuietly(indexPath);
    return undefined;
  }
}

function writeArtifactCacheEntry(input: {
  rootDir: string;
  url: string;
  bytes: Buffer;
  now: number;
  defaultTtlMs: number;
  metadata?: ArtifactCacheWriteMetadata;
}): void {
  const digest = sha256(input.bytes);
  const metadata = normalizeWriteMetadata(input.metadata, input.now, input.defaultTtlMs);
  const index: ArtifactCacheIndexV3 = {
    version: CACHE_FORMAT_VERSION,
    key: cacheUrlKey(input.url),
    sha256: digest,
    size: input.bytes.byteLength,
    fetchedAt: metadata.fetchedAt,
    lastAccessedAt: input.now,
    expiresAt: metadata.expiresAt,
    ...(metadata.etag ? { etag: metadata.etag } : {}),
    ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {})
  };

  try {
    commitArtifactCacheEntry({
      rootDir: input.rootDir,
      url: input.url,
      bytes: input.bytes,
      index,
      now: input.now,
      digest
    });
  } catch {
    // Cache writes are an optimization. A read-only or full cache directory
    // must not turn a successful network scan into a failed scan.
  }
}

export function commitArtifactCacheEntry(input: {
  rootDir: string;
  url: string;
  bytes: Buffer;
  index: ArtifactCacheIndexV3;
  now: number;
  digest: string;
  beforeIndexPublish?: () => void;
}): boolean {
  const objectPath = cacheObjectPath(input.rootDir, input.digest);
  const indexPath = cacheIndexPath(input.rootDir, input.url);
  const objectTempPath = temporaryCachePath(objectPath);
  const indexTempPath = temporaryCachePath(indexPath);
  const lockPath = path.join(input.rootDir, CACHE_MAINTENANCE_LOCK_FILENAME);
  let preparedObjectTemp = false;
  let preparedIndexTemp = false;

  try {
    if (!ensureCacheMarker(input.rootDir)) {
      return false;
    }
    mkdirSync(path.dirname(objectPath), { recursive: true });
    mkdirSync(path.dirname(indexPath), { recursive: true });

    if (!isRegularFile(objectPath)) {
      writeFileSync(objectTempPath, input.bytes, { flag: "wx", mode: 0o600 });
      preparedObjectTemp = true;
    }
    writeFileSync(
      indexTempPath,
      Buffer.from(`${JSON.stringify(input.index)}\n`, "utf8"),
      { flag: "wx", mode: 0o600 }
    );
    preparedIndexTemp = true;

    if (!acquireCacheMaintenanceLock(lockPath, input.now)) {
      return false;
    }

    try {
      if (preparedObjectTemp) {
        publishCacheObject(objectTempPath, objectPath);
      }
      input.beforeIndexPublish?.();
      publishCacheIndex(indexTempPath, indexPath);
      return true;
    } finally {
      removeQuietly(lockPath);
    }
  } finally {
    if (preparedObjectTemp) {
      removeQuietly(objectTempPath);
    }
    if (preparedIndexTemp) {
      removeQuietly(indexTempPath);
    }
  }
}

function withCacheCommitLock<T>(
  rootDir: string,
  now: number,
  action: () => Result<T, OhriskError>
): Result<T, OhriskError> {
  const lockPath = path.join(rootDir, CACHE_MAINTENANCE_LOCK_FILENAME);
  if (!acquireCacheMaintenanceLock(lockPath, now)) {
    return err(
      cacheOperationError(
        "Failed to acquire the artifact cache commit lock.",
        rootDir,
        new Error("cache_commit_lock_unavailable")
      )
    );
  }
  try {
    return action();
  } finally {
    removeQuietly(lockPath);
  }
}

function updateArtifactCacheIndexUnderCommitLock(input: {
  rootDir: string;
  url: string;
  now: number;
  defaultTtlMs: number;
  expectedSha256?: string;
  update: (current: ArtifactCacheIndexV3) => ArtifactCacheIndexV3;
}): ArtifactCacheIndexV3 | undefined {
  const lockPath = path.join(input.rootDir, CACHE_MAINTENANCE_LOCK_FILENAME);
  if (!acquireCacheMaintenanceLock(lockPath, input.now)) {
    return undefined;
  }
  try {
    if (!hasValidCacheMarker(input.rootDir)) {
      return undefined;
    }
    const indexPath = cacheIndexPath(input.rootDir, input.url);
    const loaded = readIndexFile(
      indexPath,
      cacheUrlKey(input.url),
      input.now,
      input.defaultTtlMs
    );
    if (
      !loaded
      || (input.expectedSha256 !== undefined && loaded.index.sha256 !== input.expectedSha256)
    ) {
      return undefined;
    }
    const objectPath = cacheObjectPath(input.rootDir, loaded.index.sha256);
    if (!isRegularFile(objectPath) || statSync(objectPath).size !== loaded.index.size) {
      return undefined;
    }
    const updated = input.update(loaded.index);
    replaceAtomic(indexPath, Buffer.from(`${JSON.stringify(updated)}\n`, "utf8"));
    return updated;
  } catch {
    return undefined;
  } finally {
    removeQuietly(lockPath);
  }
}

function revalidateArtifactCacheEntry(input: {
  rootDir: string;
  url: string;
  now: number;
  defaultTtlMs: number;
  metadata?: ArtifactCacheWriteMetadata;
}): void {
  const metadata = normalizeWriteMetadata(input.metadata, input.now, input.defaultTtlMs);
  updateArtifactCacheIndexUnderCommitLock({
    rootDir: input.rootDir,
    url: input.url,
    now: input.now,
    defaultTtlMs: input.defaultTtlMs,
    update: (current) => ({
      ...current,
      fetchedAt: metadata.fetchedAt,
      lastAccessedAt: input.now,
      expiresAt: metadata.expiresAt,
      ...(metadata.etag
        ? { etag: metadata.etag }
        : current.etag
          ? { etag: current.etag }
          : {}),
      ...(metadata.lastModified
        ? { lastModified: metadata.lastModified }
        : current.lastModified
          ? { lastModified: current.lastModified }
          : {})
    })
  });
}

function removeArtifactCacheEntry(rootDir: string, url: string, now: number): void {
  if (!hasValidCacheMarker(rootDir)) {
    return;
  }
  const indexPath = cacheIndexPath(rootDir, url);
  const loaded = readIndexFile(indexPath, cacheUrlKey(url), now, 0);
  removeQuietly(indexPath);
  if (!loaded) {
    return;
  }
  removeObjectWhenUnreferenced(rootDir, loaded.index.sha256, now);
}

function artifactCacheStatus(
  rootDir: string,
  now: number
): Result<ArtifactCacheStatus, OhriskError> {
  try {
    return ok(statusFromInventory(scanCacheInventory(rootDir, now), now));
  } catch (cause) {
    return err(cacheOperationError("Failed to inspect the artifact cache.", rootDir, cause));
  }
}

function pruneArtifactCache(
  rootDir: string,
  options: ArtifactCachePruneOptions,
  now: number
): Result<ArtifactCachePruneResult, OhriskError> {
  try {
    requireValidCacheMarker(rootDir);
    const inventory = scanCacheInventory(rootDir, now);
    const before = statusFromInventory(inventory, now);
    const maxSizeBytes = normalizeMaxSize(options.maxSizeBytes, Number.MAX_SAFE_INTEGER);
    const maxAgeMs = options.maxAgeMs === undefined
      ? undefined
      : normalizeTtl(options.maxAgeMs, 0);
    const plan = planCachePrune(omitUndefined({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now,
      maxSizeBytes,
      maxAgeMs,
      removeExpired: options.removeExpired
    }));

    const execution = executeCachePrunePlan({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      plan,
      shouldStop: () => false,
      removeEntry: removeQuietly,
      removeObject: (digest) => removeQuietly(cacheObjectPath(rootDir, digest))
    });
    removeEmptyCacheDirectories(rootDir);
    const afterInventory = scanCacheInventory(rootDir, now);
    const after = statusFromInventory(afterInventory, now);
    return ok({
      before,
      after,
      removedEntryCount: Math.max(0, before.entryCount - after.entryCount),
      removedObjectCount: execution.removedObjectCount,
      removedBytes: execution.removedBytes
    });
  } catch (cause) {
    return err(cacheOperationError("Failed to prune the artifact cache.", rootDir, cause));
  }
}

function clearArtifactCache(
  rootDir: string,
  now: number
): Result<ArtifactCacheClearResult, OhriskError> {
  try {
    requireValidCacheMarker(rootDir);
    const before = artifactCacheStatus(rootDir, now);
    if (!before.ok) {
      return err(before.error);
    }
    removeCacheChild(rootDir, "index");
    removeCacheChild(rootDir, "objects");
    return ok({
      removedEntryCount: before.value.entryCount,
      removedObjectCount: before.value.objectCount,
      removedBytes: before.value.totalBytes
    });
  } catch (cause) {
    return err(cacheOperationError("Failed to clear the artifact cache.", rootDir, cause));
  }
}

function scanCacheInventory(
  rootDir: string,
  now: number,
  guard?: CacheMaintenanceGuard,
  mutateInvalid = true
): CacheInventory {
  const objectSizes = new Map<string, number>();
  for (const objectPath of listRegularFiles(path.join(rootDir, "objects", "sha256"), guard)) {
    requireCacheMaintenanceBudget(guard);
    const digest = path.basename(objectPath);
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      continue;
    }
    try {
      objectSizes.set(digest, statSync(objectPath).size);
    } catch {
      // A concurrent cache writer or pruner may have removed the object.
    }
  }

  const entries: CacheIndexRecord[] = [];
  let corruptEntryCount = 0;
  for (const indexPath of listRegularFiles(path.join(rootDir, "index"), guard)) {
    requireCacheMaintenanceBudget(guard);
    const loaded = readIndexFile(
      indexPath,
      undefined,
      now,
      DEFAULT_ARTIFACT_CACHE_TTL_MS,
      mutateInvalid
    );
    if (!loaded) {
      corruptEntryCount += 1;
      continue;
    }
    const expectedFilename = `${loaded.index.key}.json`;
    if (path.basename(indexPath) !== expectedFilename) {
      corruptEntryCount += 1;
      if (mutateInvalid) removeQuietly(indexPath);
      continue;
    }
    const objectSize = objectSizes.get(loaded.index.sha256);
    if (objectSize === undefined || objectSize !== loaded.index.size) {
      corruptEntryCount += 1;
      if (mutateInvalid) removeQuietly(indexPath);
      continue;
    }
    entries.push({ path: indexPath, index: loaded.index });
  }
  return { entries, objectSizes, corruptEntryCount };
}

export function statusFromInventory(inventory: CacheInventory, now: number): ArtifactCacheStatus {
  const referencedDigests = new Set<string>();
  let staleEntryCount = 0;
  let oldestAccessedAt: number | undefined;
  let newestAccessedAt: number | undefined;

  for (const entry of inventory.entries) {
    referencedDigests.add(entry.index.sha256);
    if (entry.index.expiresAt <= now) {
      staleEntryCount += 1;
    }
    if (oldestAccessedAt === undefined || entry.index.lastAccessedAt < oldestAccessedAt) {
      oldestAccessedAt = entry.index.lastAccessedAt;
    }
    if (newestAccessedAt === undefined || entry.index.lastAccessedAt > newestAccessedAt) {
      newestAccessedAt = entry.index.lastAccessedAt;
    }
  }

  let totalBytes = 0;
  let orphanObjectCount = 0;
  let orphanBytes = 0;
  for (const [digest, size] of inventory.objectSizes) {
    totalBytes += size;
    if (!referencedDigests.has(digest)) {
      orphanObjectCount += 1;
      orphanBytes += size;
    }
  }

  return {
    entryCount: inventory.entries.length,
    objectCount: inventory.objectSizes.size,
    totalBytes,
    orphanObjectCount,
    orphanBytes,
    staleEntryCount,
    corruptEntryCount: inventory.corruptEntryCount,
    ...(oldestAccessedAt !== undefined ? { oldestAccessedAt } : {}),
    ...(newestAccessedAt !== undefined ? { newestAccessedAt } : {})
  };
}

function removeObjectWhenUnreferenced(rootDir: string, digest: string, now: number): void {
  const referenced = listRegularFiles(path.join(rootDir, "index")).some((indexPath) => {
    const loaded = readIndexFile(indexPath, undefined, now, DEFAULT_ARTIFACT_CACHE_TTL_MS);
    return loaded?.index.sha256 === digest;
  });
  if (!referenced) {
    removeQuietly(cacheObjectPath(rootDir, digest));
  }
}

function readIndexFile(
  indexPath: string,
  expectedKey: string | undefined,
  now: number,
  defaultTtlMs: number,
  mutate = true
): { index: ArtifactCacheIndexV3; migrated: boolean } | undefined {
  if (!isRegularFile(indexPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(indexPath);
    if (raw.byteLength > CACHE_INDEX_MAX_BYTES) {
      if (mutate) removeQuietly(indexPath);
      return undefined;
    }
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!isArtifactCacheIndex(parsed, expectedKey)) {
      if (mutate) removeQuietly(indexPath);
      return undefined;
    }

    if (parsed.version === CACHE_FORMAT_VERSION) {
      return { index: parsed, migrated: false };
    }

    const mtime = Math.trunc(statSync(indexPath).mtimeMs);
    const migrated: ArtifactCacheIndexV3 = {
      ...parsed,
      version: CACHE_FORMAT_VERSION,
      fetchedAt: mtime,
      lastAccessedAt: now,
      expiresAt: Math.min(now, mtime + defaultTtlMs)
    };
    if (mutate) {
      replaceAtomicBestEffort(indexPath, Buffer.from(`${JSON.stringify(migrated)}\n`, "utf8"));
    }
    return { index: migrated, migrated: true };
  } catch {
    if (mutate) removeQuietly(indexPath);
    return undefined;
  }
}

function isArtifactCacheIndex(
  value: unknown,
  expectedKey: string | undefined
): value is ArtifactCacheIndex {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.version !== CACHE_FORMAT_VERSION && record.version !== LEGACY_CACHE_FORMAT_VERSION)
    || typeof record.key !== "string"
    || !/^[a-f0-9]{64}$/.test(record.key)
    || (expectedKey !== undefined && record.key !== expectedKey)
    || typeof record.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.sha256)
    || !isNonNegativeSafeInteger(record.size)
  ) {
    return false;
  }

  if (record.version === LEGACY_CACHE_FORMAT_VERSION) {
    return true;
  }

  return isNonNegativeSafeInteger(record.fetchedAt)
    && isNonNegativeSafeInteger(record.lastAccessedAt)
    && isNonNegativeSafeInteger(record.expiresAt)
    && isOptionalValidator(record.etag)
    && isOptionalValidator(record.lastModified);
}

function normalizeWriteMetadata(
  metadata: ArtifactCacheWriteMetadata | undefined,
  now: number,
  defaultTtlMs: number
): Required<Pick<ArtifactCacheIndexV3, "fetchedAt" | "expiresAt">> & ArtifactCacheValidators {
  const fetchedAt = isNonNegativeSafeInteger(metadata?.fetchedAt)
    ? metadata.fetchedAt
    : now;
  const expiresAt = isNonNegativeSafeInteger(metadata?.expiresAt)
    ? metadata.expiresAt
    : fetchedAt + defaultTtlMs;
  const etag = normalizeValidator(metadata?.etag);
  const lastModified = normalizeHttpDateValidator(metadata?.lastModified);
  return {
    fetchedAt,
    expiresAt,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {})
  };
}

function parseCacheControl(value: string): Map<string, string | true> {
  const directives = new Map<string, string | true>();
  for (const item of value.split(",")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    const name = rawName?.trim().toLowerCase();
    if (!name) {
      continue;
    }
    const joined = rawValue.join("=").trim().replace(/^"|"$/g, "");
    directives.set(name, joined === "" ? true : joined);
  }
  return directives;
}

function normalizeValidator(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (
    !normalized
    || normalized.length > MAX_VALIDATOR_LENGTH
    || normalized.includes("\r")
    || normalized.includes("\n")
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeHttpDateValidator(value: string | null | undefined): string | undefined {
  const normalized = normalizeValidator(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function isOptionalValidator(value: unknown): boolean {
  return value === undefined || (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAX_VALIDATOR_LENGTH
    && !value.includes("\r")
    && !value.includes("\n")
  );
}

function normalizeTtl(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : fallback;
}

function normalizeMaxSize(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value! : fallback;
}

function normalizeMaintenanceBudget(value: number | undefined): number {
  if (value === undefined) {
    return CACHE_MAINTENANCE_BUDGET_MS;
  }
  if (!Number.isFinite(value) || value < 0) {
    return CACHE_MAINTENANCE_BUDGET_MS;
  }
  return Math.min(10_000, value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function publishCacheObject(temporaryPath: string, objectPath: string): void {
  try {
    renameSync(temporaryPath, objectPath);
  } catch {
    if (!isRegularFile(objectPath)) {
      throw new Error("Could not atomically publish cache object.");
    }
  }
}

function publishCacheIndex(temporaryPath: string, indexPath: string): void {
  renameSync(temporaryPath, indexPath);
}

function replaceAtomic(filePath: string, bytes: Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryCachePath(filePath);
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, filePath);
  } finally {
    removeQuietly(temporaryPath);
  }
}

function replaceAtomicBestEffort(filePath: string, bytes: Buffer): void {
  try {
    replaceAtomic(filePath, bytes);
  } catch {
    // Access metadata is advisory; cache integrity remains content-addressed.
  }
}

function temporaryCachePath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomSuffix()}.tmp`;
}

function cacheIndexPath(rootDir: string, url: string): string {
  const key = cacheUrlKey(url);
  return path.join(rootDir, "index", key.slice(0, 2), `${key}.json`);
}

function cacheUrlKey(url: string): string {
  return sha256(Buffer.from(url, "utf8"));
}

function cacheObjectPath(rootDir: string, digest: string): string {
  return path.join(rootDir, "objects", "sha256", digest.slice(0, 2), digest);
}

function ensureCacheMarker(rootDir: string): boolean {
  try {
    const rootExisted = existsSync(rootDir);
    mkdirSync(rootDir, { recursive: true });
    const markerPath = path.join(rootDir, CACHE_MARKER_FILENAME);
    if (existsSync(markerPath)) {
      requireValidCacheMarker(rootDir);
    } else {
      if (rootExisted && readdirSync(rootDir).length > 0) {
        throw new Error("Artifact cache directory is not empty and has no ownership marker.");
      }
      writeFileSync(markerPath, CACHE_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
    }
    return true;
  } catch {
    // Cache initialization is an optimization during scans.
    return false;
  }
}

function hasValidCacheMarker(rootDir: string): boolean {
  try {
    requireValidCacheMarker(rootDir);
    return true;
  } catch {
    return false;
  }
}

function requireValidCacheMarker(rootDir: string): void {
  const markerPath = path.join(rootDir, CACHE_MARKER_FILENAME);
  if (!lstatSync(markerPath).isFile()) {
    throw new Error("Artifact cache ownership marker is not a regular file.");
  }
  if (readFileSync(markerPath, "utf8") !== CACHE_MARKER_CONTENT) {
    throw new Error("Artifact cache ownership marker does not match this cache format.");
  }
}

function removeCacheChild(rootDir: string, childName: string): void {
  const childPath = path.join(path.resolve(rootDir), childName);
  const relative = path.relative(path.resolve(rootDir), childPath);
  if (relative !== childName || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe cache child path.");
  }
  rmSync(childPath, { force: true, recursive: true });
}

function listRegularFiles(rootDir: string, guard?: CacheMaintenanceGuard): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    requireCacheMaintenanceBudget(guard);
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      requireCacheMaintenanceBudget(guard);
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        files.push(entryPath);
      } else if (entry.isDirectory()) {
        visit(entryPath);
      }
    }
  };
  visit(rootDir);
  return files;
}

function removeEmptyCacheDirectories(rootDir: string): void {
  for (const topLevel of [path.join(rootDir, "index"), path.join(rootDir, "objects")]) {
    removeEmptyDirectories(topLevel, false);
  }
}

function removeEmptyDirectories(directory: string, removeSelf: boolean): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(path.join(directory, entry.name), true);
    }
  }
  try {
    if (removeSelf && readdirSync(directory).length === 0) {
      rmSync(directory, { force: true });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function isRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function removeQuietly(filePath: string): boolean {
  try {
    rmSync(filePath, { force: true });
    return !existsSync(filePath);
  } catch {
    // Best-effort cleanup only.
    return false;
  }
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2);
}

function cacheOperationError(message: string, rootDir: string, cause: unknown): OhriskError {
  return createError({
    code: "CACHE_OPERATION_FAILED",
    category: "filesystem",
    message,
    details: {
      cacheDir: rootDir,
      cause: cause instanceof Error ? cause.message : String(cause)
    }
  });
}
