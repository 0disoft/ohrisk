import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { DependencyGraphDiagnostic } from "./types";

export const BOUNDED_PATHS_MAX_PATHS_PER_NODE = 64;
export const BOUNDED_PATHS_MAX_PATH_DEPTH = 256;
export const BOUNDED_PATHS_MAX_TRAVERSAL_PATHS = 200_000;
export const BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS = 1_048_576;
export const BOUNDED_PATHS_MAX_DISCOVERED_NODES = 200_000;
export const BOUNDED_PATHS_TRUNCATED_SEGMENT = "<path-truncated>";

export type BoundedPathLimits = {
  maxPathsPerNode: number;
  maxPathDepth: number;
  maxTraversalPaths: number;
  maxStoredPathSegments: number;
  maxDiscoveredNodes: number;
};

export const BOUNDED_PATH_LIMITS: BoundedPathLimits = {
  maxPathsPerNode: BOUNDED_PATHS_MAX_PATHS_PER_NODE,
  maxPathDepth: BOUNDED_PATHS_MAX_PATH_DEPTH,
  maxTraversalPaths: BOUNDED_PATHS_MAX_TRAVERSAL_PATHS,
  maxStoredPathSegments: BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS,
  maxDiscoveredNodes: BOUNDED_PATHS_MAX_DISCOVERED_NODES
};

export type BoundedPathCollectionResult = {
  pathsByNode: Map<string, string[][]>;
  diagnostics: DependencyGraphDiagnostic[];
  discoveredNodeKeys: string[];
  rootRefs: string[];
};

export function collectBoundedDependencyPaths(input: {
  rootName: string;
  rootRefs: string[];
  childRefs: (nodeKey: string) => string[];
  pathNoun: string;
  limits?: Partial<BoundedPathLimits>;
}): Result<BoundedPathCollectionResult, OhriskError> {
  const limits: BoundedPathLimits = {
    ...BOUNDED_PATH_LIMITS,
    ...input.limits
  };
  const rootRefs = [...input.rootRefs].sort();

  const discovery = discoverBoundedNodes({
    rootRefs,
    childRefs: input.childRefs,
    maxDiscoveredNodes: limits.maxDiscoveredNodes
  });
  if (!discovery.ok) {
    return discovery;
  }

  const pathLimitAffected = new Set<string>();
  const depthLimitAffected = new Set<string>();
  const workLimitAffected = new Set<string>();
  const segmentLimitAffected = new Set<string>();
  const pathsByNode = new Map<string, string[][]>();
  let totalPaths = 0;
  let totalStoredSegments = 0;

  for (const nodeKey of discovery.value.nodeOrder) {
    const depth = discovery.value.depthByNode.get(nodeKey) ?? 1;
    const representative = boundedRepresentativePath({
      rootName: input.rootName,
      nodeKey,
      parentLists: discovery.value.parentLists,
      maxPathDepth: limits.maxPathDepth
    });

    if (depth > limits.maxPathDepth) {
      depthLimitAffected.add(nodeKey);
    }

    const parentKeys = discovery.value.parentLists.get(nodeKey) ?? [];
    const parentPaths: string[][] = [];
    for (const parentKey of parentKeys) {
      parentPaths.push(...(pathsByNode.get(parentKey) ?? []));
    }
    const candidatePaths = mergePathCandidates({
      representative,
      parentPaths,
      maxPathsPerNode: limits.maxPathsPerNode
    });

    if (candidatePaths.length > limits.maxPathsPerNode) {
      pathLimitAffected.add(nodeKey);
    }

    let representativeToStore = representative;
    if (totalStoredSegments + representativeToStore.length > limits.maxStoredPathSegments) {
      const summarized = [input.rootName, BOUNDED_PATHS_TRUNCATED_SEGMENT, nodeKey];
      representativeToStore = summarized;
      segmentLimitAffected.add(nodeKey);
    }

    totalStoredSegments += representativeToStore.length;
    totalPaths += 1;
    const stored: string[][] = [representativeToStore];

    for (const candidate of candidatePaths) {
      if (stored.length >= limits.maxPathsPerNode) {
        break;
      }
      if (pathKeyEquals(candidate, representativeToStore)) {
        continue;
      }
      if (totalStoredSegments + candidate.length > limits.maxStoredPathSegments) {
        segmentLimitAffected.add(nodeKey);
        break;
      }
      if (totalPaths + 1 > limits.maxTraversalPaths) {
        workLimitAffected.add(nodeKey);
        break;
      }

      stored.push(candidate);
      totalStoredSegments += candidate.length;
      totalPaths += 1;
    }

    stored.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
    pathsByNode.set(nodeKey, stored);
  }

  const diagnostics: DependencyGraphDiagnostic[] = [];
  if (pathLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: pathLimitAffected.size,
      limit: limits.maxPathsPerNode,
      message: `Dependency paths were limited to ${limits.maxPathsPerNode} paths per ${input.pathNoun}.`
    });
  }
  if (depthLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_path_depth_summarized",
      affectedNodeCount: depthLimitAffected.size,
      limit: limits.maxPathDepth,
      message: `Dependency paths deeper than ${limits.maxPathDepth} ${input.pathNoun} were summarized.`
    });
  }
  if (workLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: workLimitAffected.size,
      limit: limits.maxTraversalPaths,
      message: `Dependency traversal stopped after ${limits.maxTraversalPaths} stored paths to bound scan work.`
    });
  }
  if (segmentLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: segmentLimitAffected.size,
      limit: limits.maxStoredPathSegments,
      message: `Dependency paths were limited to ${limits.maxStoredPathSegments} stored path segments.`
    });
  }

  return ok({
    pathsByNode,
    diagnostics,
    discoveredNodeKeys: discovery.value.nodeOrder,
    rootRefs
  });
}

