import { describe, expect, test } from "bun:test";

import { refineGoDependencyScopes } from "../src/graph/go-scope";
import type { DependencyGraph, DependencyNode } from "../src/graph/types";
import type { LicenseEvidence } from "../src/evidence/types";

function node(input: {
  name: string;
  dependencyType: DependencyNode["dependencyType"];
  direct: boolean;
}): DependencyNode {
  const id = `${input.name}@v1.0.0`;
  return {
    id,
    name: input.name,
    version: "v1.0.0",
    ecosystem: "go",
    dependencyType: input.dependencyType,
    direct: input.direct,
    paths: [["example.com/root", id]]
  };
}

function evidence(packageId: string, requirements: string[]): LicenseEvidence {
  return {
    packageId,
    goModuleRequirements: requirements,
    files: [],
    source: "tarball",
    warnings: []
  };
}

describe("refineGoDependencyScopes", () => {
  test("marks only the verified development-root subtree as development", () => {
    const graph: DependencyGraph = {
      rootName: "example.com/root",
      lockfilePath: "go.mod",
      nodes: [
        node({ name: "example.com/runtime", dependencyType: "production", direct: true }),
        node({ name: "example.com/tool", dependencyType: "development", direct: true }),
        node({ name: "example.com/shared", dependencyType: "production", direct: false }),
        node({ name: "example.com/tool-child", dependencyType: "production", direct: false })
      ]
    };
    const evidenceItems = [
      evidence("example.com/runtime@v1.0.0", ["example.com/shared"]),
      evidence("example.com/tool@v1.0.0", ["example.com/shared", "example.com/tool-child"]),
      evidence("example.com/shared@v1.0.0", []),
      evidence("example.com/tool-child@v1.0.0", [])
    ];

    const refined = refineGoDependencyScopes(graph, evidenceItems);

    expect(refined.nodes.map((item) => ({
      id: item.id,
      dependencyType: item.dependencyType,
      paths: item.paths
    }))).toEqual([
      {
        id: "example.com/runtime@v1.0.0",
        dependencyType: "production",
        paths: [["example.com/root", "example.com/runtime@v1.0.0"]]
      },
      {
        id: "example.com/tool@v1.0.0",
        dependencyType: "development",
        paths: [["example.com/root", "example.com/tool@v1.0.0"]]
      },
      {
        id: "example.com/shared@v1.0.0",
        dependencyType: "production",
        paths: [[
          "example.com/root",
          "example.com/runtime@v1.0.0",
          "example.com/shared@v1.0.0"
        ]]
      },
      {
        id: "example.com/tool-child@v1.0.0",
        dependencyType: "development",
        paths: [[
          "example.com/root",
          "example.com/tool@v1.0.0",
          "example.com/tool-child@v1.0.0"
        ]]
      }
    ]);
  });

  test("keeps transitive scope conservative when any selected edge is unavailable", () => {
    const graph: DependencyGraph = {
      rootName: "example.com/root",
      lockfilePath: "go.mod",
      nodes: [
        node({ name: "example.com/tool", dependencyType: "development", direct: true }),
        node({ name: "example.com/tool-child", dependencyType: "production", direct: false })
      ]
    };

    const refined = refineGoDependencyScopes(graph, [
      evidence("example.com/tool@v1.0.0", ["example.com/tool-child"])
    ]);

    expect(refined.nodes.map((item) => item.dependencyType)).toEqual([
      "development",
      "production"
    ]);
  });

  test("preserves workspace module prefixes when rebuilding transitive paths", () => {
    const tool = node({ name: "example.com/tool", dependencyType: "development", direct: true });
    tool.paths = [["workspace", "example.com/module", tool.id]];
    const child = node({ name: "example.com/tool-child", dependencyType: "production", direct: false });
    child.paths = [["workspace", "example.com/module", child.id]];
    const graph: DependencyGraph = {
      rootName: "workspace",
      lockfilePath: "go.work",
      nodes: [tool, child]
    };

    const refined = refineGoDependencyScopes(graph, [
      evidence(tool.id, [child.name]),
      evidence(child.id, [])
    ]);

    expect(refined.nodes[1]?.paths).toEqual([[
      "workspace",
      "example.com/module",
      tool.id,
      child.id
    ]]);
  });

  test("promotes a shared module to production when a production root also requires it", () => {
    const graph: DependencyGraph = {
      rootName: "example.com/root",
      lockfilePath: "go.mod",
      nodes: [
        node({ name: "example.com/runtime", dependencyType: "production", direct: true }),
        node({ name: "example.com/tool", dependencyType: "development", direct: true }),
        // Source analysis classified shared as development, but the production runtime requires it.
        node({ name: "example.com/shared", dependencyType: "development", direct: false })
      ]
    };
    const evidenceItems = [
      evidence("example.com/runtime@v1.0.0", ["example.com/shared"]),
      evidence("example.com/tool@v1.0.0", ["example.com/shared"]),
      evidence("example.com/shared@v1.0.0", [])
    ];

    const refined = refineGoDependencyScopes(graph, evidenceItems);

    const shared = refined.nodes.find((item) => item.name === "example.com/shared");
    expect(shared?.dependencyType).toBe("production");
    expect(shared?.paths).toEqual([[
      "example.com/root",
      "example.com/runtime@v1.0.0",
      "example.com/shared@v1.0.0"
    ]]);
  });
});
