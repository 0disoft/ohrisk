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

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const CACHE_FORMAT_VERSION = 3;
const LEGACY_CACHE_FORMAT_VERSION = 2;
const CACHE_INDEX_MAX_BYTES = 32 * 1024;
const CACHE_MARKER_FILENAME = ".ohrisk-artifact-cache";
const CACHE_MARKER_CONTENT = "ohrisk artifact cache v3\n";
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
  status: () => Result<ArtifactCacheStatus, OhriskError>;
  prune: (options?: ArtifactCachePruneOptions) => Result<ArtifactCachePruneResult, OhriskError>;
  clear: () => Result<ArtifactCacheClearResult, OhriskError>;
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

type CacheIndexRecord = {
  path: string;
  index: ArtifactCacheIndexV3;
};

type CacheInventory = {
  entries: CacheIndexRecord[];
  objectSizes: Map<string, number>;
  corruptEntryCount: number;
};

type ArtifactCacheOptions = {
  now?: () => number;
  defaultTtlMs?: number;
  maxSizeBytes?: number;
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
  const resolvedRoot = path.resolve(rootDir);
  const now = options.now ?? Date.now;
  const defaultTtlMs = normalizeTtl(options.defaultTtlMs, DEFAULT_ARTIFACT_CACHE_TTL_MS);
  const maxSizeBytes = normalizeMaxSize(
    options.maxSizeBytes,
    DEFAULT_ARTIFACT_CACHE_MAX_BYTES
  );
  ensureCacheMarker(resolvedRoot);

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
      writeArtifactCacheEntry({
        rootDir: resolvedRoot,
        url,
        bytes,
        now: now(),
        defaultTtlMs,
        metadata
      });
      void pruneArtifactCache(resolvedRoot, {
        maxSizeBytes,
        removeExpired: false
      }, now());
    },
    revalidate: (url, metadata) => revalidateArtifactCacheEntry({
      rootDir: resolvedRoot,
      url,
      now: now(),
      defaultTtlMs,
      metadata
    }),
    remove: (url) => removeArtifactCacheEntry(resolvedRoot, url, now()),
    status: () => artifactCacheStatus(resolvedRoot, now()),
    prune: (pruneOptions = {}) => pruneArtifactCache(
      resolvedRoot,
      pruneOptions,
      now()
    ),
    clear: () => clearArtifactCache(resolvedRoot, now())
  };
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

    const touched: ArtifactCacheIndexV3 = {
      ...index,
      lastAccessedAt: input.now
    };
    replaceAtomicBestEffort(indexPath, Buffer.from(`${JSON.stringify(touched)}\n`, "utf8"));
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
  const objectPath = cacheObjectPath(input.rootDir, digest);
  const indexPath = cacheIndexPath(input.rootDir, input.url);
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
    ensureCacheMarker(input.rootDir);
    writeIfAbsent(objectPath, input.bytes);
    replaceAtomic(indexPath, Buffer.from(`${JSON.stringify(index)}\n`, "utf8"));
  } catch {
    // Cache writes are an optimization. A read-only or full cache directory
    // must not turn a successful network scan into a failed scan.
  }
}

function revalidateArtifactCacheEntry(input: {
  rootDir: string;
  url: string;
  now: number;
  defaultTtlMs: number;
  metadata?: ArtifactCacheWriteMetadata;
}): void {
  const indexPath = cacheIndexPath(input.rootDir, input.url);
  const loaded = readIndexFile(
    indexPath,
    cacheUrlKey(input.url),
    input.now,
    input.defaultTtlMs
  );
  if (!loaded) {
    return;
  }

  const metadata = normalizeWriteMetadata(input.metadata, input.now, input.defaultTtlMs);
  const updated: ArtifactCacheIndexV3 = {
    ...loaded.index,
    fetchedAt: metadata.fetchedAt,
    lastAccessedAt: input.now,
    expiresAt: metadata.expiresAt,
    ...(metadata.etag
      ? { etag: metadata.etag }
      : loaded.index.etag
        ? { etag: loaded.index.etag }
        : {}),
    ...(metadata.lastModified
      ? { lastModified: metadata.lastModified }
      : loaded.index.lastModified
        ? { lastModified: loaded.index.lastModified }
        : {})
  };
  replaceAtomicBestEffort(indexPath, Buffer.from(`${JSON.stringify(updated)}\n`, "utf8"));
}

