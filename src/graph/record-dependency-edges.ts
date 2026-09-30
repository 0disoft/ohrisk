import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { BOUNDED_PATHS_MAX_DISCOVERED_NODES, BOUNDED_PATHS_TRUNCATED_SEGMENT } from "./bounded-dependency-paths";
import { DEPENDENCY_GRAPH_MAX_EDGES } from "./dependency-edges";
import { uniqueUnresolvedDependencies } from "./unresolved-dependencies";
import type { DependencyEdge, DependencyGraph, DependencyNode, DependencyType, UnresolvedDependency } from "./types";

export type RecordDependencyRequest<T> = {
  name: string;
  dependencyType: DependencyType;
  record?: T;
  optional?: boolean;
  inferred?: boolean;
  /** A declared local relationship whose package is outside this parser's model. */
  opaque?: boolean;
};

/** Enumerate source records independently of the bounded explanation-path traversal. */
export function extendGraphWithRecordDependencies<T extends object>(input: {
  graph: DependencyGraph;
  roots: RecordDependencyRequest<T>[];
  node: (record: T) => Omit<DependencyNode, "dependencyType" | "direct" | "paths">;
  children: (record: T) => RecordDependencyRequest<T>[];
  rootDependenciesUnknown?: boolean;
  maxEdges?: number;
}): Result<DependencyGraph, OhriskError> {
  const nodes = new Map(input.graph.nodes.map((node) => [node.id, { ...node }]));
  const edges = new Map<string, DependencyEdge>();
  const unresolved: UnresolvedDependency[] = [...(input.graph.unresolvedDependencies ?? [])];
  const unknown = new Set<string>();
  let rootUnknown = input.rootDependenciesUnknown ?? false;
  const scheduled = new Map<T, Set<DependencyType>>();
  const queue: Array<{ record: T; type: DependencyType }> = [];
  const rank: Record<DependencyType, number> = { production: 4, optional: 3, peer: 2, development: 1, unknown: 0 };
  const limit = input.maxEdges ?? DEPENDENCY_GRAPH_MAX_EDGES;
  const add = (request: RecordDependencyRequest<T>, from?: string): boolean => {
    if (request.opaque) {
      if (from === undefined) rootUnknown = true;
      else unknown.add(from);
      return true;
    }
    if (!request.record || request.inferred) {
      if (request.optional) return true;
      unresolved.push({
        ...(from === undefined ? {} : { from }), name: request.name,
        dependencyType: request.dependencyType,
        reason: request.record ? "unproven_installation" : "missing_installation"
      });
      if (from === undefined) rootUnknown = true;
      else unknown.add(from);
      if (!request.record) return true;
    }
    const record = request.record!;
    const source = input.node(record);
    const current = nodes.get(source.id);
    const installNames = [...new Set([...(current?.installNames ?? []),
      ...(request.name === source.name ? [] : [request.name])])].sort();
    nodes.set(source.id, {
      ...source, ...current,
      dependencyType: current && rank[current.dependencyType] > rank[request.dependencyType]
        ? current.dependencyType : request.dependencyType,
      direct: current?.direct === true || from === undefined,
      paths: current?.paths ?? [[input.graph.rootName ?? "<root>",
        ...(from === undefined ? [] : [BOUNDED_PATHS_TRUNCATED_SEGMENT]), source.id]],
      ...(installNames.length ? { installNames } : {})
    });
    const edge: DependencyEdge = { ...(from === undefined ? {} : { from }), to: source.id, dependencyType: request.dependencyType };
    edges.set(JSON.stringify([from ?? null, source.id, request.dependencyType]), edge);
    if (edges.size > limit || nodes.size > BOUNDED_PATHS_MAX_DISCOVERED_NODES) return false;
    const types = scheduled.get(record) ?? new Set<DependencyType>();
    if (!types.has(request.dependencyType)) {
      types.add(request.dependencyType);
      scheduled.set(record, types);
      queue.push({ record, type: request.dependencyType });
    }
    return true;
  };
  const exceeded = (): Result<never, OhriskError> => err(createError({
    code: "DEPENDENCY_GRAPH_LIMIT_EXCEEDED", category: "unsupported_input",
    message: "Dependency source relationships exceeded the supported graph limits.",
    details: { edgeLimit: limit, nodeLimit: BOUNDED_PATHS_MAX_DISCOVERED_NODES }
  }));
  for (const root of input.roots) if (!add(root)) return exceeded();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor]!;
    const from = input.node(state.record).id;
    for (const child of input.children(state.record)) {
      if (!add({ ...child, dependencyType: state.type === "production" ? child.dependencyType : state.type }, from)) return exceeded();
    }
  }
  const requests = uniqueUnresolvedDependencies(unresolved);
  return ok({
    ...input.graph,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, edge]) => edge),
    ...(requests.length ? { unresolvedDependencies: requests } : {}),
    ...(unknown.size ? { unknownDependencyNodeIds: [...unknown].sort() } : {}),
    ...(rootUnknown ? { rootDependenciesUnknown: true } : {})
  });
}
