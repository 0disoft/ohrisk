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

  test("merges duplicate dependency relationships without dropping child edges", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-duplicate-relationships",
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
          SPDXID: "SPDXRef-Package-child-a",
          name: "child-a",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/child-a@2.0.0"
            }
          ]
        },
        {
          SPDXID: "SPDXRef-Package-child-b",
          name: "child-b",
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/child-b@3.0.0"
            }
          ]
        }
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-Package-parent",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Package-child-a"
        },
        {
          spdxElementId: "SPDXRef-Package-parent",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Package-child-b"
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "child-a@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-duplicate-relationships", "parent@1.0.0", "child-a@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child-b@3.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-duplicate-relationships", "parent@1.0.0", "child-b@3.0.0"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-cycle",
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
      relationships: [
        {
          spdxElementId: "SPDXRef-Package-parent",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Package-child"
        },
        {
          spdxElementId: "SPDXRef-Package-child",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Package-parent"
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-spdx-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
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

  test("bounds combinatorial path explosion in diamond DAGs with a typed diagnostic", () => {
    const result = parseSpdxJsonText(buildSpdxDiamondFixture(14), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const maxPaths = Math.max(...result.value.nodes.map((node) => node.paths.length));
    expect(maxPaths).toBeLessThanOrEqual(64);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated"
    }));
  });

  test("does not overflow the call stack on deep SPDX chains", () => {
    const fixture = buildSpdxChainFixture(20_000);
    let result: ReturnType<typeof parseSpdxJsonText> | undefined;

    expect(() => {
      result = parseSpdxJsonText(fixture, "spdx.json");
    }).not.toThrow();

    const parsed = result as ReturnType<typeof parseSpdxJsonText>;
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.value.nodes.length).toBe(20_000);
    expect(parsed.value.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });

  test("keeps saved paths deterministic under relationship order changes", () => {
    const forward = parseSpdxJsonText(buildSpdxDiamondFixture(6, false), "spdx.json");
    const reversed = parseSpdxJsonText(buildSpdxDiamondFixture(6, true), "spdx.json");

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) {
      throw new Error("Fixture parse failed.");
    }

    expect(reversed.value.nodes.map((node) => ({ id: node.id, paths: node.paths })))
      .toEqual(forward.value.nodes.map((node) => ({ id: node.id, paths: node.paths })));
  });

  test("deduplicates wide star relationships without duplicate stored paths", () => {
    const result = parseSpdxJsonText(buildSpdxStarFixture(64, false), "spdx.json");
    const duplicated = parseSpdxJsonText(buildSpdxStarFixture(64, true), "spdx.json");

    expect(result.ok).toBe(true);
    expect(duplicated.ok).toBe(true);
    if (!result.ok || !duplicated.ok) {
      throw new Error("Fixture parse failed.");
    }

    expect(result.value.nodes.length).toBe(65);
    expect(result.value.diagnostics?.length ?? 0).toBe(0);
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBe(1);
    }
    expect(duplicated.value.nodes.map((node) => ({ id: node.id, paths: node.paths })))
      .toEqual(result.value.nodes.map((node) => ({ id: node.id, paths: node.paths })));
  });
});

function buildSpdxDiamondFixture(depth: number, reverseOrder = false): string {
  const packages: Array<Record<string, unknown>> = [];
  const relationships: Array<Record<string, string>> = [];
  const levelIds: string[][] = [];
  let counter = 0;

  for (let level = 0; level <= depth; level += 1) {
    const ids: string[] = [];
    for (let index = 0; index < 2 ** level; index += 1) {
      const spdxId = `SPDXRef-diamond-${counter}`;
      ids.push(spdxId);
      packages.push(spdxPackage(spdxId, `diamond-${counter}`, `1.0.${counter}`));
      counter += 1;
    }
    levelIds.push(ids);
  }

  const sinkId = `SPDXRef-diamond-${counter}`;
  packages.push(spdxPackage(sinkId, `diamond-${counter}`, `1.0.${counter}`));

  for (let level = 0; level < depth; level += 1) {
    for (const [index, spdxId] of levelIds[level].entries()) {
      relationships.push({
        spdxElementId: spdxId,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: levelIds[level + 1][index * 2]
      });
      relationships.push({
        spdxElementId: spdxId,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: levelIds[level + 1][index * 2 + 1]
      });
    }
  }
  for (const spdxId of levelIds[depth]) {
    relationships.push({
      spdxElementId: spdxId,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: sinkId
    });
  }

  if (reverseOrder) {
    relationships.reverse();
  }

  return JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "fixture-spdx-diamond",
    documentDescribes: [levelIds[0][0]],
    packages,
    relationships
  });
}

function buildSpdxChainFixture(length: number): string {
  const packages: Array<Record<string, unknown>> = [];
  const relationships: Array<Record<string, string>> = [];
  for (let index = 0; index < length; index += 1) {
    packages.push(spdxPackage(`SPDXRef-chain-${index}`, `chain-${index}`, `1.0.${index}`));
    if (index > 0) {
      relationships.push({
        spdxElementId: `SPDXRef-chain-${index - 1}`,
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: `SPDXRef-chain-${index}`
      });
    }
  }

  return JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "fixture-spdx-chain",
    documentDescribes: ["SPDXRef-chain-0"],
    packages,
    relationships
  });
}

function buildSpdxStarFixture(childCount: number, duplicateEdges = false): string {
  const packages: Array<Record<string, unknown>> = [];
  const relationships: Array<Record<string, string>> = [];
  packages.push(spdxPackage("SPDXRef-star-root", "star-root", "1.0.0"));
  for (let index = 0; index < childCount; index += 1) {
    packages.push(spdxPackage(`SPDXRef-star-${index}`, `star-${index}`, `1.0.${index}`));
    relationships.push({
      spdxElementId: "SPDXRef-star-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: `SPDXRef-star-${index}`
    });
    if (duplicateEdges) {
      relationships.push({
        spdxElementId: "SPDXRef-star-root",
        relationshipType: "DEPENDS_ON",
        relatedSpdxElement: `SPDXRef-star-${index}`
      });
    }
  }

  return JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "fixture-spdx-star",
    documentDescribes: ["SPDXRef-star-root"],
    packages,
    relationships
  });
}

function spdxPackage(spdxId: string, name: string, version: string): Record<string, unknown> {
  return {
    SPDXID: spdxId,
    name,
    externalRefs: [
      {
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: `pkg:npm/${name}@${version}`
      }
    ]
  };
}
