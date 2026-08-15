import type { CacheIndexRecord } from "./cache";
import type { CachePrunePlan } from "./cache-prune-plan";

export type CachePruneExecution = {
  completed: boolean;
  remainingEntries: CacheIndexRecord[];
  remainingObjectSizes: Map<string, number>;
  removedObjectCount: number;
  removedBytes: number;
};

export function executeCachePrunePlan(input: {
  entries: readonly CacheIndexRecord[];
  objectSizes: ReadonlyMap<string, number>;
  plan: CachePrunePlan;
  retainState?: boolean;
  shouldStop: () => boolean;
  removeEntry: (entryPath: string) => boolean;
  removeObject: (digest: string) => boolean;
}): CachePruneExecution {
  const removedEntryPaths = new Set<string>();
  for (const entryPath of input.plan.removeEntryPaths) {
    if (input.shouldStop()) {
      return result(
        false,
        input.entries,
        input.objectSizes,
        removedEntryPaths,
        new Set(),
        0,
        0,
        input.retainState ?? true
      );
    }
    if (input.removeEntry(entryPath)) {
      removedEntryPaths.add(entryPath);
    }
  }

  const remainingEntries = input.entries.filter((entry) => !removedEntryPaths.has(entry.path));
  const remainingDigests = new Set(remainingEntries.map((entry) => entry.index.sha256));
  const removedObjectDigests = new Set<string>();
  let removedObjectCount = 0;
  let removedBytes = 0;

  for (const digest of input.plan.removeObjectDigests) {
    if (remainingDigests.has(digest)) {
      continue;
    }
    if (input.shouldStop()) {
      return result(
        false,
        input.entries,
        input.objectSizes,
        removedEntryPaths,
        removedObjectDigests,
        removedObjectCount,
        removedBytes,
        input.retainState ?? true
      );
    }
    const size = input.objectSizes.get(digest);
    if (size !== undefined && input.removeObject(digest)) {
      removedObjectDigests.add(digest);
      removedObjectCount += 1;
      removedBytes += size;
    }
  }

  return result(
    true,
    input.entries,
    input.objectSizes,
    removedEntryPaths,
    removedObjectDigests,
    removedObjectCount,
    removedBytes,
    input.retainState ?? true
  );
}

function result(
  completed: boolean,
  entries: readonly CacheIndexRecord[],
  objectSizes: ReadonlyMap<string, number>,
  removedEntryPaths: ReadonlySet<string>,
  removedObjectDigests: ReadonlySet<string>,
  removedObjectCount: number,
  removedBytes: number,
  retainState: boolean
): CachePruneExecution {
  return {
    completed,
    remainingEntries: retainState
      ? entries.filter((entry) => !removedEntryPaths.has(entry.path))
      : [],
    remainingObjectSizes: retainState
      ? new Map([...objectSizes].filter(([digest]) => !removedObjectDigests.has(digest)))
      : new Map(),
    removedObjectCount,
    removedBytes
  };
}
