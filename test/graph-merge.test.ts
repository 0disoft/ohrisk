import { describe, expect, test } from "bun:test";

import { mergeDependencyGraphs } from "../src/graph/merge";

describe("mergeDependencyGraphs", () => {
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
            files: [],
            source: "sbom",
            warnings: []
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
            files: [{ path: "LICENSE", kind: "license", text: "MIT License" }],
            source: "local",
            warnings: ["second source"]
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
      source: "local",
      files: [{ path: "LICENSE", kind: "license", text: "MIT License" }],
      warnings: ["second source"]
    })]);
    expect(merged.warnings).toEqual([
      "Multiple lockfiles resolve pkg:npm/%40scope/example@1.0.0 to different artifact locations.",
      "Multiple lockfiles declare different integrity values for pkg:npm/%40scope/example@1.0.0."
    ]);
  });
});