function removeArtifactCacheEntry(rootDir: string, url: string, now: number): void {
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
    const inventory = scanCacheInventory(rootDir, now);
    const before = statusFromInventory(inventory, now);
    const maxSizeBytes = normalizeMaxSize(options.maxSizeBytes, Number.MAX_SAFE_INTEGER);
    const maxAgeMs = options.maxAgeMs === undefined
      ? undefined
      : normalizeTtl(options.maxAgeMs, 0);
    const removeExpired = options.removeExpired ?? true;
    const entriesToRemove = new Set<string>();

    for (const entry of inventory.entries) {
      if (
        (removeExpired && entry.index.expiresAt <= now)
        || (maxAgeMs !== undefined && now - entry.index.lastAccessedAt >= maxAgeMs)
      ) {
        entriesToRemove.add(entry.path);
      }
    }

    const remainingEntries = inventory.entries
      .filter((entry) => !entriesToRemove.has(entry.path))
      .sort((left, right) =>
        left.index.lastAccessedAt - right.index.lastAccessedAt
        || left.path.localeCompare(right.path)
      );
    let remainingBytes = uniqueReferencedBytes(remainingEntries, inventory.objectSizes);
    for (const entry of remainingEntries) {
      if (remainingBytes <= maxSizeBytes) {
        break;
      }
      entriesToRemove.add(entry.path);
      const stillReferenced = remainingEntries.some((candidate) =>
        candidate.path !== entry.path
        && !entriesToRemove.has(candidate.path)
        && candidate.index.sha256 === entry.index.sha256
      );
      if (!stillReferenced) {
        remainingBytes -= inventory.objectSizes.get(entry.index.sha256) ?? entry.index.size;
      }
    }

    for (const indexPath of entriesToRemove) {
      removeQuietly(indexPath);
    }
    const objectCleanup = removeOrphanedObjects(rootDir, now);
    removeEmptyCacheDirectories(rootDir);
    const afterInventory = scanCacheInventory(rootDir, now);
    const after = statusFromInventory(afterInventory, now);
    return ok({
      before,
      after,
      removedEntryCount: Math.max(0, before.entryCount - after.entryCount),
      removedObjectCount: objectCleanup.removedObjectCount,
      removedBytes: objectCleanup.removedBytes
    });
  } catch (cause) {
    return err(cacheOperationError("Failed to prune the artifact cache.", rootDir, cause));
  }
}

function clearArtifactCache(
  rootDir: string,
  now: number
): Result<ArtifactCacheClearResult, OhriskError> {
  const before = artifactCacheStatus(rootDir, now);
  if (!before.ok) {
    return err(before.error);
  }

  try {
    removeCacheChild(rootDir, "index");
    removeCacheChild(rootDir, "objects");
    removeCacheChild(rootDir, CACHE_MARKER_FILENAME);
    ensureCacheMarker(rootDir);
    return ok({
      removedEntryCount: before.value.entryCount,
      removedObjectCount: before.value.objectCount,
      removedBytes: before.value.totalBytes
    });
  } catch (cause) {
    return err(cacheOperationError("Failed to clear the artifact cache.", rootDir, cause));
  }
}

