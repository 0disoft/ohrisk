import { describe, expect, test } from "bun:test";

import { filterGraphBeforeEvidence } from "../src/cli/main";
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
