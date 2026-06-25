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

  test("treats lowercase SPDX absent-license markers as unusable license evidence", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-lowercase-absent",
      documentDescribes: ["SPDXRef-Package-lowercase-absent"],
      packages: [
        {
          SPDXID: "SPDXRef-Package-lowercase-absent",
          name: "lowercase-absent",
          licenseDeclared: "noassertion",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/lowercase-absent@1.0.0"
            }
          ]
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const evidence = result.value.embeddedEvidence?.find((item) =>
      item.packageId === "lowercase-absent@1.0.0"
    );
    expect(evidence).toMatchObject({
      packageId: "lowercase-absent@1.0.0",
      metadataSource: "SPDX",
      source: "sbom",
      warnings: ["SPDX package did not declare usable license evidence."]
    });
    expect(evidence).not.toHaveProperty("metadataLicense");
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

  test("reports malformed dependency relationships as unsupported input", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-malformed-relationship",
      packages: [
        {
          SPDXID: "SPDXRef-Package-parent",
          name: "parent",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/parent@1.0.0"
            }
          ]
        },
        {
          SPDXID: "SPDXRef-Package-child",
          name: "child",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/child@2.0.0"
            }
          ]
        }
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-Package-parent",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: { id: "SPDXRef-Package-child" }
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX dependency relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "spdx.json",
      reason: "unsupported_spdx_dependency_relationships",
      relationshipIndexes: [0],
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });

  test("reports non-array dependency relationships as unsupported input", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-non-array-relationships",
      documentDescribes: ["SPDXRef-Package-parent"],
      packages: [
        {
          SPDXID: "SPDXRef-Package-parent",
          name: "parent",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/parent@1.0.0"
            }
          ]
        },
        {
          SPDXID: "SPDXRef-Package-child",
          name: "child",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/child@2.0.0"
            }
          ]
        }
      ],
      relationships: {
        spdxElementId: "SPDXRef-Package-parent",
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: "SPDXRef-Package-child"
      }
    }), "spdx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX dependency relationships to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "spdx.json",
      reason: "unsupported_spdx_dependency_relationships",
      relationshipIndexes: [],
      unsupportedRelationshipFields: ["relationships"]
    });
  });

  test("reports malformed DESCRIBES relationships as unsupported input", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-malformed-describes",
      packages: [
        {
          SPDXID: "SPDXRef-Package-parent",
          name: "parent",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/parent@1.0.0"
            }
          ]
        }
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: { id: "SPDXRef-Package-parent" }
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX DESCRIBES relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "spdx.json",
      reason: "unsupported_spdx_describes_relationships",
      relationshipIndexes: [0],
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });
});
