import { describe, expect, test } from "bun:test";

import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../src/graph/merge";

describe("mergeDependencyGraphs", () => {
  test("preserves standalone Go module integrity across merged graphs", () => {
    const node = {
      id: "example.com/module@v1.0.0",
      name: "example.com/module",
      version: "v1.0.0",
      ecosystem: "go" as const,
      integrity: `h1:${"A".repeat(43)}=`,
      dependencyType: "production" as const,
      direct: true,
      paths: [["workspace", "example.com/module@v1.0.0"]]
    };
    const merged = mergeDependencyGraphs([
      {
        source: { lockfileKind: "go-work", lockfilePath: "/repo/go.work" },
        graph: {
          rootName: "workspace",
          lockfilePath: "/repo/go.work",
          nodes: [{
            ...node,
            goModIntegrity: `h1:${"B".repeat(43)}=`
          }]
        }
      },
      {
        source: { lockfileKind: "go-mod", lockfilePath: "/repo/app/go.mod" },
        graph: {
          rootName: "workspace",
          lockfilePath: "/repo/app/go.mod",
          nodes: [node]
        }
      }
    ]);

    expect(merged.nodes[0]?.goModIntegrity).toBe(`h1:${"B".repeat(43)}=`);
  });

  test("deduplicates by Package URL and preserves paths, evidence, and provenance", () => {
    const merged = mergeDependencyGraphs([
      {
        source: { lockfileKind: "package-lock", lockfilePath: "/repo/package-lock.json" },
        graph: {
          rootName: "app",
          lockfilePath: "/repo/package-lock.json",
          nodes: [{
            id: "@scope/example@1.0.0",
            name: "@scope/example",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.npmjs.org/example-a.tgz",
            integrity: "sha512-a",
            dependencyType: "production",
            direct: true,
            paths: [["app", "@scope/example@1.0.0"]]
          }],
          embeddedEvidence: [{
            packageId: "@scope/example@1.0.0",
            metadataLicense: "MIT",
            goModuleRequirements: ["example.com/left"],
            files: [],
            source: "sbom",
            warnings: []
          }],
          diagnostics: [{
            code: "dependency_paths_truncated",
            affectedNodeCount: 2,
            limit: 64,
            message: "CycloneDX dependency paths were limited."
          }]
        }
      },
      {
        source: { lockfileKind: "npm-shrinkwrap", lockfilePath: "/repo/npm-shrinkwrap.json" },
        graph: {
          rootName: "app",
          lockfilePath: "/repo/npm-shrinkwrap.json",
          nodes: [{
            id: "alias-name@1.0.0",
            name: "@scope/example",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.npmjs.org/example-b.tgz",
            integrity: "sha512-b",
            dependencyType: "development",
            direct: false,
            paths: [["app", "parent@2.0.0", "alias-name@1.0.0"]]
          }],
          embeddedEvidence: [{
            packageId: "alias-name@1.0.0",
            goModuleRequirements: ["example.com/right"],
            files: [{ path: "LICENSE", kind: "license", text: "MIT License" }],
            source: "local",
            warnings: ["second source"]
          }],
          diagnostics: [{
            code: "dependency_paths_truncated",
            affectedNodeCount: 3,
            limit: 64,
            message: "CycloneDX dependency paths were limited."
          }]
        }
      }
    ]);

    expect(merged.lockfilePaths).toEqual([
      "/repo/package-lock.json",
      "/repo/npm-shrinkwrap.json"
    ]);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      id: "@scope/example@1.0.0",
      dependencyType: "production",
      direct: true,
      paths: [
        ["app", "@scope/example@1.0.0"],
        ["app", "parent@2.0.0", "@scope/example@1.0.0"]
      ],
      origins: [
        { lockfileKind: "package-lock", lockfilePath: "/repo/package-lock.json" },
        { lockfileKind: "npm-shrinkwrap", lockfilePath: "/repo/npm-shrinkwrap.json" }
      ]
    });
    expect(merged.embeddedEvidence).toEqual([expect.objectContaining({
      packageId: "@scope/example@1.0.0",
      metadataLicense: "MIT",
      goModuleRequirements: ["example.com/left", "example.com/right"],
      source: "local",
      files: [{ path: "LICENSE", kind: "license", text: "MIT License" }],
      warnings: ["second source"]
    })]);
    expect(merged.diagnostics).toEqual([{
      code: "dependency_paths_truncated",
      affectedNodeCount: 5,
      limit: 64,
      message: "CycloneDX dependency paths were limited."
    }]);
    expect(merged.warnings).toEqual([
      "Multiple lockfiles resolve pkg:npm/%40scope/example@1.0.0 to different artifact locations.",
      "Multiple lockfiles declare different integrity values for pkg:npm/%40scope/example@1.0.0."
    ]);
  });

  test("preserves conflicting license claims from different artifacts", () => {
    const merged = mergeDependencyGraphs([
      graphWithMetadataLicense("MIT"),
      graphWithMetadataLicense("AGPL-3.0-only")
    ]);

    expect(merged.embeddedEvidence).toEqual([expect.objectContaining({
      metadataLicense: "AGPL-3.0-only",
      conflictingLicenseClaims: ["AGPL-3.0-only", "MIT"]
    })]);
  });

  test("keeps conflicting license claim merging order-independent", () => {
    const forward = mergeDependencyGraphs([
      graphWithMetadataLicense("MIT"),
      graphWithMetadataLicense("AGPL-3.0-only")
    ]);
    const reversed = mergeDependencyGraphs([
      graphWithMetadataLicense("AGPL-3.0-only"),
      graphWithMetadataLicense("MIT")
    ]);

    expect(forward.embeddedEvidence).toEqual(reversed.embeddedEvidence);
  });

  test("deduplicates identical license claims across artifacts", () => {
    const merged = mergeDependencyGraphs([
      graphWithMetadataLicense("MIT"),
      graphWithMetadataLicense("MIT")
    ]);

    expect(merged.embeddedEvidence).toEqual([expect.objectContaining({
      metadataLicense: "MIT"
    })]);
    expect(merged.embeddedEvidence?.[0]).not.toHaveProperty("conflictingLicenseClaims");
  });

  test("does not treat an identical multi-claim license field as a conflict", () => {
    const graph = graphWithMetadataLicense("MIT");
    const left = structuredClone(graph);
    const right = structuredClone(graph);
    left.graph.embeddedEvidence = [{
      packageId: "@scope/example@1.0.0",
      metadataLicenses: ["MIT", "Apache-2.0"],
      files: [],
      source: "sbom" as const,
      warnings: []
    }];
    right.graph.embeddedEvidence = [{
      packageId: "@scope/example@1.0.0",
      metadataLicenses: ["MIT", "Apache-2.0"],
      files: [],
      source: "sbom" as const,
      warnings: []
    }];

    const merged = mergeDependencyGraphs([left, right]);

    expect(merged.embeddedEvidence?.[0]).not.toHaveProperty("conflictingLicenseClaims");
    expect(merged.embeddedEvidence?.[0].metadataLicenses).toEqual(["MIT", "Apache-2.0"]);
  });
});

function graphWithMetadataLicense(metadataLicense: string): SourcedDependencyGraph {
  const id = "@scope/example@1.0.0";
  return {
    source: {
      lockfileKind: metadataLicense === "MIT"
        ? "package-lock" as const
        : "npm-shrinkwrap" as const,
      lockfilePath: metadataLicense === "MIT"
        ? "/repo/package-lock.json"
        : "/repo/npm-shrinkwrap.json"
    },
    graph: {
      rootName: "app",
      lockfilePath: metadataLicense === "MIT"
        ? "/repo/package-lock.json"
        : "/repo/npm-shrinkwrap.json",
      nodes: [{
        id,
        name: "@scope/example",
        version: "1.0.0",
        ecosystem: "npm" as const,
        resolved: metadataLicense === "MIT"
          ? "https://registry.npmjs.org/example-a.tgz"
          : "https://registry.npmjs.org/example-b.tgz",
        integrity: metadataLicense === "MIT" ? "sha512-a" : "sha512-b",
        dependencyType: "production" as const,
        direct: true,
        paths: [[`app`, id]]
      }],
      embeddedEvidence: [{
        packageId: id,
        metadataLicense,
        files: [],
        source: "sbom" as const,
        warnings: []
      }]
    }
  };
}
