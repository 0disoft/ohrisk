import { describe, expect, test } from "bun:test";

import { parseSpdxRdfText } from "../src/graph/spdx-rdf";

describe("parseSpdxRdfText", () => {
  test("parses SPDX RDF package graph and embedded license evidence from PURL refs", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="">
    <spdx:name>fixture-spdx-rdf-app</spdx:name>
    <spdx:describesPackage rdf:resource="#SPDXRef-Package-parent" />
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:name>permissive-parent</spdx:name>
    <spdx:versionInfo>1.0.0</spdx:versionInfo>
    <spdx:licenseConcluded rdf:resource="http://spdx.org/licenses/MIT" />
    <spdx:externalRef>
      <spdx:ExternalRef>
        <spdx:referenceCategory rdf:resource="http://spdx.org/rdf/references/ReferenceCategoryPackageManager" />
        <spdx:referenceType rdf:resource="http://spdx.org/rdf/references/purl" />
        <spdx:referenceLocator>pkg:npm/permissive-parent@1.0.0</spdx:referenceLocator>
      </spdx:ExternalRef>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child">
    <spdx:name>agpl-child</spdx:name>
    <spdx:versionInfo>2.0.0</spdx:versionInfo>
    <spdx:licenseDeclared rdf:resource="http://spdx.org/licenses/AGPL-3.0-only" />
    <spdx:externalRef>
      <spdx:ExternalRef>
        <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
        <spdx:referenceType>purl</spdx:referenceType>
        <spdx:referenceLocator>pkg:cargo/agpl-child@2.0.0</spdx:referenceLocator>
      </spdx:ExternalRef>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType rdf:resource="http://spdx.org/rdf/terms#relationshipType_dependsOn" />
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-child" />
  </spdx:Relationship>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-spdx-rdf-app");
    expect(result.value.lockfilePath).toBe("spdx.rdf");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@2.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-spdx-rdf-app", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@2.0.0"))
      .toMatchObject({
        ecosystem: "cargo",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-spdx-rdf-app", "permissive-parent@1.0.0", "agpl-child@2.0.0"]]
      });
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "agpl-child@2.0.0",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "SPDX",
      source: "sbom"
    }));
  });

  test("uses SPDX RDF DESCRIBES relationships as roots", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="#SPDXRef-DOCUMENT">
    <spdx:name>fixture-described-spdx-rdf-app</spdx:name>
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-described-root">
    <spdx:licenseDeclared>MIT</spdx:licenseDeclared>
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:pypi/described-root@1.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-described-child">
    <spdx:licenseDeclared>Apache-2.0</spdx:licenseDeclared>
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:pypi/described-child@2.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-DOCUMENT" />
    <spdx:relationshipType>DESCRIBES</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-described-root" />
  </spdx:Relationship>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-described-child" />
    <spdx:relationshipType>DEPENDENCY_OF</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-described-root" />
  </spdx:Relationship>
</rdf:RDF>`, "sbom.spdx.rdf");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "described-root@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-described-spdx-rdf-app", "described-root@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "described-child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-described-spdx-rdf-app", "described-root@1.0.0", "described-child@2.0.0"]]
      });
  });

  test("merges duplicate dependency relationships without dropping child edges", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="">
    <spdx:name>fixture-spdx-rdf-duplicate-relationships</spdx:name>
    <spdx:describesPackage rdf:resource="#SPDXRef-Package-parent" />
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/parent@1.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child-a">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/child-a@2.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child-b">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/child-b@3.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType>DEPENDS_ON</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-child-a" />
  </spdx:Relationship>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType>DEPENDS_ON</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-child-b" />
  </spdx:Relationship>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "child-a@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-rdf-duplicate-relationships", "parent@1.0.0", "child-a@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child-b@3.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-rdf-duplicate-relationships", "parent@1.0.0", "child-b@3.0.0"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="">
    <spdx:name>fixture-spdx-rdf-cycle</spdx:name>
    <spdx:describesPackage rdf:resource="#SPDXRef-Package-parent" />
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/parent@1.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/child@2.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType>DEPENDS_ON</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-child" />
  </spdx:Relationship>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-child" />
    <spdx:relationshipType>DEPENDS_ON</spdx:relationshipType>
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-parent" />
  </spdx:Relationship>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-spdx-rdf-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-spdx-rdf-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
  });

  test("reports RDF documents without package PURLs as typed SPDX errors", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:Package rdf:about="#SPDXRef-Package-no-purl">
    <spdx:licenseDeclared>MIT</spdx:licenseDeclared>
  </spdx:Package>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed SPDX RDF document to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
  });

  test("reports malformed XML as typed SPDX errors", () => {
    const result = parseSpdxRdfText("<rdf:RDF><spdx:Package></rdf:RDF>", "spdx.rdf");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed SPDX RDF XML to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
  });

  test("reports malformed dependency relationships as unsupported input", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/parent@1.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/child@2.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType rdf:resource="http://spdx.org/rdf/terms#relationshipType_dependsOn" />
  </spdx:Relationship>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX RDF dependency relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "spdx.rdf",
      reason: "unsupported_spdx_dependency_relationships",
      relationshipIndexes: [0],
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });

  test("reports malformed DESCRIBES relationships as unsupported input", () => {
    const result = parseSpdxRdfText(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="#SPDXRef-DOCUMENT">
    <spdx:name>fixture-spdx-rdf-malformed-describes</spdx:name>
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:externalRef>
      <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
      <spdx:referenceType>purl</spdx:referenceType>
      <spdx:referenceLocator>pkg:npm/parent@1.0.0</spdx:referenceLocator>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-DOCUMENT" />
    <spdx:relationshipType>DESCRIBES</spdx:relationshipType>
  </spdx:Relationship>
</rdf:RDF>`, "spdx.rdf");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported SPDX RDF DESCRIBES relationship to fail.");
    }

    expect(result.error.code).toBe("SPDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "spdx.rdf",
      reason: "unsupported_spdx_describes_relationships",
      relationshipIndexes: [0],
      unsupportedRelationshipFields: ["relatedSpdxElement"]
    });
  });
});
