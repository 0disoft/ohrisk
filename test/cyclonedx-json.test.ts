import { describe, expect, test } from "bun:test";

import { parseCycloneDxJsonText } from "../src/graph/cyclonedx-json";

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
});