function scanCacheInventory(rootDir: string, now: number): CacheInventory {
  const objectSizes = new Map<string, number>();
  for (const objectPath of listRegularFiles(path.join(rootDir, "objects", "sha256"))) {
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
  for (const indexPath of listRegularFiles(path.join(rootDir, "index"))) {
    const loaded = readIndexFile(indexPath, undefined, now, DEFAULT_ARTIFACT_CACHE_TTL_MS);
    if (!loaded) {
      corruptEntryCount += 1;
      continue;
    }
    const expectedFilename = `${loaded.index.key}.json`;
    if (path.basename(indexPath) !== expectedFilename) {
      corruptEntryCount += 1;
      removeQuietly(indexPath);
      continue;
    }
    const objectSize = objectSizes.get(loaded.index.sha256);
    if (objectSize === undefined || objectSize !== loaded.index.size) {
      corruptEntryCount += 1;
      removeQuietly(indexPath);
      continue;
    }
    entries.push({ path: indexPath, index: loaded.index });
  }
  return { entries, objectSizes, corruptEntryCount };
}

function statusFromInventory(inventory: CacheInventory, now: number): ArtifactCacheStatus {
  const referencedDigests = new Set(inventory.entries.map((entry) => entry.index.sha256));
  const orphanDigests = [...inventory.objectSizes.keys()].filter(
    (digest) => !referencedDigests.has(digest)
  );
  const accessedAt = inventory.entries.map((entry) => entry.index.lastAccessedAt);
  return {
    entryCount: inventory.entries.length,
    objectCount: inventory.objectSizes.size,
    totalBytes: [...inventory.objectSizes.values()].reduce((total, size) => total + size, 0),
    orphanObjectCount: orphanDigests.length,
    orphanBytes: orphanDigests.reduce(
      (total, digest) => total + (inventory.objectSizes.get(digest) ?? 0),
      0
    ),
    staleEntryCount: inventory.entries.filter((entry) => entry.index.expiresAt <= now).length,
    corruptEntryCount: inventory.corruptEntryCount,
    ...(accessedAt.length > 0 ? { oldestAccessedAt: Math.min(...accessedAt) } : {}),
    ...(accessedAt.length > 0 ? { newestAccessedAt: Math.max(...accessedAt) } : {})
  };
}

function removeOrphanedObjects(rootDir: string, now: number): {
  removedObjectCount: number;
  removedBytes: number;
} {
  const inventory = scanCacheInventory(rootDir, now);
  const referencedDigests = new Set(inventory.entries.map((entry) => entry.index.sha256));
  let removedObjectCount = 0;
  let removedBytes = 0;

  for (const objectPath of listRegularFiles(path.join(rootDir, "objects", "sha256"))) {
    const digest = path.basename(objectPath);
    if (referencedDigests.has(digest)) {
      continue;
    }
    try {
      const size = statSync(objectPath).size;
      rmSync(objectPath, { force: true });
      removedObjectCount += 1;
      removedBytes += size;
    } catch {
      // Best-effort cleanup in the face of concurrent cache activity.
    }
  }
  return { removedObjectCount, removedBytes };
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

function uniqueReferencedBytes(
  entries: CacheIndexRecord[],
  objectSizes: ReadonlyMap<string, number>
): number {
  const digests = new Set(entries.map((entry) => entry.index.sha256));
  return [...digests].reduce(
    (total, digest) => total + (objectSizes.get(digest) ?? 0),
    0
  );
}

function readIndexFile(
  indexPath: string,
  expectedKey: string | undefined,
  now: number,
  defaultTtlMs: number
): { index: ArtifactCacheIndexV3; migrated: boolean } | undefined {
  if (!isRegularFile(indexPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(indexPath);
    if (raw.byteLength > CACHE_INDEX_MAX_BYTES) {
      removeQuietly(indexPath);
      return undefined;
    }
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!isArtifactCacheIndex(parsed, expectedKey)) {
      removeQuietly(indexPath);
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
    replaceAtomicBestEffort(indexPath, Buffer.from(`${JSON.stringify(migrated)}\n`, "utf8"));
    return { index: migrated, migrated: true };
  } catch {
    removeQuietly(indexPath);
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function writeIfAbsent(filePath: string, bytes: Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (isRegularFile(filePath)) {
    return;
  }

  const temporaryPath = temporaryCachePath(filePath);
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    try {
      renameSync(temporaryPath, filePath);
    } catch {
      if (!isRegularFile(filePath)) {
        throw new Error("Could not atomically publish cache object.");
      }
    }
  } finally {
    removeQuietly(temporaryPath);
  }
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

function ensureCacheMarker(rootDir: string): void {
  try {
    mkdirSync(rootDir, { recursive: true });
    const markerPath = path.join(rootDir, CACHE_MARKER_FILENAME);
    if (!existsSync(markerPath)) {
      writeFileSync(markerPath, CACHE_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
    }
  } catch {
    // Cache initialization is an optimization during scans.
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

function listRegularFiles(rootDir: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
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

function removeQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Best-effort cleanup only.
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
