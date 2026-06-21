import { describe, expect, test } from "bun:test";

import { parseMavenPomText } from "../src/graph/java-maven-pom";

describe("parseMavenPomText", () => {
  test("parses direct Maven dependencies with explicit and property versions", () => {
    const result = parseMavenPomText(
      [
        "<project>",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>fixture-maven</artifactId>",
        "  <version>0.1.0</version>",
        "  <properties>",
        "    <commons.version>3.14.0</commons.version>",
        "    <managed.version>9.8.7</managed.version>",
        "  </properties>",
        "  <dependencyManagement>",
        "    <dependencies>",
        "      <dependency>",
        "        <groupId>com.hidden</groupId>",
        "        <artifactId>managed-only</artifactId>",
        "        <version>1.0.0</version>",
        "      </dependency>",
        "      <dependency>",
        "        <groupId>com.managed</groupId>",
        "        <artifactId>managed-version</artifactId>",
        "        <version>${managed.version}</version>",
        "      </dependency>",
        "    </dependencies>",
        "  </dependencyManagement>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>org.apache.commons</groupId>",
        "      <artifactId>commons-lang3</artifactId>",
        "      <version>${commons.version}</version>",
        "    </dependency>",
        "    <dependency>",
        "      <groupId>junit</groupId>",
        "      <artifactId>junit</artifactId>",
        "      <version>4.13.2</version>",
        "      <scope>test</scope>",
        "    </dependency>",
        "    <dependency>",
        "      <groupId>com.acme</groupId>",
        "      <artifactId>optional-tool</artifactId>",
        "      <version>2.0.0</version>",
        "      <optional>true</optional>",
        "    </dependency>",
        "    <dependency>",
        "      <groupId>com.managed</groupId>",
        "      <artifactId>managed-version</artifactId>",
        "    </dependency>",
        "  </dependencies>",
        "</project>"
      ].join("\n"),
      "pom.xml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-maven");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "com.acme:optional-tool@2.0.0",
        name: "com.acme:optional-tool",
        version: "2.0.0",
        ecosystem: "maven",
        dependencyType: "optional",
        direct: true,
        paths: [["fixture-maven", "com.acme:optional-tool@2.0.0"]]
      }),
      expect.objectContaining({
        id: "com.managed:managed-version@9.8.7",
        name: "com.managed:managed-version",
        version: "9.8.7",
        ecosystem: "maven",
        dependencyType: "production",
        direct: true
      }),
      expect.objectContaining({
        id: "junit:junit@4.13.2",
        name: "junit:junit",
        version: "4.13.2",
        ecosystem: "maven",
        dependencyType: "development",
        direct: true
      }),
      expect.objectContaining({
        id: "org.apache.commons:commons-lang3@3.14.0",
        name: "org.apache.commons:commons-lang3",
        version: "3.14.0",
        ecosystem: "maven",
        dependencyType: "production",
        direct: true
      })
    ]);
    expect(result.value.nodes.map((node) => node.id)).not.toContain("com.hidden:managed-only@1.0.0");
  });

  test("rejects dependencies whose version comes only from external Maven management", () => {
    const result = parseMavenPomText(
      [
        "<project>",
        "  <artifactId>fixture-maven</artifactId>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>org.example</groupId>",
        "      <artifactId>managed-version</artifactId>",
        "    </dependency>",
        "  </dependencies>",
        "</project>"
      ].join("\n"),
      "pom.xml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected dependency without version to fail.");
    }

    expect(result.error.code).toBe("MAVEN_POM_PARSE_FAILED");
  });

  test("does not treat imported BOM entries as same-file dependencyManagement versions", () => {
    const result = parseMavenPomText(
      [
        "<project>",
        "  <artifactId>fixture-maven</artifactId>",
        "  <dependencyManagement>",
        "    <dependencies>",
        "      <dependency>",
        "        <groupId>org.example</groupId>",
        "        <artifactId>example-bom</artifactId>",
        "        <version>1.0.0</version>",
        "        <type>pom</type>",
        "        <scope>import</scope>",
        "      </dependency>",
        "    </dependencies>",
        "  </dependencyManagement>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>org.example</groupId>",
        "      <artifactId>example-bom</artifactId>",
        "    </dependency>",
        "  </dependencies>",
        "</project>"
      ].join("\n"),
      "pom.xml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected imported BOM dependencyManagement entry to be ignored.");
    }

    expect(result.error.code).toBe("MAVEN_POM_PARSE_FAILED");
  });

  test("rejects unresolved property versions", () => {
    const result = parseMavenPomText(
      [
        "<project>",
        "  <artifactId>fixture-maven</artifactId>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>org.example</groupId>",
        "      <artifactId>unresolved</artifactId>",
        "      <version>${external.version}</version>",
        "    </dependency>",
        "  </dependencies>",
        "</project>"
      ].join("\n"),
      "pom.xml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unresolved property version to fail.");
    }

    expect(result.error.code).toBe("MAVEN_POM_PARSE_FAILED");
  });
});
