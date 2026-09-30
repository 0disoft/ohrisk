import type { UnresolvedDependency } from "./types";

export function unresolvedDependencyKey(item: UnresolvedDependency): string {
  return JSON.stringify([item.from ?? null, item.name, item.dependencyType, item.reason]);
}

export function uniqueUnresolvedDependencies(items: readonly UnresolvedDependency[]): UnresolvedDependency[] {
  const byKey = new Map(items.map((item) => [unresolvedDependencyKey(item), item]));
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}
