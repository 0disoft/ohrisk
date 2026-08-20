import type { DependencyGraph } from "../graph/types";

const LARGE_EVIDENCE_GRAPH_SIZE = 256;
const LARGE_DEVELOPMENT_NODE_COUNT = 128;

export function evidenceCollectionStartMessage(
  graph: DependencyGraph,
  prodOnly: boolean
): string {
  const base = `Collecting license evidence for ${graph.nodes.length} packages...`;
  if (prodOnly || graph.nodes.length < LARGE_EVIDENCE_GRAPH_SIZE) {
    return base;
  }

  const developmentCount = graph.nodes.reduce(
    (count, node) => count + (node.dependencyType === "development" ? 1 : 0),
    0
  );
  if (developmentCount < LARGE_DEVELOPMENT_NODE_COUNT) {
    return base;
  }

  return `${base} ${developmentCount} are development-only; use --prod only when those packages are outside the deployment scope.`;
}
