import { describe, expect, test } from "bun:test";

import { executeCachePrunePlan } from "../src/evidence/cache-prune-executor";
import type { CacheIndexRecord } from "../src/evidence/cache";

describe("executeCachePrunePlan", () => {
  test("stops before the next mutation and never starts object deletion", () => {
    const entries = [entry("a"), entry("b")];
    const removedEntries: string[] = [];
    const removedObjects: string[] = [];
    let checkpoints = 0;

    const result = executeCachePrunePlan({
      entries,
      objectSizes: new Map([["a", 1], ["b", 1]]),
      plan: {
        removeEntryPaths: entries.map((item) => item.path),
        removeObjectDigests: ["a", "b"]
      },
      shouldStop: () => checkpoints++ >= 1,
      removeEntry: (entryPath) => {
        removedEntries.push(entryPath);
        return true;
      },
      removeObject: (digest) => {
        removedObjects.push(digest);
        return true;
      }
    });

    expect(result.completed).toBe(false);
    expect(removedEntries).toEqual([entries[0]?.path]);
    expect(removedObjects).toEqual([]);
    expect(result.remainingEntries.map((item) => item.path)).toEqual([entries[1]?.path]);
  });

  test("removes unreferenced objects only after every planned index mutation", () => {
    const entries = [entry("shared", "one"), entry("shared", "two"), entry("old")];
    const removedEntries: string[] = [];
    const removedObjects: string[] = [];

    const result = executeCachePrunePlan({
      entries,
      objectSizes: new Map([["shared", 4], ["old", 3], ["orphan", 2]]),
      plan: {
        removeEntryPaths: [entries[0]!.path, entries[2]!.path],
        removeObjectDigests: ["old", "orphan", "shared"]
      },
      shouldStop: () => false,
      removeEntry: (entryPath) => {
        removedEntries.push(entryPath);
        return true;
      },
      removeObject: (digest) => {
        removedObjects.push(digest);
        return true;
      }
    });

    expect(result.completed).toBe(true);
    expect(removedEntries).toEqual([entries[0]!.path, entries[2]!.path]);
    expect(removedObjects).toEqual(["old", "orphan"]);
    expect(result.remainingEntries.map((item) => item.path)).toEqual([entries[1]!.path]);
    expect([...result.remainingObjectSizes]).toEqual([["shared", 4]]);
    expect(result.removedObjectCount).toBe(2);
    expect(result.removedBytes).toBe(5);
  });
});

function entry(digest: string, suffix = digest): CacheIndexRecord {
  return {
    path: `index/${suffix}.json`,
    index: {
      version: 3,
      key: suffix,
      sha256: digest,
      size: 1,
      fetchedAt: 1_000,
      lastAccessedAt: 1_000,
      expiresAt: 2_000
    }
  };
}
