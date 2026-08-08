import type { DependencyGraphDiagnostic } from "./types";

export const BOUNDED_PATHS_MAX_PATHS_PER_NODE = 64;
export const BOUNDED_PATHS_MAX_PATH_DEPTH = 256;
export const BOUNDED_PATHS_MAX_TRAVERSAL_PATHS = 200_000;
export const BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS = 1_048_576;
export const BOUNDED_PATHS_TRUNCATED_SEGMENT = "<path-truncated>";

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
}): BoundedPathCollectionResult {
  const pathLimitAffected = new Set<string>();
  const depthLimitAffected = new Set<string>();
  const workLimitAffected = new Set<string>();
  const segmentLimitAffected = new Set<string>();
  const pathKeysByNodeKey = new Map<string, Set<string>>();
  const expandedNodeKeys = new Set<string>();
  let totalPaths = 0;
  let totalStoredSegments = 0;

  const stack: Array<{
    nodeKey: string;
    pathNodeKeys: string[];
    pathRefs: string[];
    depth: number;
  }> = input.rootRefs.map((nodeKey) => ({
    nodeKey,
    pathNodeKeys: [input.rootName],
    pathRefs: [],
    depth: 1
  }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.pathRefs.includes(current.nodeKey)) {
      continue;
    }

    const nextPath = [...current.pathNodeKeys, current.nodeKey];
    const nextPathRefs = [...current.pathRefs, current.nodeKey];

    if (totalPaths >= BOUNDED_PATHS_MAX_TRAVERSAL_PATHS) {
      workLimitAffected.add(current.nodeKey);
      continue;
    }

    const pathKey = nextPath.join("\u0000");
    const pathKeys = pathKeysByNodeKey.get(current.nodeKey) ?? new Set<string>();

    if (current.depth > BOUNDED_PATHS_MAX_PATH_DEPTH) {
      depthLimitAffected.add(current.nodeKey);
      const summarizedPath = [input.rootName, BOUNDED_PATHS_TRUNCATED_SEGMENT, current.nodeKey];
      const summarizedKey = summarizedPath.join("\u0000");
      if (!pathKeys.has(summarizedKey)) {
        pathKeys.add(summarizedKey);
        pathKeysByNodeKey.set(current.nodeKey, pathKeys);
        totalPaths += 1;
        totalStoredSegments += summarizedPath.length;
      }
      if (expandedNodeKeys.has(current.nodeKey)) {
        continue;
      }
      expandedNodeKeys.add(current.nodeKey);

      const childNodeKeys = input.childRefs(current.nodeKey);
      if (childNodeKeys.length > 0) {
        const boundedPathNodeKeys = nextPath.length > BOUNDED_PATHS_MAX_PATH_DEPTH
          ? nextPath.slice(-BOUNDED_PATHS_MAX_PATH_DEPTH)
          : nextPath;
        const boundedPathRefs = nextPathRefs.length > BOUNDED_PATHS_MAX_PATH_DEPTH
          ? nextPathRefs.slice(-BOUNDED_PATHS_MAX_PATH_DEPTH)
          : nextPathRefs;

        for (let index = childNodeKeys.length - 1; index >= 0; index -= 1) {
          const childNodeKey = childNodeKeys[index];
          if (!childNodeKey) {
            continue;
          }

          stack.push({
            nodeKey: childNodeKey,
            pathNodeKeys: boundedPathNodeKeys,
            pathRefs: boundedPathRefs,
            depth: current.depth + 1
          });
        }
      }
      continue;
    }

    if (pathKeys.has(pathKey)) {
      continue;
    }

    if (pathKeys.size >= BOUNDED_PATHS_MAX_PATHS_PER_NODE) {
      pathLimitAffected.add(current.nodeKey);
      continue;
    }

    if (totalStoredSegments + nextPath.length > BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS) {
      segmentLimitAffected.add(current.nodeKey);
      continue;
    }

    pathKeys.add(pathKey);
    pathKeysByNodeKey.set(current.nodeKey, pathKeys);
    totalPaths += 1;
    totalStoredSegments += nextPath.length;

    if (expandedNodeKeys.has(current.nodeKey)) {
      continue;
    }
    expandedNodeKeys.add(current.nodeKey);

    const childNodeKeys = input.childRefs(current.nodeKey);
    if (childNodeKeys.length > 0) {
      const boundedPathNodeKeys = nextPath.length > BOUNDED_PATHS_MAX_PATH_DEPTH
        ? nextPath.slice(-BOUNDED_PATHS_MAX_PATH_DEPTH)
        : nextPath;
      const boundedPathRefs = nextPathRefs.length > BOUNDED_PATHS_MAX_PATH_DEPTH
        ? nextPathRefs.slice(-BOUNDED_PATHS_MAX_PATH_DEPTH)
        : nextPathRefs;

      for (let index = childNodeKeys.length - 1; index >= 0; index -= 1) {
        const childNodeKey = childNodeKeys[index];
        if (!childNodeKey) {
          continue;
        }

        stack.push({
          nodeKey: childNodeKey,
          pathNodeKeys: boundedPathNodeKeys,
          pathRefs: boundedPathRefs,
          depth: current.depth + 1
        });
      }
    }
  }

  const pathsByNode = new Map<string, string[][]>();
  for (const [nodeKey, pathKeys] of pathKeysByNodeKey) {
    pathsByNode.set(
      nodeKey,
      [...pathKeys].sort((left, right) => left.localeCompare(right)).map((key) => key.split("\u0000"))
    );
  }

  const diagnostics: DependencyGraphDiagnostic[] = [];
  if (pathLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: pathLimitAffected.size,
      limit: BOUNDED_PATHS_MAX_PATHS_PER_NODE,
      message: `Dependency paths were limited to ${BOUNDED_PATHS_MAX_PATHS_PER_NODE} paths per ${input.pathNoun}.`
    });
  }
  if (depthLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_path_depth_summarized",
      affectedNodeCount: depthLimitAffected.size,
      limit: BOUNDED_PATHS_MAX_PATH_DEPTH,
      message: `Dependency paths deeper than ${BOUNDED_PATHS_MAX_PATH_DEPTH} ${input.pathNoun} were summarized.`
    });
  }
  if (workLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: workLimitAffected.size,
      limit: BOUNDED_PATHS_MAX_TRAVERSAL_PATHS,
      message: `Dependency traversal stopped after ${BOUNDED_PATHS_MAX_TRAVERSAL_PATHS} stored paths to bound scan work.`
    });
  }
  if (segmentLimitAffected.size > 0) {
    diagnostics.push({
      code: "dependency_paths_truncated",
      affectedNodeCount: segmentLimitAffected.size,
      limit: BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS,
      message: `Dependency paths were limited to ${BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS} stored path segments.`
    });
  }

  return {
    pathsByNode,
    diagnostics,
    discoveredNodeKeys: [...expandedNodeKeys],
    rootRefs: input.rootRefs
  };
}
