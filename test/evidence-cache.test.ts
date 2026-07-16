import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  artifactCacheMetadataFromHeaders,
  createArtifactCache,
  defaultArtifactCacheDirectory,
  openArtifactCacheForManagement
} from "../src/evidence/cache";

describe("persistent artifact cache", () => {
  test("stores content-addressed bytes and rejects entries above a caller limit", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-"));
    try {
      const cache = createArtifactCache(root);
      const url = "https://registry.example.com/package.tgz";
      cache.write(url, Buffer.from("artifact bytes"));

      expect(cache.read(url, 1024)?.bytes.toString("utf8")).toBe("artifact bytes");
      expect(cache.read(url, 4)).toBeUndefined();
      expect(cache.read("https://registry.example.com/missing.tgz", 1024)).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("tracks freshness and preserves validators across a 304-style revalidation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-freshness-"));
    let now = 1_000;
    try {
      const cache = createArtifactCache(root, {
        now: () => now,
        defaultTtlMs: 100
      });
      const url = "https://registry.example.com/freshness.tgz";
      cache.write(url, Buffer.from("artifact"), {
        etag: '"v1"',
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT"
      });

      expect(cache.read(url, 1024)).toMatchObject({
        stale: false,
        fetchedAt: 1_000,
        expiresAt: 1_100,
        etag: '"v1"',
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT"
      });

      now = 1_100;
      expect(cache.read(url, 1024)?.stale).toBe(true);
      cache.revalidate(url, { fetchedAt: now, expiresAt: 2_000 });

      expect(cache.read(url, 1024)).toMatchObject({
        stale: false,
        fetchedAt: 1_100,
        expiresAt: 2_000,
        etag: '"v1"',
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT"
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("derives bounded freshness and safe validators from HTTP response headers", () => {
    const headers = headersFrom({
      "cache-control": "public, max-age=60",
      etag: 'W/"v2"',
      "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT"
    });

    expect(artifactCacheMetadataFromHeaders(headers, { now: 5_000 })).toEqual({
      cacheable: true,
      fetchedAt: 5_000,
      expiresAt: 65_000,
      etag: 'W/"v2"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT"
    });
    expect(artifactCacheMetadataFromHeaders(
      headersFrom({ "cache-control": "no-cache" }),
      { now: 5_000, defaultTtlMs: 10_000 }
    )).toMatchObject({ cacheable: true, expiresAt: 5_000 });
    expect(artifactCacheMetadataFromHeaders(
      headersFrom({
        "cache-control": "no-store",
        etag: '"unsafe\r\nheader"',
        "last-modified": "not-a-date"
      }),
      { now: 5_000 }
    )).toEqual({
      cacheable: false,
      fetchedAt: 5_000,
      expiresAt: 5_000 + (24 * 60 * 60 * 1_000)
    });
  });

  test("migrates v2 indexes lazily and marks them stale for revalidation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-v2-"));
    const url = "https://registry.example.com/legacy.tgz";
    const bytes = Buffer.from("legacy artifact");
    const key = sha256(Buffer.from(url, "utf8"));
    const digest = sha256(bytes);
    const indexPath = path.join(root, "index", key.slice(0, 2), `${key}.json`);
    const objectPath = path.join(root, "objects", "sha256", digest.slice(0, 2), digest);

    try {
      mkdirSync(path.dirname(indexPath), { recursive: true });
      mkdirSync(path.dirname(objectPath), { recursive: true });
      writeFileSync(objectPath, bytes);
      writeFileSync(path.join(root, ".ohrisk-artifact-cache"), "ohrisk artifact cache v3\n");
      writeFileSync(indexPath, JSON.stringify({
        version: 2,
        key,
        sha256: digest,
        size: bytes.byteLength
      }));
      utimesSync(indexPath, new Date(1_000), new Date(1_000));

      const cache = createArtifactCache(root, {
        now: () => 10_000,
        defaultTtlMs: 1_000
      });
      expect(cache.read(url, 1024)).toMatchObject({
        stale: true,
        fetchedAt: 1_000,
        expiresAt: 2_000
      });
      expect(JSON.parse(readFileSync(indexPath, "utf8"))).toMatchObject({
        version: 3,
        fetchedAt: 1_000,
        lastAccessedAt: 10_000,
        expiresAt: 2_000
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("reports stale, corrupt, and orphaned cache state without trusting bad indexes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-status-"));
    let now = 1_000;
    try {
      const cache = createArtifactCache(root, { now: () => now, defaultTtlMs: 10 });
      const staleUrl = "https://registry.example.com/stale.tgz";
      const orphanUrl = "https://registry.example.com/orphan.tgz";
      const corruptUrl = "https://registry.example.com/corrupt.tgz";
      cache.write(staleUrl, Buffer.from("stale"));
      cache.write(orphanUrl, Buffer.from("orphan"));
      now = 1_020;
      cache.write(corruptUrl, Buffer.from("original"));

      const corruptIndexPath = indexPathForUrl(root, corruptUrl);
      const corruptIndex = JSON.parse(readFileSync(corruptIndexPath, "utf8")) as {
        sha256: string;
      };
      writeFileSync(objectPathForDigest(root, corruptIndex.sha256), "tampered!");

      const orphanIndexPath = indexPathForUrl(root, orphanUrl);
      const orphanIndex = JSON.parse(readFileSync(orphanIndexPath, "utf8")) as {
        sha256: string;
      };
      unlinkSync(orphanIndexPath);
      const status = cache.status();

      expect(status.ok).toBe(true);
      if (!status.ok) throw new Error(status.error.message);
      expect(status.value).toMatchObject({
        entryCount: 1,
        objectCount: 3,
        totalBytes: Buffer.byteLength("stale")
          + Buffer.byteLength("orphan")
          + Buffer.byteLength("tampered!"),
        orphanObjectCount: 2,
        orphanBytes: Buffer.byteLength("orphan") + Buffer.byteLength("tampered!"),
        staleEntryCount: 1,
        corruptEntryCount: 1,
        oldestAccessedAt: 1_000,
        newestAccessedAt: 1_000
      });
      expect(orphanIndex.sha256).not.toBe(corruptIndex.sha256);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("prunes expired entries and enforces max size by least recent access", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-prune-"));
    let now = 1_000;
    try {
      const cache = createArtifactCache(root, {
        now: () => now,
        defaultTtlMs: 10_000,
        maxSizeBytes: 1_000
      });
      const oldUrl = "https://registry.example.com/old.tgz";
      const recentUrl = "https://registry.example.com/recent.tgz";
      const expiredUrl = "https://registry.example.com/expired.tgz";
      cache.write(oldUrl, Buffer.from("1111"));
      now = 1_100;
      cache.write(recentUrl, Buffer.from("2222"));
      now = 1_200;
      cache.read(oldUrl, 1024);
      cache.write(expiredUrl, Buffer.from("3333"), { expiresAt: 1_200 });
      now = 1_300;

      const pruned = cache.prune({ maxSizeBytes: 4 });
      expect(pruned.ok).toBe(true);
      if (!pruned.ok) throw new Error(pruned.error.message);
      expect(pruned.value).toMatchObject({
        removedEntryCount: 2,
        removedObjectCount: 2,
        removedBytes: 8,
        after: {
          entryCount: 1,
          objectCount: 1,
          totalBytes: 4,
          staleEntryCount: 0
        }
      });
      expect(cache.read(oldUrl, 1024)?.bytes.toString()).toBe("1111");
      expect(cache.read(recentUrl, 1024)).toBeUndefined();
      expect(cache.read(expiredUrl, 1024)).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("clears only cache-owned children and leaves an empty reusable cache", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-clear-"));
    try {
      const cache = createArtifactCache(root);
      cache.write("https://registry.example.com/a.tgz", Buffer.from("a"));
      cache.write("https://registry.example.com/b.tgz", Buffer.from("bb"));
      writeFileSync(path.join(root, "unrelated.txt"), "preserve", "utf8");

      const cleared = cache.clear();
      expect(cleared).toEqual({
        ok: true,
        value: {
          removedEntryCount: 2,
          removedObjectCount: 2,
          removedBytes: 3
        }
      });
      expect(readFileSync(path.join(root, "unrelated.txt"), "utf8")).toBe("preserve");
      expect(cache.status()).toEqual({
        ok: true,
        value: {
          entryCount: 0,
          objectCount: 0,
          totalBytes: 0,
          orphanObjectCount: 0,
          orphanBytes: 0,
          staleEntryCount: 0,
          corruptEntryCount: 0
        }
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("refuses prune and clear when the cache ownership marker is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-unowned-"));
    const sentinel = path.join(root, "index", "sentinel.txt");
    try {
      mkdirSync(path.dirname(sentinel), { recursive: true });
      writeFileSync(sentinel, "preserve", "utf8");
      const cache = openArtifactCacheForManagement(root);

      cache.write("https://registry.example.com/blocked.tgz", Buffer.from("blocked"));
      const pruned = cache.prune();
      const cleared = cache.clear();

      expect(pruned.ok).toBe(false);
      expect(cleared.ok).toBe(false);
      if (pruned.ok || cleared.ok) {
        throw new Error("Expected unowned cache management to fail closed.");
      }
      expect(pruned.error.code).toBe("CACHE_OPERATION_FAILED");
      expect(cleared.error.code).toBe("CACHE_OPERATION_FAILED");
      expect(readFileSync(sentinel, "utf8")).toBe("preserve");
      expect(existsSync(path.join(root, "objects"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("refuses prune and clear when the cache ownership marker does not match", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-wrong-owner-"));
    const marker = path.join(root, ".ohrisk-artifact-cache");
    const sentinel = path.join(root, "objects", "sentinel.txt");
    try {
      mkdirSync(path.dirname(sentinel), { recursive: true });
      writeFileSync(marker, "owned by another tool\n", "utf8");
      writeFileSync(sentinel, "preserve", "utf8");
      const cache = openArtifactCacheForManagement(root);

      cache.write("https://registry.example.com/blocked.tgz", Buffer.from("blocked"));
      const pruned = cache.prune();
      const cleared = cache.clear();

      expect(pruned.ok).toBe(false);
      expect(cleared.ok).toBe(false);
      expect(readFileSync(marker, "utf8")).toBe("owned by another tool\n");
      expect(readFileSync(sentinel, "utf8")).toBe("preserve");
      expect(existsSync(path.join(root, "index"))).toBe(false);
      expect(existsSync(path.join(root, "objects", "sha256"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("uses platform cache conventions without reading project paths", () => {
    expect(defaultArtifactCacheDirectory(
      { XDG_CACHE_HOME: "/tmp/xdg" },
      "/home/user",
      "linux"
    )).toBe(path.resolve("/tmp/xdg/ohrisk/artifacts"));
    expect(defaultArtifactCacheDirectory(
      { LOCALAPPDATA: "C:\\Users\\user\\AppData\\Local" },
      "C:\\Users\\user",
      "win32"
    )).toBe(path.resolve("C:\\Users\\user\\AppData\\Local", "Ohrisk", "Cache", "artifacts"));
  });
});

function headersFrom(values: Record<string, string>): { get: (name: string) => string | null } {
  const normalized = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    get: (name) => normalized.get(name.toLowerCase()) ?? null
  };
}

function indexPathForUrl(root: string, url: string): string {
  const key = sha256(Buffer.from(url, "utf8"));
  return path.join(root, "index", key.slice(0, 2), `${key}.json`);
}

function objectPathForDigest(root: string, digest: string): string {
  return path.join(root, "objects", "sha256", digest.slice(0, 2), digest);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
