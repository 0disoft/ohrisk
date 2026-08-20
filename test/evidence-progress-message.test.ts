import { describe, expect, test } from "bun:test";

import { evidenceCollectionStartMessage } from "../src/cli/evidence-progress-message";
import type { DependencyGraph, DependencyNode } from "../src/graph/types";

describe("evidence collection progress message", () => {
  test("suggests production-only collection for a large development-heavy graph", () => {
    const graph = graphWithNodes([
      ...nodes("development", 200),
      ...nodes("production", 100)
    ]);

    expect(evidenceCollectionStartMessage(graph, false)).toBe(
      "Collecting license evidence for 300 packages... 200 are development-only; use --prod only when those packages are outside the deployment scope."
    );
  });

  test("keeps the ordinary message for small or already production-only scans", () => {
    const graph = graphWithNodes(nodes("development", 300));

    expect(evidenceCollectionStartMessage(graphWithNodes(nodes("development", 20)), false))
      .toBe("Collecting license evidence for 20 packages...");
    expect(evidenceCollectionStartMessage(graph, true))
      .toBe("Collecting license evidence for 300 packages...");
  });
});

function graphWithNodes(nodes: DependencyNode[]): DependencyGraph {
  return { lockfilePath: "package-lock.json", nodes };
}

function nodes(
  dependencyType: DependencyNode["dependencyType"],
  count: number
): DependencyNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `package-${dependencyType}-${index}@1.0.0`,
    name: `package-${dependencyType}-${index}`,
    version: "1.0.0",
    ecosystem: "npm",
    dependencyType,
    direct: false,
    paths: [["root", `package-${dependencyType}-${index}@1.0.0`]]
  }));
}
