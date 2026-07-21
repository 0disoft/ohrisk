import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseProjectDependencyGraphWithRemoteMavenPoms } from "../src/ecosystems/registry";

describe("remote Maven project model resolution", () => {
  test("fetches nested imported BOMs until the dependency graph is resolved", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-model-resolution-"));
    const requests: string[][] = [];
    const documents = new Map([
      ["org.example:platform-bom@1.0.0", platformBom()],
      ["org.example:library-bom@2.0.0", libraryBom()]
    ]);

    try {
      writeFileSync(path.join(projectRoot, "pom.xml"), rootPom(), "utf8");
      const result = await parseProjectDependencyGraphWithRemoteMavenPoms({
        project: {
          rootDir: projectRoot,
          lockfile: { kind: "maven-pom", path: path.join(projectRoot, "pom.xml") }
        },
        fetchRemotePoms: async (missing) => {
          requests.push(missing.map((request) => request.dependency));
          return {
            ok: true as const,
            value: missing.map((request) => ({
              ...request,
              source: `https://repo.maven.apache.org/maven2/${request.artifactId}.pom`,
              text: documents.get(request.dependency) ?? ""
            }))
          };
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(requests).toEqual([
        ["org.example:platform-bom@1.0.0"],
        ["org.example:library-bom@2.0.0"]
      ]);
      expect(result.value.nodes).toContainEqual(expect.objectContaining({
        id: "org.example:library@2.3.4"
      }));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("bounds remote Maven model fan-out before fetching", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-model-limit-"));
    let fetchCalled = false;

    try {
      writeFileSync(path.join(projectRoot, "pom.xml"), rootPom(), "utf8");
      const result = await parseProjectDependencyGraphWithRemoteMavenPoms({
        project: {
          rootDir: projectRoot,
          lockfile: { kind: "maven-pom", path: path.join(projectRoot, "pom.xml") }
        },
        maxRemotePoms: 0,
        fetchRemotePoms: async () => {
          fetchCalled = true;
          return { ok: true as const, value: [] };
        }
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected remote Maven model limit failure.");
      expect(result.error).toMatchObject({
        code: "MAVEN_POM_PARSE_FAILED",
        details: { reason: "remote_maven_model_count", limit: 0 }
      });
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails closed when a remote resolver omits a requested Maven model", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-model-incomplete-"));

    try {
      writeFileSync(path.join(projectRoot, "pom.xml"), rootPom(), "utf8");
      const result = await parseProjectDependencyGraphWithRemoteMavenPoms({
        project: {
          rootDir: projectRoot,
          lockfile: { kind: "maven-pom", path: path.join(projectRoot, "pom.xml") }
        },
        fetchRemotePoms: async () => ({ ok: true as const, value: [] })
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected incomplete Maven model response failure.");
      expect(result.error).toMatchObject({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "internal",
        details: {
          reason: "remote_maven_model_incomplete",
          requested: 1,
          received: 0
        }
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function rootPom(): string {
  return [
    "<project>",
    "  <groupId>org.example</groupId>",
    "  <artifactId>fixture</artifactId>",
    "  <version>1.0.0</version>",
    "  <dependencyManagement><dependencies>",
    "    <dependency>",
    "      <groupId>org.example</groupId>",
    "      <artifactId>platform-bom</artifactId>",
    "      <version>1.0.0</version>",
    "      <type>pom</type><scope>import</scope>",
    "    </dependency>",
    "  </dependencies></dependencyManagement>",
    "  <dependencies><dependency>",
    "    <groupId>org.example</groupId>",
    "    <artifactId>library</artifactId>",
    "  </dependency></dependencies>",
    "</project>"
  ].join("\n");
}

function platformBom(): string {
  return [
    "<project>",
    "  <groupId>org.example</groupId>",
    "  <artifactId>platform-bom</artifactId>",
    "  <version>1.0.0</version>",
    "  <dependencyManagement><dependencies>",
    "    <dependency>",
    "      <groupId>org.example</groupId>",
    "      <artifactId>library-bom</artifactId>",
    "      <version>2.0.0</version>",
    "      <type>pom</type><scope>import</scope>",
    "    </dependency>",
    "  </dependencies></dependencyManagement>",
    "</project>"
  ].join("\n");
}

function libraryBom(): string {
  return [
    "<project>",
    "  <groupId>org.example</groupId>",
    "  <artifactId>library-bom</artifactId>",
    "  <version>2.0.0</version>",
    "  <dependencyManagement><dependencies>",
    "    <dependency>",
    "      <groupId>org.example</groupId>",
    "      <artifactId>library</artifactId>",
    "      <version>2.3.4</version>",
    "    </dependency>",
    "  </dependencies></dependencyManagement>",
    "</project>"
  ].join("\n");
}
