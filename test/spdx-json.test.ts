import { describe, expect, test } from "bun:test";

import { BOUNDED_PATHS_MAX_PATHS_PER_NODE } from "../src/graph/bounded-dependency-paths";
import { parseSpdxJsonText } from "../src/graph/spdx-json";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import { buildFindingId } from "../src/policy/finding-id";

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

  test("preserves conflicting SPDX declared and concluded license assertions", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-conflicting-assertions",
      documentDescribes: ["SPDXRef-Package-conflict"],
      packages: [{
        SPDXID: "SPDXRef-Package-conflict",
        name: "conflicting-package",
        licenseConcluded: "MIT",
        licenseDeclared: "AGPL-3.0-only",
        externalRefs: [{
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:npm/conflicting-package@1.0.0"
        }]
      }]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const evidence = result.value.embeddedEvidence?.[0];
    expect(evidence).toMatchObject({
      packageId: "conflicting-package@1.0.0",
      sbomConcludedLicense: "MIT",
      sbomDeclaredLicense: "AGPL-3.0-only",
      conflictingLicenseClaims: ["AGPL-3.0-only", "MIT"]
    });
    expect(normalizeLicenseEvidence(evidence!)).toMatchObject({
      confidence: "low",
      signals: ["conflicting-evidence"]
    });
  });

  test("uses extracted LicenseRef text as package evidence", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-extracted-license",
      documentDescribes: ["SPDXRef-Package-custom"],
      hasExtractedLicensingInfos: [{
        licenseId: "LicenseRef-Commercial",
        extractedText: "Commercial use is prohibited."
      }],
      packages: [{
        SPDXID: "SPDXRef-Package-custom",
        name: "custom-package",
        licenseDeclared: "LicenseRef-Commercial",
        externalRefs: [{
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:npm/custom-package@1.0.0"
        }]
      }]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const evidence = result.value.embeddedEvidence?.[0];
    expect(evidence?.files).toEqual([{
      path: "spdx-license-ref/LicenseRef-Commercial.txt",
      kind: "license",
      text: "Commercial use is prohibited."
    }]);
    expect(normalizeLicenseEvidence(evidence!).signals).toContain("commercial-restriction");
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
    expect(maxPaths).toBeLessThanOrEqual(BOUNDED_PATHS_MAX_PATHS_PER_NODE);
    expect(maxPaths).toBe(BOUNDED_PATHS_MAX_PATHS_PER_NODE);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated"
    }));
  });

  test("keeps every dependency and embedded evidence under a tiny stored-path budget", () => {
    const result = parseSpdxJsonText(
      buildSpdxDiamondFixture(2, false),
      "spdx.json",
      { limits: { maxTraversalPaths: 1 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.length).toBe(8);
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBeGreaterThan(0);
    }
    expect(result.value.embeddedEvidence?.length ?? 0).toBe(8);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 1
    }));
  });

  test("keeps every dependency and embedded evidence under a tiny segment budget", () => {
    const result = parseSpdxJsonText(
      buildSpdxDiamondFixture(2, false),
      "spdx.json",
      { limits: { maxStoredPathSegments: 8 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.length).toBe(8);
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBeGreaterThan(0);
    }
    expect(result.value.embeddedEvidence?.length ?? 0).toBe(8);
    expect(result.value.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });

  test("keeps multi-parent path union at shallow convergence points", () => {
    const result = parseSpdxJsonText(buildSpdxConvergingFixture(false), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const shared = result.value.nodes.find((node) => node.id === "shared@1.0.2");
    expect(shared?.paths).toEqual([
      ["fixture-spdx-converging", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"],
      ["fixture-spdx-converging", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"]
    ]);
    expect(result.value.diagnostics ?? []).toEqual([]);
  });

  test("keeps finding IDs stable under relationship order changes", () => {
    const forward = parseSpdxJsonText(buildSpdxConvergingFixture(false), "spdx.json");
    const reversed = parseSpdxJsonText(buildSpdxConvergingFixture(true), "spdx.json");

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) {
      throw new Error("Fixture parse failed.");
    }

    const findingIds = (result: typeof forward): string[] => result.value.nodes.map((node) =>
      buildFindingId({
        packageId: node.id,
        dependencyType: node.dependencyType,
        dependencyScope: node.direct ? "direct" : "transitive",
        paths: node.paths
      })
    );
    expect(findingIds(reversed)).toEqual(findingIds(forward));
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

  test("parses a wide SPDX star with duplicate relationships without duplicate paths", () => {
    const result = parseSpdxJsonText(
      buildSpdxStarFixture(12_000, true),
      "spdx.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.length).toBe(12_001);
    expect(result.value.embeddedEvidence?.length ?? 0).toBe(12_001);
    for (const node of result.value.nodes) {
      const keys = new Set(node.paths.map((path) => path.join("\u0000")));
      expect(keys.size).toBe(node.paths.length);
      expect(node.paths.length).toBe(1);
    }
    const root = result.value.nodes.find((node) => node.id === "star-root@1.0.0");
    expect(root?.paths).toEqual([["fixture-spdx-star", "star-root@1.0.0"]]);
  });

  test("normalizes inverse DEPENDENCY_OF relationships onto the described root", () => {
    const result = parseSpdxJsonText(JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "fixture-spdx-inverse",
      documentDescribes: ["SPDXRef-root"],
      packages: [
        spdxPackage("SPDXRef-root", "root", "1.0.0"),
        spdxPackage("SPDXRef-child", "child", "2.0.0")
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-child",
          relationshipType: "DEPENDENCY_OF",
          relatedSpdxElement: "SPDXRef-root"
        }
      ]
    }), "spdx.json");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-inverse", "root@1.0.0", "child@2.0.0"]]
      });
  });

  test("keeps graph, paths, diagnostics, and finding IDs stable under relationship ordering", () => {
    const forward = parseSpdxJsonText(buildSpdxOrderingFixture("forward"), "spdx.json");
    const reversed = parseSpdxJsonText(buildSpdxOrderingFixture("reverse"), "spdx.json");
    const shuffled = parseSpdxJsonText(buildSpdxOrderingFixture("shuffle"), "spdx.json");

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    expect(shuffled.ok).toBe(true);
    if (!forward.ok || !reversed.ok || !shuffled.ok) {
      throw new Error("Fixture parse failed.");
    }

    const canonical = (result: typeof forward): unknown[] => [
      result.value.nodes.map((node) => ({ id: node.id, paths: node.paths })),
      result.value.diagnostics,
      result.value.nodes.map((node) => buildFindingId({
        packageId: node.id,
        dependencyType: node.dependencyType,
        dependencyScope: node.direct ? "direct" : "transitive",
        paths: node.paths
      }))
    ];
    expect(canonical(reversed)).toEqual(canonical(forward));
    expect(canonical(shuffled)).toEqual(canonical(forward));
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

function buildSpdxConvergingFixture(reverseOrder = false): string {
  const relationships: Array<Record<string, string>> = [
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-mid-a"
    },
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-mid-b"
    },
    {
      spdxElementId: "SPDXRef-mid-a",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-shared"
    },
    {
      spdxElementId: "SPDXRef-mid-b",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-shared"
    }
  ];

  return JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "fixture-spdx-converging",
    documentDescribes: ["SPDXRef-root"],
    packages: [
      spdxPackage("SPDXRef-root", "root", "1.0.0"),
      spdxPackage("SPDXRef-mid-a", "mid-a", "1.0.0"),
      spdxPackage("SPDXRef-mid-b", "mid-b", "1.0.1"),
      spdxPackage("SPDXRef-shared", "shared", "1.0.2")
    ],
    relationships: reverseOrder ? relationships.reverse() : relationships
  });
}