function discoverBoundedNodes(input: {
  rootRefs: string[];
  childRefs: (nodeKey: string) => string[];
  maxDiscoveredNodes: number;
}): Result<{
  nodeOrder: string[];
  parentLists: Map<string, string[]>;
  depthByNode: Map<string, number>;
}, OhriskError> {
  const nodeOrder: string[] = [];
  const parentSets = new Map<string, Set<string>>();
  const depthByNode = new Map<string, number>();
  const visited = new Set<string>();
  const rootRefSet = new Set(input.rootRefs);
  const queue: Array<{ nodeKey: string; parent?: string; depth: number }> = [];

  for (const rootRef of input.rootRefs) {
    if (visited.has(rootRef)) {
      continue;
    }
    visited.add(rootRef);
    parentSets.set(rootRef, new Set<string>());
    depthByNode.set(rootRef, 1);
    nodeOrder.push(rootRef);
    queue.push({ nodeKey: rootRef, depth: 1 });
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (!current) {
      continue;
    }

    const children = [...input.childRefs(current.nodeKey)].sort();
    for (const child of children) {
      if (visited.has(child)) {
        if (rootRefSet.has(child)) {
          continue;
        }
        parentSets.get(child)?.add(current.nodeKey);
        continue;
      }
      visited.add(child);
      parentSets.set(child, new Set([current.nodeKey]));
      depthByNode.set(child, current.depth + 1);
      nodeOrder.push(child);

      if (nodeOrder.length > input.maxDiscoveredNodes) {
        return err(
          createError({
            code: "DEPENDENCY_GRAPH_LIMIT_EXCEEDED",
            category: "unsupported_input",
            message: `Dependency graph discovery exceeded the supported node limit of ${input.maxDiscoveredNodes}.`,
            details: {
              discoveredNodes: nodeOrder.length,
              limit: input.maxDiscoveredNodes
            }
          })
        );
      }

      queue.push({ nodeKey: child, depth: current.depth + 1 });
    }
  }

  const parentLists = new Map<string, string[]>();
  for (const [nodeKey, parents] of parentSets) {
    // Parents keep first-discovered order: with sorted roots and sorted child
    // refs this is deterministic and input-order independent, and it keeps
    // representative paths acyclic for cyclic graphs. Sorting the final list
    // would route representative chains into cycles.
    parentLists.set(nodeKey, [...parents]);
  }

  return ok({
    nodeOrder: topologicalNodeOrder(nodeOrder, parentSets),
    parentLists,
    depthByNode
  });
}

// Parents must be assigned paths before their children so multi-parent unions
// are complete even when a child is discovered through one root before another
// same-depth parent. BFS discovery order is not topological for multi-root
// graphs, so reorder parents-before-children with Kahn's algorithm; cycle
// members keep discovery order at the end.
function topologicalNodeOrder(
  nodeOrder: string[],
  parentSets: Map<string, Set<string>>
): string[] {
  const childSets = new Map<string, Set<string>>();
  for (const [nodeKey, parents] of parentSets) {
    for (const parent of parents) {
      let children = childSets.get(parent);
      if (!children) {
        children = new Set<string>();
        childSets.set(parent, children);
      }
      children.add(nodeKey);
    }
  }

  const indegree = new Map<string, number>();
  for (const nodeKey of nodeOrder) {
    indegree.set(nodeKey, parentSets.get(nodeKey)?.size ?? 0);
  }

  const order: string[] = [];
  const queue: string[] = [];
  for (const nodeKey of nodeOrder) {
    if ((indegree.get(nodeKey) ?? 0) === 0) {
      queue.push(nodeKey);
    }
  }

  let head = 0;
  const ordered = new Set<string>();
  while (head < queue.length) {
    const nodeKey = queue[head];
    head += 1;
    ordered.add(nodeKey);
    order.push(nodeKey);
    for (const child of childSets.get(nodeKey) ?? []) {
      const next = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(child);
      }
    }
  }

  for (const nodeKey of nodeOrder) {
    if (!ordered.has(nodeKey)) {
      ordered.add(nodeKey);
      order.push(nodeKey);
    }
  }

  return order;
}

function boundedRepresentativePath(input: {
  rootName: string;
  nodeKey: string;
  parentLists: Map<string, string[]>;
  maxPathDepth: number;
}): string[] {
  const chain: string[] = [];
  let current: string | undefined = input.nodeKey;
  let steps = 0;

  while (current !== undefined && steps <= input.maxPathDepth) {
    chain.push(current);
    const parents = input.parentLists.get(current);
    current = parents && parents.length > 0 ? parents[0] : undefined;
    steps += 1;
  }

  if (steps > input.maxPathDepth) {
    return [input.rootName, BOUNDED_PATHS_TRUNCATED_SEGMENT, input.nodeKey];
  }

  return [input.rootName, ...chain.reverse()];
}

function mergePathCandidates(input: {
  representative: string[];
  parentPaths: string[][];
  maxPathsPerNode: number;
}): string[][] {
  const seen = new Set<string>([input.representative.join("\u0000")]);
  const candidates: string[][] = [input.representative];

  for (const parentPath of input.parentPaths) {
    const candidate = [...parentPath, input.representative[input.representative.length - 1]];
    const key = candidate.join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length > input.maxPathsPerNode) {
      break;
    }
  }

  return candidates;
}

function pathKeyEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
