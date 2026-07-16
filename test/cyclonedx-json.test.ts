import { describe, expect, test } from "bun:test";

import {
  CYCLONEDX_MAX_DEPENDENCY_DEPTH,
  CYCLONEDX_MAX_PATHS_PER_COMPONENT,
  parseCycloneDxJsonText
} from "../src/graph/cyclonedx-json";

describe("parseCycloneDxJsonText", () => {
  test("parses dependency graph and embedded license evidence from CycloneDX JSON", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: {
          name: "fixture-cyclonedx-app",
          "bom-ref": "root-app"
        }
      },
      components: [
        {
          type: "library",
          "bom-ref": "pkg:npm/permissive-parent@1.0.0",
          purl: "pkg:npm/permissive-parent@1.0.0",
          licenses: [{ license: { id: "MIT" } }]
        },
        {
          type: "library",
          "bom-ref": "agpl-child",
          purl: "pkg:pypi/agpl-child@2.0.0",
          scope: "optional",
          licenses: [{ expression: "AGPL-3.0-only" }]
        },
        {
          type: "library",
          "bom-ref": "dev-tool",
          purl: "pkg:maven/org.example/dev-tool@3.0.0",
          scope: "excluded",
          licenses: [{ license: { id: "GPL-3.0-only" } }]
        }
      ],
      dependencies: [
        {
          ref: "root-app",
          dependsOn: ["pkg:npm/permissive-parent@1.0.0"]
        },
        {
          ref: "pkg:npm/permissive-parent@1.0.0",
          dependsOn: ["agpl-child", "dev-tool"]
        }
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-cyclonedx-app");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@2.0.0",
      "org.example:dev-tool@3.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-cyclonedx-app", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@2.0.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "optional",
        direct: false,
        paths: [["fixture-cyclonedx-app", "permissive-parent@1.0.0", "agpl-child@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "org.example:dev-tool@3.0.0"))
      .toMatchObject({
        ecosystem: "maven",
        dependencyType: "development",
        direct: false
      });
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "agpl-child@2.0.0",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "CycloneDX",
      source: "sbom"
    }));
  });

  test("preserves CycloneDX NONE markers as embedded license evidence", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: {
          name: "fixture-cyclonedx-none",
          "bom-ref": "root-app"
        }
      },
      components: [
        {
          type: "library",
          "bom-ref": "none-child",
          purl: "pkg:npm/none-child@1.0.0",
          licenses: [{ expression: "NONE" }]
        }
      ],
      dependencies: [
        {
          ref: "root-app",
          dependsOn: ["none-child"]
        }
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "none-child@1.0.0",
      metadataLicense: "NONE",
      metadataSource: "CycloneDX",
      source: "sbom",
      warnings: []
    }));
  });

  test("merges duplicate dependency entries without dropping child edges", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: {
          name: "fixture-cyclonedx-duplicate-deps",
          "bom-ref": "root-app"
        }
      },
      components: [
        {
          type: "library",
          "bom-ref": "parent",
          purl: "pkg:npm/parent@1.0.0"
        },
        {
          type: "library",
          "bom-ref": "child-a",
          purl: "pkg:npm/child-a@2.0.0"
        },
        {
          type: "library",
          "bom-ref": "child-b",
          purl: "pkg:npm/child-b@3.0.0"
        }
      ],
      dependencies: [
        {
          ref: "root-app",
          dependsOn: ["parent"]
        },
        {
          ref: "parent",
          dependsOn: ["child-a"]
        },
        {
          ref: "parent",
          dependsOn: ["child-b"]
        }
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "child-a@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-duplicate-deps", "parent@1.0.0", "child-a@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child-b@3.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-duplicate-deps", "parent@1.0.0", "child-b@3.0.0"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: {
          name: "fixture-cyclonedx-cycle",
          "bom-ref": "root-app"
        }
      },
      components: [
        {
          type: "library",
          "bom-ref": "parent",
          purl: "pkg:npm/parent@1.0.0"
        },
        {
          type: "library",
          "bom-ref": "child",
          purl: "pkg:npm/child@2.0.0"
        }
      ],
      dependencies: [
        {
          ref: "root-app",
          dependsOn: ["parent"]
        },
        {
          ref: "parent",
          dependsOn: ["child"]
        },
        {
          ref: "child",
          dependsOn: ["parent"]
        }
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-cyclonedx-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
  });

  test("bounds path enumeration for dense dependency DAGs without dropping components", () => {
    const levels = Array.from({ length: 10 }, (_, level) => [
      `level-${level}-a`,
      `level-${level}-b`
    ]);
    const refs = levels.flat();
    const dependencies = [
      { ref: "root-app", dependsOn: levels[0] },
      ...levels.flatMap((level, index) => level.map((ref) => ({
        ref,
        dependsOn: levels[index + 1] ?? []
      })))
    ];
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      metadata: { component: { name: "dense-app", "bom-ref": "root-app" } },
      components: refs.map((ref) => ({
        type: "library",
        "bom-ref": ref,
        purl: `pkg:npm/${ref}@1.0.0`
      })),
      dependencies
    }), "dense.cdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength(refs.length);
    expect(Math.max(...result.value.nodes.map((node) => node.paths.length)))
      .toBe(CYCLONEDX_MAX_PATHS_PER_COMPONENT);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: CYCLONEDX_MAX_PATHS_PER_COMPONENT
    }));
  });

  test("summarizes dependency paths deeper than the parser budget without recursion failure", () => {
    const refs = Array.from(
      { length: CYCLONEDX_MAX_DEPENDENCY_DEPTH + 8 },
      (_, index) => `depth-${index}`
    );
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      metadata: { component: { name: "deep-app", "bom-ref": "root-app" } },
      components: refs.map((ref) => ({
        type: "library",
        "bom-ref": ref,
        purl: `pkg:npm/${ref}@1.0.0`
      })),
      dependencies: [
        { ref: "root-app", dependsOn: [refs[0]] },
        ...refs.map((ref, index) => ({ ref, dependsOn: refs[index + 1] ? [refs[index + 1]] : [] }))
      ]
    }), "deep.cdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength(refs.length);
    const deepestNode = result.value.nodes.find((node) => node.id === `${refs.at(-1)}@1.0.0`);
    expect(deepestNode?.paths).toEqual([
      ["deep-app", "<cyclonedx-path-truncated>", `${refs.at(-1)}@1.0.0`]
    ]);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_path_depth_summarized",
      limit: CYCLONEDX_MAX_DEPENDENCY_DEPTH
    }));
  });

  test("reports malformed documents as typed CycloneDX errors", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      components: []
    }), "cyclonedx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed CycloneDX document to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
  });

  test("reports non-string dependency references as unsupported input", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [
        {
          type: "library",
          "bom-ref": "parent",
          purl: "pkg:npm/parent@1.0.0"
        },
        {
          type: "library",
          "bom-ref": "child",
          purl: "pkg:npm/child@2.0.0"
        }
      ],
      dependencies: [
        {
          ref: "parent",
          dependsOn: ["child", true, { ref: "hidden-child" }]
        }
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported CycloneDX dependency entries to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "cyclonedx.json",
      reason: "unsupported_cyclonedx_dependency_entries",
      dependencyEntryIndexes: [0],
      unsupportedDependencyValueKinds: ["boolean", "object"]
    });
  });

  test("reports malformed dependency entry shapes as unsupported input", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [
        {
          type: "library",
          "bom-ref": "parent",
          purl: "pkg:npm/parent@1.0.0"
        },
        {
          type: "library",
          "bom-ref": "child",
          purl: "pkg:npm/child@2.0.0"
        }
      ],
      dependencies: [
        {
          ref: "parent",
          dependsOn: "child"
        },
        {
          dependsOn: ["child"]
        },
        true
      ]
    }), "cyclonedx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed CycloneDX dependency entries to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "cyclonedx.json",
      reason: "unsupported_cyclonedx_dependency_entries",
      dependencyEntryIndexes: [0, 1, 2],
      unsupportedDependencyFields: ["dependsOn", "entry", "ref"]
    });
  });

  test("reports non-array dependency sections as unsupported input", () => {
    const result = parseCycloneDxJsonText(JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [
        {
          type: "library",
          "bom-ref": "parent",
          purl: "pkg:npm/parent@1.0.0"
        },
        {
          type: "library",
          "bom-ref": "child",
          purl: "pkg:npm/child@2.0.0"
        }
      ],
      dependencies: {
        ref: "parent",
        dependsOn: ["child"]
      }
    }), "cyclonedx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported CycloneDX dependency section to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "cyclonedx.json",
      reason: "unsupported_cyclonedx_dependency_entries",
      dependencyEntryIndexes: [],
      unsupportedDependencyFields: ["dependencies"]
    });
  });
});
