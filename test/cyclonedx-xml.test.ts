import { describe, expect, test } from "bun:test";

import { parseCycloneDxXmlText } from "../src/graph/cyclonedx-xml";

describe("parseCycloneDxXmlText", () => {
  test("parses dependency graph and embedded license evidence from CycloneDX XML", () => {
    const result = parseCycloneDxXmlText(`<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml &amp; app</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="pkg:npm/permissive-parent@1.0.0">
      <purl>pkg:npm/permissive-parent@1.0.0</purl>
      <licenses>
        <license>
          <id>MIT</id>
        </license>
      </licenses>
    </component>
    <component type="library" bom-ref="agpl-child">
      <purl>pkg:pypi/agpl-child@2.0.0</purl>
      <scope>optional</scope>
      <licenses>
        <expression>AGPL-3.0-only</expression>
      </licenses>
    </component>
    <component type="library" bom-ref="dev-tool">
      <purl>pkg:maven/org.example/dev-tool@3.0.0</purl>
      <scope>excluded</scope>
      <licenses>
        <license>
          <id>GPL-3.0-only</id>
        </license>
      </licenses>
    </component>
    <component type="library" bom-ref="fallback-package">
      <name>fallback-package</name>
      <version>1.2.3</version>
      <licenses>
        <license>
          <name>MIT License</name>
        </license>
      </licenses>
      <properties>
        <property name="ohrisk:ecosystem" value="go" />
        <property name="ohrisk:dependencyType">peer</property>
      </properties>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="pkg:npm/permissive-parent@1.0.0" />
      <dependency ref="fallback-package" />
    </dependency>
    <dependency ref="pkg:npm/permissive-parent@1.0.0">
      <dependency ref="agpl-child" />
      <dependency ref="dev-tool" />
    </dependency>
  </dependencies>
</bom>`, "cyclonedx.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-cyclonedx-xml & app");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@2.0.0",
      "fallback-package@1.2.3",
      "org.example:dev-tool@3.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-cyclonedx-xml & app", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@2.0.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "optional",
        direct: false,
        paths: [["fixture-cyclonedx-xml & app", "permissive-parent@1.0.0", "agpl-child@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "org.example:dev-tool@3.0.0"))
      .toMatchObject({
        ecosystem: "maven",
        dependencyType: "development",
        direct: false
      });
    expect(result.value.nodes.find((node) => node.id === "fallback-package@1.2.3"))
      .toMatchObject({
        ecosystem: "go",
        dependencyType: "peer",
        direct: true
      });
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "agpl-child@2.0.0",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "CycloneDX",
      source: "sbom"
    }));
    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "fallback-package@1.2.3",
      metadataLicense: "MIT License",
      metadataSource: "CycloneDX",
      source: "sbom"
    }));
  });

  test("preserves CycloneDX XML NONE markers as embedded license evidence", () => {
    const result = parseCycloneDxXmlText(`<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml-none</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="none-xml-child">
      <purl>pkg:npm/none-xml-child@1.0.0</purl>
      <licenses>
        <expression>NONE</expression>
      </licenses>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="none-xml-child" />
    </dependency>
  </dependencies>
</bom>`, "cyclonedx.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.embeddedEvidence).toContainEqual(expect.objectContaining({
      packageId: "none-xml-child@1.0.0",
      metadataLicense: "NONE",
      metadataSource: "CycloneDX",
      source: "sbom",
      warnings: []
    }));
  });

  test("merges duplicate dependency entries without dropping child edges", () => {
    const result = parseCycloneDxXmlText(`<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml-duplicate-deps</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="parent">
      <purl>pkg:npm/parent@1.0.0</purl>
    </component>
    <component type="library" bom-ref="child-a">
      <purl>pkg:npm/child-a@2.0.0</purl>
    </component>
    <component type="library" bom-ref="child-b">
      <purl>pkg:npm/child-b@3.0.0</purl>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="parent" />
    </dependency>
    <dependency ref="parent">
      <dependency ref="child-a" />
    </dependency>
    <dependency ref="parent">
      <dependency ref="child-b" />
    </dependency>
  </dependencies>
</bom>`, "cyclonedx.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "child-a@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-xml-duplicate-deps", "parent@1.0.0", "child-a@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child-b@3.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-xml-duplicate-deps", "parent@1.0.0", "child-b@3.0.0"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseCycloneDxXmlText(`<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml-cycle</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="parent">
      <purl>pkg:npm/parent@1.0.0</purl>
    </component>
    <component type="library" bom-ref="child">
      <purl>pkg:npm/child@2.0.0</purl>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="parent" />
    </dependency>
    <dependency ref="parent">
      <dependency ref="child" />
    </dependency>
    <dependency ref="child">
      <dependency ref="parent" />
    </dependency>
  </dependencies>
</bom>`, "cyclonedx.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-cyclonedx-xml-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-cyclonedx-xml-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
  });

  test("reports malformed XML as typed CycloneDX errors", () => {
    const result = parseCycloneDxXmlText("<bom><components></bom>", "cyclonedx.xml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed CycloneDX XML to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
  });

  test("rejects unsupported XML declarations", () => {
    const result = parseCycloneDxXmlText([
      "<!DOCTYPE bom [<!ENTITY risk \"AGPL-3.0-only\">]>",
      "<bom><components /></bom>"
    ].join("\n"), "cyclonedx.xml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported XML declaration to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
  });

  test("decodes valid XML 1.0 numeric character references", () => {
    const result = parseCycloneDxXmlText([
      "<bom>",
      "  <metadata><component bom-ref=\"root-app\"><name>fixture&#x20;app&#128512;</name></component></metadata>",
      "  <components><component bom-ref=\"child\"><purl>pkg:npm/child@1.0.0</purl></component></components>",
      "  <dependencies><dependency ref=\"root-app\"><dependency ref=\"child\" /></dependency></dependencies>",
      "</bom>"
    ].join("\n"), "numeric-entities.cdx.xml");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture app😀");
  });

  test("rejects invalid XML 1.0 numeric character references without throwing", () => {
    const invalidEntities = ["&#0;", "&#xD800;", "&#xFFFE;", "&#x110000;", "&#1114112;", "&#x10zz;"];

    for (const entity of invalidEntities) {
      let result: ReturnType<typeof parseCycloneDxXmlText> | undefined;
      expect(() => {
        result = parseCycloneDxXmlText(
          `<bom><components><component bom-ref="child"><purl>pkg:npm/child@1.0.0</purl><name>${entity}</name></component></components></bom>`,
          "invalid-entity.cdx.xml"
        );
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
        expect(result.error.details?.cause).toContain("Unsupported XML entity");
      }
    }
  });

  test("reports dependency entries with missing refs as unsupported input", () => {
    const result = parseCycloneDxXmlText(`<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <components>
    <component type="library" bom-ref="parent">
      <purl>pkg:npm/parent@1.0.0</purl>
    </component>
    <component type="library" bom-ref="child">
      <purl>pkg:npm/child@2.0.0</purl>
    </component>
  </components>
  <dependencies>
    <dependency ref="parent">
      <dependency />
    </dependency>
  </dependencies>
</bom>`, "cyclonedx.xml");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported CycloneDX XML dependency entry to fail.");
    }

    expect(result.error.code).toBe("CYCLONEDX_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details).toEqual({
      lockfilePath: "cyclonedx.xml",
      reason: "unsupported_cyclonedx_xml_dependency_refs",
      dependencyEntryIndexes: [0],
      unsupportedDependencyFields: ["dependsOn.ref"]
    });
  });
});