function buildSpdxOrderingFixture(order: "forward" | "reverse" | "shuffle"): string {
  const relationships: Array<Record<string, string>> = [
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-mid-a"
    },
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-mid-b"
    },
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-dup-child"
    },
    {
      spdxElementId: "SPDXRef-root",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-dup-child"
    },
    {
      spdxElementId: "SPDXRef-mid-a",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-shared"
    },
    {
      spdxElementId: "SPDXRef-mid-b",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-shared"
    },
    {
      spdxElementId: "SPDXRef-shared",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-leaf"
    },
    {
      spdxElementId: "SPDXRef-leaf",
      relationshipType: "DEPENDENCY_OF",
      relatedSpdxElement: "SPDXRef-shared"
    }
  ];
  const ordered = order === "forward"
    ? relationships
    : order === "reverse"
      ? [...relationships].reverse()
      : shuffledRelationships(relationships);

  return JSON.stringify({
    spdxVersion: "SPDX-2.3",
    name: "fixture-spdx-ordering",
    documentDescribes: ["SPDXRef-root"],
    packages: [
      spdxPackage("SPDXRef-root", "root", "1.0.0"),
      spdxPackage("SPDXRef-mid-a", "mid-a", "1.0.0"),
      spdxPackage("SPDXRef-mid-b", "mid-b", "1.0.1"),
      spdxPackage("SPDXRef-dup-child", "dup-child", "1.0.2"),
      spdxPackage("SPDXRef-shared", "shared", "1.0.3"),
      spdxPackage("SPDXRef-leaf", "leaf", "1.0.4")
    ],
    relationships: ordered
  });
}

function shuffledRelationships(
  relationships: Array<Record<string, string>>
): Array<Record<string, string>> {
  const result = [...relationships];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = (index * 7 + 1) % (index + 1);
    const current = result[index];
    result[index] = result[swapIndex] ?? result[index];
    result[swapIndex] = current;
  }
  return result;
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
