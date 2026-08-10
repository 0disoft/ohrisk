import type { CacheIndexRecord } from "./cache";

export type CachePrunePlan = {
  removeEntryPaths: string[];
  removeObjectDigests: string[];
};

export function planCachePrune(input: {
  entries: readonly CacheIndexRecord[];
  objectSizes: ReadonlyMap<string, number>;
  now: number;
  maxSizeBytes: number;
  maxAgeMs?: number;
  removeExpired?: boolean;
}): CachePrunePlan {
  const removeExpired = input.removeExpired ?? true;
  const maxAgeMs = input.maxAgeMs;
  const entriesToRemove = new Set<string>();
  const liveDigestCounts = new Map<string, number>();
  const liveEntries: CacheIndexRecord[] = [];

  for (const entry of input.entries) {
    const isExpired = removeExpired && entry.index.expiresAt <= input.now;
    const isTooOld = maxAgeMs !== undefined
      && input.now - entry.index.lastAccessedAt >= maxAgeMs;
    if (isExpired || isTooOld) {
      entriesToRemove.add(entry.path);
      continue;
    }
    liveEntries.push(entry);
    liveDigestCounts.set(entry.index.sha256, (liveDigestCounts.get(entry.index.sha256) ?? 0) + 1);
  }

  let remainingBytes = 0;
  for (const [digest, count] of liveDigestCounts) {
    if (count > 0) {
      remainingBytes += input.objectSizes.get(digest) ?? 0;
    }
  }

  liveEntries.sort((left, right) =>
    left.index.lastAccessedAt - right.index.lastAccessedAt
    || left.path.localeCompare(right.path)
  );

  for (const entry of liveEntries) {
    if (remainingBytes <= input.maxSizeBytes) {
      break;
    }
    entriesToRemove.add(entry.path);
    const digest = entry.index.sha256;
    const remainingCount = (liveDigestCounts.get(digest) ?? 1) - 1;
    liveDigestCounts.set(digest, remainingCount);
    if (remainingCount === 0) {
      remainingBytes -= input.objectSizes.get(digest) ?? entry.index.size;
    }
  }

  const referencedAfterRemoval = new Set<string>();
  for (const entry of input.entries) {
    if (!entriesToRemove.has(entry.path)) {
      referencedAfterRemoval.add(entry.index.sha256);
    }
  }

  const referencedBeforeRemoval = new Set(
    input.entries.map((entry) => entry.index.sha256)
  );
  const removeObjectDigests = [...referencedBeforeRemoval].filter(
    (digest) => !referencedAfterRemoval.has(digest)
  ).sort(comparePath);

  return {
    removeEntryPaths: [...entriesToRemove].sort(comparePath),
    removeObjectDigests
  };
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
