import { describe, expect, test } from "bun:test";

import { planCachePrune } from "../src/evidence/cache-prune-plan";
import type { CacheIndexRecord, CacheInventory } from "../src/evidence/cache";

describe("planCachePrune", () => {
  test("plans an exact mixed stale plus LRU max-bytes removal", () => {
    const inventory = inventoryWith([
      entry("s1", { size: 100, accessedAt: 1_000, expiresAt: 1_000 }),
      entry("s2", { size: 100, accessedAt: 1_050, expiresAt: 1_000 }),
      entry("a", { size: 100, accessedAt: 1_100, expiresAt: 9_000 }),
      entry("b", { size: 100, accessedAt: 1_200, expiresAt: 9_000 }),
      entry("c", { size: 100, accessedAt: 1_300, expiresAt: 9_000 }),
      entry("d", { size: 100, accessedAt: 1_400, expiresAt: 9_000 }),
      entry("e", { size: 100, accessedAt: 1_500, expiresAt: 9_000 })
    ]);

    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 200
    });

    expect(plan.removeEntryPaths).toEqual([
      "index/a.json",
      "index/b.json",
      "index/c.json",
      "index/s1.json",
      "index/s2.json"
    ]);
    expect(plan.removeObjectDigests).toEqual(["a", "b", "c", "s1", "s2"]);
    expect(planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 200
    })).toEqual(plan);
  });

  test("keeps a shared object while any live entry references it", () => {
    const inventory = inventoryWith([
      entry("shared", { pathSuffix: "s1", size: 100, accessedAt: 1_000, expiresAt: 9_000 }),
      entry("shared", { pathSuffix: "s2", size: 100, accessedAt: 1_100, expiresAt: 9_000 }),
      entry("shared", { pathSuffix: "s3", size: 100, accessedAt: 1_200, expiresAt: 9_000 }),
      entry("c", { size: 100, accessedAt: 1_300, expiresAt: 9_000 }),
      entry("b", { size: 100, accessedAt: 1_400, expiresAt: 9_000 }),
      entry("a", { size: 100, accessedAt: 1_500, expiresAt: 9_000 })
    ]);

    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 100
    });

    expect(plan.removeEntryPaths).toEqual([
      "index/b.json",
      "index/c.json",
      "index/shared-s1.json",
      "index/shared-s2.json",
      "index/shared-s3.json"
    ]);
    expect(plan.removeObjectDigests).toEqual(["b", "c", "shared"]);
    expect(plan.removeObjectDigests).not.toContain("a");
  });

  test("keeps expired entries when removeExpired is false", () => {
    const inventory = inventoryWith([
      entry("old", { size: 100, accessedAt: 1_000, expiresAt: 500 }),
      entry("new", { size: 100, accessedAt: 1_100, expiresAt: 9_000 })
    ]);

    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 100,
      removeExpired: false
    });

    expect(plan.removeEntryPaths).toEqual(["index/old.json"]);
    expect(plan.removeObjectDigests).toEqual(["old"]);
  });

  test("handles a missing object size with the entry size fallback", () => {
    const inventory = inventoryWith([
      entry("missing", { size: 42, accessedAt: 1_000, expiresAt: 9_000 }),
      entry("kept", { size: 100, accessedAt: 1_100, expiresAt: 9_000 }),
      entry("extra", { size: 100, accessedAt: 1_200, expiresAt: 9_000 })
    ]);
    inventory.objectSizes.delete("missing");

    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 100
    });

    expect(plan.removeEntryPaths).toEqual(["index/kept.json", "index/missing.json"]);
    expect(plan.removeObjectDigests).toEqual(["kept", "missing"]);
  });

  test("keeps the removal plan stable under entry and object permutation", () => {
    const forward = inventoryWith([
      entry("a", { size: 100, accessedAt: 1_100, expiresAt: 9_000 }),
      entry("b", { size: 100, accessedAt: 1_200, expiresAt: 9_000 }),
      entry("c", { size: 100, accessedAt: 1_300, expiresAt: 9_000 }),
      entry("d", { size: 100, accessedAt: 1_400, expiresAt: 9_000 }),
      entry("e", { size: 100, accessedAt: 1_500, expiresAt: 9_000 })
    ]);
    const reversed: CacheInventory = {
      entries: [...forward.entries].reverse(),
      objectSizes: new Map([...forward.objectSizes.entries()].reverse()),
      corruptEntryCount: 0
    };

    const expected = planCachePrune({
      entries: forward.entries,
      objectSizes: forward.objectSizes,
      now: 2_000,
      maxSizeBytes: 200
    });
    const actual = planCachePrune({
      entries: reversed.entries,
      objectSizes: reversed.objectSizes,
      now: 2_000,
      maxSizeBytes: 200
    });

    expect(actual).toEqual(expected);
  });

  test("plans a 100k-entry distinct-digest inventory without quadratic scans", () => {
    const inventory = largeDistinctInventory(100_000);

    const plan = planCachePrune({
      entries: inventory.entries,
      objectSizes: inventory.objectSizes,
      now: 2_000,
      maxSizeBytes: 0
    });

    expect(plan.removeEntryPaths).toHaveLength(100_000);
    expect(plan.removeObjectDigests).toHaveLength(100_000);
    expect(plan.removeEntryPaths[0]).toBe("index/d0.json");
    expect(plan.removeEntryPaths[99_999]).toBe("index/d99999.json");
  });
});

function inventoryWith(entries: CacheIndexRecord[]): CacheInventory {
  const objectSizes = new Map<string, number>();
  for (const entry of entries) {
    objectSizes.set(entry.index.sha256, entry.index.size);
  }
  return { entries, objectSizes, corruptEntryCount: 0 };
}

function entry(digest: string, options: {
  size: number;
  accessedAt: number;
  expiresAt: number;
  pathSuffix?: string;
}): CacheIndexRecord {
  return {
    path: `index/${digest}${options.pathSuffix ? `-${options.pathSuffix}` : ""}.json`,
    index: {
      version: 3,
      key: digest,
      sha256: digest,
      size: options.size,
      fetchedAt: options.accessedAt,
      lastAccessedAt: options.accessedAt,
      expiresAt: options.expiresAt
    }
  };
}

function largeDistinctInventory(entryCount: number): CacheInventory {
  const entries: CacheIndexRecord[] = [];
  const objectSizes = new Map<string, number>();
  for (let i = 0; i < entryCount; i += 1) {
    const digest = `d${i}`;
    entries.push({
      path: `index/${digest}.json`,
      index: {
        version: 3,
        key: digest,
        sha256: digest,
        size: 100,
        fetchedAt: 1_000 + i,
        lastAccessedAt: 1_000 + i,
        expiresAt: 2_000 + i
      }
    });
    objectSizes.set(digest, 100);
  }
  return { entries, objectSizes, corruptEntryCount: 0 };
}
