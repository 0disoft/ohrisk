import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph, DependencyNode } from "./types";

export function refineGoDependencyScopes(
  graph: DependencyGraph,
  evidence: LicenseEvidence[]
): DependencyGraph {
  const goNodes = graph.nodes.filter((node) => node.ecosystem === "go");
  if (goNodes.length === 0) {
    return graph;
  }

  const evidenceById = new Map(evidence.map((item) => [item.packageId, item]));
  const missingEdgeNodes = goNodes.filter((node) =>
    evidenceById.get(node.id)?.goModuleRequirements === undefined
  );
  if (missingEdgeNodes.length > 0) {
    return graph;
  }

  const uniqueNodeByModulePath = uniqueGoNodeByModulePath(goNodes);
  const adjacency = new Map<string, string[]>();
  for (const node of goNodes) {
    const requirements = evidenceById.get(node.id)?.goModuleRequirements ?? [];
    adjacency.set(node.id, requirements
      .map((modulePath) => uniqueNodeByModulePath.get(modulePath)?.id)
      .filter((id): id is string => id !== undefined)
      .sort());
  }

  const productionPaths = traverseGoModuleGraph(
    goNodes.filter((node) => node.direct && node.dependencyType !== "development"),
    adjacency
  );
  const developmentPaths = traverseGoModuleGraph(
    goNodes.filter((node) => node.direct && node.dependencyType === "development"),
    adjacency
  );

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.ecosystem !== "go") {
        return node;
      }
      const productionPath = productionPaths.get(node.id);
      const developmentPath = developmentPaths.get(node.id);
      if (developmentPath && !productionPath) {
        return {
          ...node,
          dependencyType: "development",
          paths: [developmentPath]
        };
      }
      return productionPath && !node.direct
        ? { ...node, paths: [productionPath] }
        : node;
    })
  };
}

function uniqueGoNodeByModulePath(nodes: DependencyNode[]): Map<string, DependencyNode> {
  const byModulePath = new Map<string, DependencyNode | undefined>();
  for (const node of nodes) {
    byModulePath.set(
      node.name,
      byModulePath.has(node.name) ? undefined : node
    );
  }
  return new Map(
    [...byModulePath.entries()]
      .filter((entry): entry is [string, DependencyNode] => entry[1] !== undefined)
  );
}

function traverseGoModuleGraph(
  roots: DependencyNode[],
  adjacency: ReadonlyMap<string, string[]>
): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  const queue = [...roots]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      path: [...node.paths]
        .sort((left, right) => left.length - right.length || left.join("\0").localeCompare(right.join("\0")))[0]
        ?? ["<go-module>", node.id]
    }));

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current || paths.has(current.id)) {
      continue;
    }
    paths.set(current.id, current.path);
    for (const childId of adjacency.get(current.id) ?? []) {
      if (!paths.has(childId)) {
        queue.push({ id: childId, path: [...current.path, childId] });
      }
    }
  }

  return paths;
}
