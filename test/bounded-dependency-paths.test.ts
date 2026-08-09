import { describe, expect, test } from "bun:test";

import {
  BOUNDED_PATHS_TRUNCATED_SEGMENT,
  collectBoundedDependencyPaths
} from "../src/graph/bounded-dependency-paths";

describe("collectBoundedDependencyPaths", () => {
  test("keeps every reachable node when the stored-path work budget is exhausted", () => {
    const childRefs = buildChildRefs({
      root: ["a", "b"],
      a: ["c"],
      b: ["c"],
      c: ["d"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node",
      limits: { maxTraversalPaths: 2 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.discoveredNodeKeys.sort()).toEqual(["a", "b", "c", "d", "root"]);
    for (const nodeKey of result.value.discoveredNodeKeys) {
      expect(result.value.pathsByNode.get(nodeKey)?.length).toBeGreaterThan(0);
    }
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 2
    }));
  });

  test("keeps every reachable node when the stored-segment budget is exhausted", () => {
    const childRefs = buildChildRefs({
      root: ["a", "b"],
      a: ["c"],
      b: ["c"],
      c: ["d"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node",
      limits: { maxStoredPathSegments: 5 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.discoveredNodeKeys.sort()).toEqual(["a", "b", "c", "d", "root"]);
    for (const nodeKey of result.value.discoveredNodeKeys) {
      const paths = result.value.pathsByNode.get(nodeKey);
      expect(paths?.length).toBeGreaterThan(0);
      if (paths && paths[0]?.includes(BOUNDED_PATHS_TRUNCATED_SEGMENT)) {
        expect(paths[0].length).toBe(3);
      }
    }
    expect(result.value.diagnostics.length).toBeGreaterThan(0);
  });

  test("assigns a representative path to every discovered node under a tiny per-node limit", () => {
    const childRefs = buildChildRefs({
      root: ["mid-a", "mid-b"],
      "mid-a": ["shared"],
      "mid-b": ["shared"],
      shared: ["leaf"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node",
      limits: { maxPathsPerNode: 1 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.discoveredNodeKeys.sort()).toEqual([
      "leaf",
      "mid-a",
      "mid-b",
      "root",
      "shared"
    ]);
    for (const nodeKey of result.value.discoveredNodeKeys) {
      expect(result.value.pathsByNode.get(nodeKey)?.length).toBeGreaterThan(0);
    }
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 1
    }));
  });

  test("terminates and discovers once for converging graphs with cycles", () => {
    const childRefs = buildChildRefs({
      root: ["a", "b"],
      a: ["c", "a"],
      b: ["c"],
      c: ["b"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const discovered = new Set(result.value.discoveredNodeKeys);
    expect(discovered).toEqual(new Set(["root", "a", "b", "c"]));
    for (const nodeKey of result.value.discoveredNodeKeys) {
      expect(result.value.pathsByNode.get(nodeKey)?.length).toBeGreaterThan(0);
    }
  });

  test("keeps discovery, paths, and diagnostics stable under edge-order permutation", () => {
    const forward = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs: buildChildRefs({
        root: ["a", "b"],
        a: ["c"],
        b: ["c"],
        c: ["d"]
      }),
      pathNoun: "node"
    });
    const reversed = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs: buildChildRefs({
        root: ["b", "a"],
        b: ["c"],
        a: ["c"],
        c: ["d"]
      }),
      pathNoun: "node"
    });

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) {
      throw new Error("Helper parse failed.");
    }

    expect(reversed.value.discoveredNodeKeys).toEqual(forward.value.discoveredNodeKeys);
    expect(reversed.value.diagnostics).toEqual(forward.value.diagnostics);
    for (const nodeKey of forward.value.discoveredNodeKeys) {
      expect(reversed.value.pathsByNode.get(nodeKey))
        .toEqual(forward.value.pathsByNode.get(nodeKey));
    }
  });

  test("keeps multi-parent paths identical under parent and root order changes", () => {
    const edges: Record<string, string[]> = {
      root: ["p1", "p2", "p3", "p4"],
      "p1": ["x"],
      "p2": ["x"],
      "p3": ["x"],
      "p4": ["x"],
      "r2": ["x"],
      "x": ["leaf"],
      "leaf": []
    };

    const forward = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root", "r2"],
      childRefs: (nodeKey) => edges[nodeKey] ?? [],
      pathNoun: "node"
    });
    const reversedEdges = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["r2", "root"],
      childRefs: (nodeKey) => [...(edges[nodeKey] ?? [])].reverse(),
      pathNoun: "node"
    });

    expect(forward.ok).toBe(true);
    expect(reversedEdges.ok).toBe(true);
    if (!forward.ok || !reversedEdges.ok) {
      throw new Error("Helper parse failed.");
    }

    expect(reversedEdges.value.discoveredNodeKeys).toEqual(forward.value.discoveredNodeKeys);
    expect(reversedEdges.value.diagnostics).toEqual(forward.value.diagnostics);
    for (const nodeKey of forward.value.discoveredNodeKeys) {
      expect(reversedEdges.value.pathsByNode.get(nodeKey))
        .toEqual(forward.value.pathsByNode.get(nodeKey));
    }
    expect(forward.value.pathsByNode.get("x")?.length).toBe(5);
  });

  test("stores up to the per-node cap when candidate paths overflow it", () => {
    const childRefs = buildChildRefs({
      root: Array.from({ length: 70 }, (_, index) => `parent-${index}`),
      ...Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [
          `parent-${index}`,
          ["shared"]
        ])
      ),
      shared: ["leaf"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const sharedPaths = result.value.pathsByNode.get("shared") ?? [];
    expect(sharedPaths.length).toBe(64);
    expect(result.value.discoveredNodeKeys).toContain("leaf");
    expect(result.value.pathsByNode.get("leaf")?.length).toBeGreaterThan(0);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 64
    }));
  });

  test("fills a tiny per-node cap with distinct paths instead of one", () => {
    const childRefs = buildChildRefs({
      root: ["a", "b", "c"],
      a: ["x"],
      b: ["x"],
      c: ["x"],
      x: ["leaf"]
    });

    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs,
      pathNoun: "node",
      limits: { maxPathsPerNode: 2 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.pathsByNode.get("x")?.length).toBe(2);
    expect(result.value.pathsByNode.get("leaf")?.length).toBe(2);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 2
    }));
  });

  test("fails closed when node discovery exceeds the node limit", () => {
    const result = collectBoundedDependencyPaths({
      rootName: "fixture",
      rootRefs: ["root"],
      childRefs: buildChildRefs({
        root: ["a", "b", "c"],
        a: [],
        b: [],
        c: []
      }),
      pathNoun: "node",
      limits: { maxDiscoveredNodes: 2 }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected discovery to fail closed");
    }
    expect(result.error.code).toBe("DEPENDENCY_GRAPH_LIMIT_EXCEEDED");
  });
});

function buildChildRefs(edges: Record<string, string[]>): (nodeKey: string) => string[] {
  return (nodeKey) => edges[nodeKey] ?? [];
}
