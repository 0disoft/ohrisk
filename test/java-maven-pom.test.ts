import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

  test("resolves dependencyManagement versions from a local Maven parent POM", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-parent-repo-"));

    try {
      writeMavenPom(
        repositoryRoot,
        "com.acme",
        "build-parent",
        "1.0.0",
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>com.acme</groupId>",
          "  <artifactId>build-parent</artifactId>",
          "  <version>1.0.0</version>",
          "  <properties>",
          "    <slf4j.version>2.0.13</slf4j.version>",
          "  </properties>",
          "  <dependencyManagement>",
          "    <dependencies>",
          "      <dependency>",
          "        <groupId>org.slf4j</groupId>",
          "        <artifactId>slf4j-api</artifactId>",
          "        <version>${slf4j.version}</version>",
          "      </dependency>",
          "    </dependencies>",
          "  </dependencyManagement>",
          "</project>"
        ].join("\n")
      );

      const result = parseMavenPomText(
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <parent>",
          "    <groupId>com.acme</groupId>",
          "    <artifactId>build-parent</artifactId>",
          "    <version>1.0.0</version>",
          "  </parent>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>org.slf4j</groupId>",
          "      <artifactId>slf4j-api</artifactId>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "pom.xml",
        {
          mavenRepositoryRoots: [repositoryRoot],
          projectRoot: path.dirname(repositoryRoot)
        }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes).toEqual([
        expect.objectContaining({
          id: "org.slf4j:slf4j-api@2.0.13",
          name: "org.slf4j:slf4j-api",
          version: "2.0.13",
          ecosystem: "maven",
          dependencyType: "production",
          direct: true,
          paths: [["fixture-maven", "org.slf4j:slf4j-api@2.0.13"]]
        })
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("resolves dependencyManagement versions from a local imported Maven BOM", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-bom-repo-"));

    try {
      writeMavenPom(
        repositoryRoot,
        "com.acme",
        "platform-bom",
        "2.0.0",
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>com.acme</groupId>",
          "  <artifactId>platform-bom</artifactId>",
          "  <version>2.0.0</version>",
          "  <properties>",
          "    <jackson.version>2.17.1</jackson.version>",
          "  </properties>",
          "  <dependencyManagement>",
          "    <dependencies>",
          "      <dependency>",
          "        <groupId>com.fasterxml.jackson.core</groupId>",
          "        <artifactId>jackson-databind</artifactId>",
          "        <version>${jackson.version}</version>",
          "      </dependency>",
          "    </dependencies>",
          "  </dependencyManagement>",
          "</project>"
        ].join("\n")
      );

      const result = parseMavenPomText(
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <dependencyManagement>",
          "    <dependencies>",
          "      <dependency>",
          "        <groupId>com.acme</groupId>",
          "        <artifactId>platform-bom</artifactId>",
          "        <version>2.0.0</version>",
          "        <type>pom</type>",
          "        <scope>import</scope>",
          "      </dependency>",
          "    </dependencies>",
          "  </dependencyManagement>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>com.fasterxml.jackson.core</groupId>",
          "      <artifactId>jackson-databind</artifactId>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "pom.xml",
        {
          mavenRepositoryRoots: [repositoryRoot],
          projectRoot: path.dirname(repositoryRoot)
        }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes).toEqual([
        expect.objectContaining({
          id: "com.fasterxml.jackson.core:jackson-databind@2.17.1",
          name: "com.fasterxml.jackson.core:jackson-databind",
          version: "2.17.1",
          ecosystem: "maven",
          dependencyType: "production",
          direct: true
        })
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("reports external Maven parent POM cycles as typed errors", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-cycle-repo-"));

    try {
      writeMavenPom(
        repositoryRoot,
        "com.acme",
        "parent-a",
        "1.0.0",
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <parent>",
          "    <groupId>com.acme</groupId>",
          "    <artifactId>parent-b</artifactId>",
          "    <version>1.0.0</version>",
          "  </parent>",
          "  <artifactId>parent-a</artifactId>",
          "</project>"
        ].join("\n")
      );

      writeMavenPom(
        repositoryRoot,
        "com.acme",
        "parent-b",
        "1.0.0",
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <parent>",
          "    <groupId>com.acme</groupId>",
          "    <artifactId>parent-a</artifactId>",
          "    <version>1.0.0</version>",
          "  </parent>",
          "  <artifactId>parent-b</artifactId>",
          "</project>"
        ].join("\n")
      );

      const result = parseMavenPomText(
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <parent>",
          "    <groupId>com.acme</groupId>",
          "    <artifactId>parent-a</artifactId>",
          "    <version>1.0.0</version>",
          "  </parent>",
          "  <artifactId>fixture-maven</artifactId>",
          "</project>"
        ].join("\n"),
        "pom.xml",
        {
          mavenRepositoryRoots: [repositoryRoot],
          projectRoot: path.dirname(repositoryRoot)
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected Maven parent cycle to fail.");
      }

      expect(result.error.code).toBe("MAVEN_POM_PARSE_FAILED");
      expect(result.error.details).toMatchObject({
        dependency: "com.acme:parent-a@1.0.0"
      });
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("reports missing local Maven parent metadata when it cannot resolve managed versions", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-missing-parent-repo-"));

    try {
      const result = parseMavenPomText(
        [
          "<project>",
          "  <parent>",
          "    <groupId>com.acme</groupId>",
          "    <artifactId>missing-parent</artifactId>",
          "    <version>1.0.0</version>",
          "  </parent>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>org.example</groupId>",
          "      <artifactId>managed-version</artifactId>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "pom.xml",
        {
          mavenRepositoryRoots: [repositoryRoot],
          projectRoot: path.dirname(repositoryRoot)
        }
      );

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected dependency without version to fail.");
      }

      expect(result.error.code).toBe("MAVEN_POM_PARSE_FAILED");
      expect(result.error.message).toContain("local Maven parent/BOM metadata did not provide one");
      expect(result.error.details).toMatchObject({
        lockfilePath: "pom.xml",
        dependency: "org.example:managed-version",
        reason: "missing_dependency_version",
        supportedVersionSources: [
          "explicit dependency <version>",
          "pom.xml properties",
          "same-file dependencyManagement",
          "local .m2 parent POM",
          "local .m2 imported BOM POM"
        ],
        missingExternalPoms: [
          {
            usage: "parent",
            dependency: "com.acme:missing-parent@1.0.0"
          }
        ]
      });
      expect(result.error.details?.searchedRepositoryRoots).toEqual(expect.arrayContaining([repositoryRoot]));
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
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
    expect(result.error.details).toMatchObject({
      reason: "missing_dependency_version",
      missingExternalPoms: [
        {
          usage: "imported_bom",
          dependency: "org.example:example-bom@1.0.0"
        }
      ]
    });
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
    expect(result.error.details).toMatchObject({
      dependency: "org.example:unresolved",
      version: "${external.version}",
      reason: "unresolved_maven_version"
    });
  });
});

function writeMavenPom(
  repositoryRoot: string,
  groupId: string,
  artifactId: string,
  version: string,
  text: string
): void {
  const pomDir = path.join(repositoryRoot, ...groupId.split("."), artifactId, version);
  mkdirSync(pomDir, { recursive: true });
  writeFileSync(path.join(pomDir, `${artifactId}-${version}.pom`), text, "utf8");
}
