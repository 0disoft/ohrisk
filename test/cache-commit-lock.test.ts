import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commitArtifactCacheEntry,
  createArtifactCache
} from "../src/evidence/cache";
import type { OhriskError } from "../src/shared/errors";
import type { Result } from "../src/shared/result";

const MAINTENANCE_LOCK_FILENAME = ".ohrisk-artifact-cache-maintenance.lock";
const LOCK_STALE_MS = 10 * 60 * 1000;

describe("cache commit lock", () => {
  test("fails closed when prune runs between object and index publish", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-lock-"));
    try {
      const cache = createArtifactCache(root, {
        now: () => 1_000,
        defaultTtlMs: 10_000
      });
      const url = "https://registry.example.com/atomic.tgz";
      const bytes = Buffer.from("atomic payload");

      let pruneResult: Result<unknown, OhriskError> | undefined;
      const committed = commitArtifactCacheEntry({
        rootDir: root,
        url,
        bytes,
        index: cacheIndexFor(url, bytes, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytes),
        beforeIndexPublish: () => {
          pruneResult = cache.prune({ maxSizeBytes: 0 });
        }
      });

      expect(committed).toBe(true);
      expect(pruneResult?.ok).toBe(false);
      if (pruneResult?.ok) {
        throw new Error("Expected prune to fail closed during a writer commit.");
      }
      expect(pruneResult?.error.code).toBe("CACHE_OPERATION_FAILED");

      const status = cache.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }
      expect(status.value).toMatchObject({
        entryCount: 1,
        objectCount: 1,
        corruptEntryCount: 0
      });
      expect(cache.read(url, 4096)?.bytes.toString()).toBe("atomic payload");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks clear and prune while a writer commit holds the lock", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-clear-"));
    try {
      const cache = createArtifactCache(root, {
        now: () => 1_000,
        defaultTtlMs: 10_000
      });
      const url = "https://registry.example.com/blocked.tgz";
      const bytes = Buffer.from("blocked payload");

      let pruneResult: Result<unknown, OhriskError> | undefined;
      let clearResult: Result<unknown, OhriskError> | undefined;
      const committed = commitArtifactCacheEntry({
        rootDir: root,
        url,
        bytes,
        index: cacheIndexFor(url, bytes, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytes),
        beforeIndexPublish: () => {
          pruneResult = cache.prune({ maxSizeBytes: 0 });
          clearResult = cache.clear();
        }
      });

      expect(committed).toBe(true);
      expect(pruneResult?.ok).toBe(false);
      expect(clearResult?.ok).toBe(false);
      if (pruneResult?.ok || clearResult?.ok) {
        throw new Error("Expected prune and clear to fail closed during a writer commit.");
      }
      expect(pruneResult?.error.code).toBe("CACHE_OPERATION_FAILED");
      expect(clearResult?.error.code).toBe("CACHE_OPERATION_FAILED");

      const status = cache.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }
      expect(status.value).toMatchObject({ entryCount: 1, corruptEntryCount: 0 });
      expect(cache.read(url, 4096)?.bytes.toString()).toBe("blocked payload");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps one object when same-digest writers commit alongside prune", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-same-digest-"));
    try {
      const cache = createArtifactCache(root, {
        now: () => 1_000,
        defaultTtlMs: 10_000
      });
      const urlA = "https://registry.example.com/a.tgz";
      const urlB = "https://registry.example.com/b.tgz";
      const bytes = Buffer.from("shared content");

      let nestedCommit: boolean | undefined;
      const committedA = commitArtifactCacheEntry({
        rootDir: root,
        url: urlA,
        bytes,
        index: cacheIndexFor(urlA, bytes, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytes),
        beforeIndexPublish: () => {
          nestedCommit = commitArtifactCacheEntry({
            rootDir: root,
            url: urlB,
            bytes,
            index: cacheIndexFor(urlB, bytes, 1_000, 11_000),
            now: 1_000,
            digest: sha256(bytes)
          });
        }
      });

      expect(committedA).toBe(true);
      expect(nestedCommit).toBe(false);

      const committedB = commitArtifactCacheEntry({
        rootDir: root,
        url: urlB,
        bytes,
        index: cacheIndexFor(urlB, bytes, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytes)
      });
      expect(committedB).toBe(true);

      const status = cache.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }
      expect(status.value).toMatchObject({
        entryCount: 2,
        objectCount: 1,
        corruptEntryCount: 0
      });
      expect(cache.read(urlA, 4096)?.bytes.toString()).toBe("shared content");
      expect(cache.read(urlB, 4096)?.bytes.toString()).toBe("shared content");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps both objects when different-digest writers commit alongside prune", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-diff-digest-"));
    try {
      const cache = createArtifactCache(root, {
        now: () => 1_000,
        defaultTtlMs: 10_000
      });
      const urlA = "https://registry.example.com/a.tgz";
      const urlB = "https://registry.example.com/b.tgz";
      const bytesA = Buffer.from("payload a");
      const bytesB = Buffer.from("payload b");

      let pruneResult: Result<unknown, OhriskError> | undefined;
      const committedA = commitArtifactCacheEntry({
        rootDir: root,
        url: urlA,
        bytes: bytesA,
        index: cacheIndexFor(urlA, bytesA, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytesA),
        beforeIndexPublish: () => {
          pruneResult = cache.prune({ maxSizeBytes: 0 });
        }
      });
      const committedB = commitArtifactCacheEntry({
        rootDir: root,
        url: urlB,
        bytes: bytesB,
        index: cacheIndexFor(urlB, bytesB, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytesB)
      });

      expect(committedA).toBe(true);
      expect(committedB).toBe(true);
      expect(pruneResult?.ok).toBe(false);
      if (pruneResult?.ok) {
        throw new Error("Expected prune to fail closed during a writer commit.");
      }

      const status = cache.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }
      expect(status.value).toMatchObject({
        entryCount: 2,
        objectCount: 2,
        corruptEntryCount: 0
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("releases the lock and leaves a recoverable orphan when commit fails before index", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-crash-"));
    try {
      const cache = createArtifactCache(root, {
        now: () => 1_000,
        defaultTtlMs: 10_000
      });
      const url = "https://registry.example.com/crash.tgz";
      const bytes = Buffer.from("crash payload");
      const indexPath = path.join(root, "index", urlKey(url).slice(0, 2), `${urlKey(url)}.json`);
      const objectPath = path.join(root, "objects", "sha256", sha256(bytes).slice(0, 2), sha256(bytes));
      const lockPath = path.join(root, MAINTENANCE_LOCK_FILENAME);

      expect(() => commitArtifactCacheEntry({
        rootDir: root,
        url,
        bytes,
        index: cacheIndexFor(url, bytes, 1_000, 11_000),
        now: 1_000,
        digest: sha256(bytes),
        beforeIndexPublish: () => {
          throw new Error("simulated writer crash");
        }
      })).toThrow("simulated writer crash");

      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(objectPath)).toBe(true);
      expect(existsSync(indexPath)).toBe(false);

      const pruned = cache.prune({ maxSizeBytes: 0 });
      expect(pruned.ok).toBe(true);
      if (!pruned.ok) {
        throw new Error(pruned.error.message);
      }
      const status = cache.status();
      expect(status.ok).toBe(true);
      if (!status.ok) {
        throw new Error(status.error.message);
      }
      expect(status.value).toMatchObject({
        entryCount: 0,
        objectCount: 0,
        corruptEntryCount: 0
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves no side effects when a writer fails before the lock", () => {
    const fileRoot = path.join(tmpdir(), "ohrisk-cache-commit-fail-before-lock");
    const lockPath = path.join(fileRoot, MAINTENANCE_LOCK_FILENAME);
    try {
      writeFileSync(fileRoot, "not a directory", "utf8");
      const committed = commitArtifactCacheEntry({
        rootDir: fileRoot,
        url: "https://registry.example.com/x.tgz",
        bytes: Buffer.from("x"),
        index: cacheIndexFor("https://registry.example.com/x.tgz", Buffer.from("x"), 1_000, 2_000),
        now: 1_000,
        digest: sha256(Buffer.from("x"))
      });

      expect(committed).toBe(false);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(fileRoot, { force: true });
    }
  });

  test("rejects prune with a fresh lock and recovers a stale lock", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-commit-stale-"));
    try {
      const cache = createArtifactCache(root);
      cache.write("https://registry.example.com/stale.tgz", Buffer.from("stale"));
      const lockPath = path.join(root, MAINTENANCE_LOCK_FILENAME);

      writeFileSync(lockPath, "1234\n", "utf8");
      const blocked = cache.prune({ maxSizeBytes: 0 });
      expect(blocked.ok).toBe(false);
      if (blocked.ok) {
        throw new Error("Expected a fresh lock to fail prune closed.");
      }
      expect(blocked.error.code).toBe("CACHE_OPERATION_FAILED");
      expect(existsSync(lockPath)).toBe(true);

      utimesSync(lockPath, new Date(Date.now() - LOCK_STALE_MS - 1_000), new Date(Date.now() - LOCK_STALE_MS - 1_000));
      const recovered = cache.prune({ maxSizeBytes: 0 });
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) {
        throw new Error(recovered.error.message);
      }
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps reader touches and revalidation behind the commit lock", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-read-lock-"));
    try {
      let now = 1_000;
      const cache = createArtifactCache(root, {
        now: () => now,
        defaultTtlMs: 10_000
      });
      const url = "https://registry.example.com/read-lock.tgz";
      const indexPath = path.join(root, "index", urlKey(url).slice(0, 2), `${urlKey(url)}.json`);
      const lockPath = path.join(root, MAINTENANCE_LOCK_FILENAME);
      cache.write(url, Buffer.from("cached payload"));

      writeFileSync(lockPath, "other-process\n", "utf8");
      now = 2_000;
      expect(cache.read(url, 4096)?.bytes.toString()).toBe("cached payload");
      cache.revalidate(url, { expiresAt: 30_000, etag: '"updated"' });

      expect(readCacheIndex(indexPath)).toMatchObject({
        lastAccessedAt: 1_000,
        expiresAt: 11_000
      });

      rmSync(lockPath, { force: true });
      now = 3_000;
      expect(cache.read(url, 4096)?.bytes.toString()).toBe("cached payload");
      expect(readCacheIndex(indexPath)).toMatchObject({ lastAccessedAt: 3_000 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function cacheIndexFor(
  url: string,
  bytes: Buffer,
  fetchedAt: number,
  expiresAt: number
): {
  version: 3;
  key: string;
  sha256: string;
  size: number;
  fetchedAt: number;
  lastAccessedAt: number;
  expiresAt: number;
} {
  const digest = sha256(bytes);
  return {
    version: 3,
    key: urlKey(url),
    sha256: digest,
    size: bytes.byteLength,
    fetchedAt,
    lastAccessedAt: fetchedAt,
    expiresAt
  };
}

function urlKey(url: string): string {
  return sha256(Buffer.from(url, "utf8"));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readCacheIndex(indexPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(indexPath, "utf8")) as Record<string, unknown>;
}
