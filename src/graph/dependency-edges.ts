import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { DependencyEdge, DependencyGraph, DependencyType } from "./types";

export const DEPENDENCY_GRAPH_MAX_EDGES = 1_000_000;

/** Legacy inputs expose positive relationships through paths, without proving exhaustive adjacency. */
export function dependencyEdgesForGraph(graph: DependencyGraph): DependencyEdge[] {
  if (graph.edges !== undefined) return graph.edges;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map<string, DependencyEdge>();
  const add = (edge: DependencyEdge): void => {
    edges.set(JSON.stringify([edge.from ?? null, edge.to, edge.dependencyType]), edge);
  };
  for (const node of graph.nodes) {
    if (node.direct) add({ to: node.id, dependencyType: node.dependencyType });
    for (const path of node.paths) {
      const ids = path.map((segment) => {
        const separator = segment.lastIndexOf(" -> ");
        return separator < 0 ? segment : segment.slice(separator + 4);
      });
      for (let index = 1; index < ids.length; index++) {
        const from = ids[index - 1]!;
        const child = nodesById.get(ids[index]!);
        if (nodesById.has(from) && child) {
          add({ from, to: child.id, dependencyType: child.dependencyType });
        }
      }
    }
  }
  return [...edges.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, edge]) => edge);
}

export function collectDependencyEdges(input: {
  refs: readonly string[];
  rootRefs: readonly string[];
  idForRef: (ref: string) => string | undefined;
  childRefs: (ref: string) => readonly string[];
  dependencyTypeForRef: (ref: string) => DependencyType;
  unknownRefs?: readonly string[];
  rootDependenciesUnknown?: boolean;
  maxEdges?: number;
}): Result<Pick<DependencyGraph, "edges" | "unknownDependencyNodeIds" | "rootDependenciesUnknown">, OhriskError> {
  const edges = new Map<string, DependencyEdge>();
  const unknownIds = new Set(input.unknownRefs?.flatMap((ref) => {
    const id = input.idForRef(ref);
    return id === undefined ? [] : [id];
  }));
  let rootDependenciesUnknown = input.rootDependenciesUnknown ?? false;
  const limit = input.maxEdges ?? DEPENDENCY_GRAPH_MAX_EDGES;
  const addEdge = (from: string | undefined, childRef: string): boolean => {
    const to = input.idForRef(childRef);
    if (to === undefined) {
      if (from === undefined) rootDependenciesUnknown = true;
      else unknownIds.add(from);
      return true;
    }
    const dependencyType = input.dependencyTypeForRef(childRef);
    const edge: DependencyEdge = { ...(from === undefined ? {} : { from }), to, dependencyType };
    edges.set(JSON.stringify([from ?? null, to, dependencyType]), edge);
    return edges.size <= limit;
  };
  for (const rootRef of input.rootRefs) {
    if (!addEdge(undefined, rootRef)) return edgeLimitError(limit);
  }
  for (const ref of input.refs) {
    const from = input.idForRef(ref);
    if (from === undefined) continue;
    for (const child of input.childRefs(ref)) {
      if (!addEdge(from, child)) return edgeLimitError(limit);
    }
  }
  return ok({
    edges: [...edges.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, edge]) => edge),
    ...(unknownIds.size > 0 ? { unknownDependencyNodeIds: [...unknownIds].sort() } : {}),
    ...(rootDependenciesUnknown ? { rootDependenciesUnknown: true } : {})
  });
}

function edgeLimitError(limit: number): Result<never, OhriskError> {
  return err(createError({
    code: "DEPENDENCY_GRAPH_LIMIT_EXCEEDED", category: "unsupported_input",
    message: `Dependency relationships exceeded the supported edge limit of ${limit}.`,
    details: { limit }
  }));
}
