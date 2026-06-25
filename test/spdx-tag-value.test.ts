import { describe, expect, test } from "bun:test";

import { parseSpdxTagValueText } from "../src/graph/spdx-tag-value";

describe("parseSpdxTagValueText", () => {
  test("parses SPDX tag-value package graph and embedded license evidence from PURL refs", () => {
    const result = parseSpdxTagValueText(`
SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0
SPDXID: SPDXRef-DOCUMENT
DocumentName: fixture-spdx-tag-value-app
DocumentNamespace: https://example.test/spdx/fixture
DocumentDescribes: SPDXRef-Package-parent

PackageName: permissive-parent
SPDXID: SPDXRef-Package-parent
PackageVersion: 1.0.0
PackageLicenseConcluded: MIT
PackageLicenseDeclared: NOASSERTION
ExternalRef: PACKAGE-MANAGER purl pkg:npm/permissive-parent@1.0.0

PackageName: agpl-child
SPDXID: SPDXRef-Package-child
PackageVersion: 2.0.0
PackageLicenseConcluded: NOASSERTION
PackageLicenseDeclared: AGPL-3.0-only
ExternalRef: PACKAGE-MANAGER purl pkg:cargo/agpl-child@2.0.0

Relationship: SPDXRef-Package-parent DEPENDS_ON SPDXRef-Package-child
`, "sbom.spdx");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-spdx-tag-value-app");
    expect(result.value.lockfilePath).toBe("sbom.spdx");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@2.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-spdx-tag-value-app", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@2.0.0"))
      .toMatchObject({
        ecosystem: "cargo",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-spdx-tag-value-app", "permissive-parent@1.0.0", "agpl-child@2.0.0"]]
      });
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "agpl-child@2.0.0",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "SPDX",
      source: "sbom"
    }));
  });

  test("uses SPDX DESCRIBES relationships as roots", () => {
    const result = parseSpdxTagValueText(`
SPDXVersion: SPDX-2.3
SPDXID: SPDXRef-DOCUMENT
DocumentName: fixture-described-spdx-app

PackageName: described-root
SPDXID: SPDXRef-Package-described-root
PackageLicenseDeclared: MIT
ExternalRef: PACKAGE-MANAGER purl pkg:pypi/described-root@1.0.0

PackageName: described-child
SPDXID: SPDXRef-Package-described-child
PackageLicenseDeclared: Apache-2.0
ExternalRef: PACKAGE-MANAGER purl pkg:pypi/described-child@2.0.0

Relationship: SPDXRef-DOCUMENT DESCRIBES SPDXRef-Package-described-root
Relationship: SPDXRef-Package-described-child DEPENDENCY_OF SPDXRef-Package-described-root
`, "bom.spdx");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "described-root@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-described-spdx-app", "described-root@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "described-child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-described-spdx-app", "described-root@1.0.0", "described-child@2.0.0"]]
      });
  });

  test("reports documents without package PURLs as typed SPDX errors", () => {
    const result = parseSpdxTagValueText(`
SPDXVersion: SPDX-2.3
DocumentName: fixture-no-purl

PackageName: no-purl
SPDXID: SPDXRef-Package-no-purl
PackageLicenseDeclared: MIT
`, "sbom.spdx");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed SPDX tag-value document to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
  });

  test("reports malformed tag-value lines with typed SPDX errors", () => {
    const result = parseSpdxTagValueText("this is not a tag-value line", "sbom.spdx");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed SPDX tag-value syntax to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
  });

  test("reports malformed dependency relationships as unsupported input", () => {
    const result = parseSpdxTagValueText(`
SPDXVersion: SPDX-2.3
DocumentName: fixture-malformed-relationship

PackageName: parent
SPDXID: SPDXRef-Package-parent
PackageLicenseDeclared: MIT
ExternalRef: PACKAGE-MANAGER purl pkg:npm/parent@1.0.0

PackageName: child
SPDXID: SPDXRef-Package-child
PackageLicenseDeclared: MIT
ExternalRef: PACKAGE-MANAGER purl pkg:npm/child@2.0.0

Relationship: SPDXRef-Package-parent DEPENDS_ON
`, "sbom.spdx");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX tag-value dependency relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "sbom.spdx",
      line: 15,
      reason: "unsupported_spdx_dependency_relationships",
      relationshipType: "DEPENDS_ON",
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });

  test("reports malformed DESCRIBES relationships as unsupported input", () => {
    const result = parseSpdxTagValueText(`
SPDXVersion: SPDX-2.3
DocumentName: fixture-malformed-describes

PackageName: parent
SPDXID: SPDXRef-Package-parent
PackageLicenseDeclared: MIT
ExternalRef: PACKAGE-MANAGER purl pkg:npm/parent@1.0.0

Relationship: SPDXRef-DOCUMENT DESCRIBES
`, "sbom.spdx");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX tag-value DESCRIBES relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "sbom.spdx",
      line: 10,
      reason: "unsupported_spdx_describes_relationships",
      relationshipType: "DESCRIBES",
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });
});
