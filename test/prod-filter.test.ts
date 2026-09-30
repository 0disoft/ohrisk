import { describe, expect, test } from "bun:test";

import { filterGraphBeforeEvidence } from "../src/cli/main";
import { filterGraphForProdOnly } from "../src/cli/scan-policy";
import type { DependencyGraph, DependencyNode } from "../src/graph/types";

function node(input: {
  id: string;
  ecosystem: DependencyNode["ecosystem"];
  dependencyType: DependencyNode["dependencyType"];
}): DependencyNode {
  return {
    id: input.id,
    name: input.id.split("@")[0] ?? input.id,
    version: "1.0.0",
    ecosystem: input.ecosystem,
    dependencyType: input.dependencyType,
    direct: true,
    paths: [["root", input.id]]
  };
}

describe("filterGraphBeforeEvidence", () => {
  test("retains production reachability even when all stored paths use a development parent", () => {
    const runtime = node({ id: "runtime@1.0.0", ecosystem: "npm", dependencyType: "production" });
    const dev = node({ id: "dev@1.0.0", ecosystem: "npm", dependencyType: "development" });
    const shared = { ...node({ id: "shared@1.0.0", ecosystem: "npm", dependencyType: "production" }),
      direct: false, paths: [["root", dev.id, "shared@1.0.0"]] };
    const graph: DependencyGraph = {
      rootName: "root", lockfilePath: "bom.json", nodes: [runtime, dev, shared],
      edges: [
        { to: runtime.id, dependencyType: "production" }, { to: dev.id, dependencyType: "development" },
        { from: runtime.id, to: shared.id, dependencyType: "production" },
        { from: dev.id, to: shared.id, dependencyType: "production" }
      ]
    };
    const filtered = filterGraphForProdOnly(graph, true);
    expect(filtered.nodes.map((item) => item.id)).toEqual([runtime.id, shared.id]);
    expect(filtered.nodes.find((item) => item.id === shared.id)?.paths).toEqual([["root", runtime.id, shared.id]]);
    expect(filtered.nodes.find((item) => item.id === shared.id)?.direct).toBe(false);
    expect(filtered.edges).toHaveLength(2);
  });

  test("retains potentially reachable production nodes when a source adjacency is unknown", () => {
    const runtime = node({ id: "runtime@1.0.0", ecosystem: "npm", dependencyType: "production" });
    const child = { ...node({ id: "child@1.0.0", ecosystem: "npm", dependencyType: "production" }), direct: false, paths: [] };
    const graph: DependencyGraph = {
      lockfilePath: "bom.json", nodes: [runtime, child],
      edges: [{ to: runtime.id, dependencyType: "production" }], unknownDependencyNodeIds: [runtime.id]
    };
    expect(filterGraphForProdOnly(graph, true).nodes.map((item) => item.id)).toEqual([runtime.id, child.id]);
  });

  test("removes non-Go development nodes while retaining Go nodes for evidence refinement", () => {
    const graph: DependencyGraph = {
      rootName: "root",
      lockfilePath: "multiple",
      nodes: [
        node({ id: "example.com/tool@v1.0.0", ecosystem: "go", dependencyType: "development" }),
        node({ id: "runtime@1.0.0", ecosystem: "npm", dependencyType: "production" }),
        node({ id: "test-only@1.0.0", ecosystem: "npm", dependencyType: "development" })
      ]
    };

    expect(filterGraphBeforeEvidence(graph, true).nodes.map((item) => item.id)).toEqual([
      "example.com/tool@v1.0.0",
      "runtime@1.0.0"
    ]);
  });
});
