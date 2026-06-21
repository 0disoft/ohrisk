import { describe, expect, test } from "bun:test";

import { parseSpdxJsonText } from "../src/graph/spdx-json";

describe("parseSpdxJsonText", () => {
  test("parses SPDX package graph and embedded license evidence from PURL refs", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-app",
      documentDescribes: ["SPDXRef-Package-parent"],
      packages: [
        {
          SPDXID: "SPDXRef-Package-parent",
          name: "permissive-parent",
          licenseConcluded: "MIT",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/permissive-parent@1.0.0"
            }
          ]
        },
        {
          SPDXID: "SPDXRef-Package-child",
          name: "agpl-child",
          licenseConcluded: "NOASSERTION",
          licenseDeclared: "AGPL-3.0-only",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:cargo/agpl-child@2.0.0"
            }
          ]
        }
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-Package-parent",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Package-child"
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-spdx-app");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@2.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-spdx-app", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@2.0.0"))
      .toMatchObject({
        ecosystem: "cargo",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-spdx-app", "permissive-parent@1.0.0", "agpl-child@2.0.0"]]
      });
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "agpl-child@2.0.0",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "SPDX",
      source: "sbom"
    }));
  });

  test("reports documents without package PURLs as typed SPDX errors", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      packages: [{ SPDXID: "SPDXRef-Package-no-purl", name: "no-purl" }]
    }), "spdx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed SPDX document to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
  });
});
