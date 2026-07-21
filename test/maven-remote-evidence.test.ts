import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectGraphEvidence, fetchMavenCentralModelPoms } from "../src/evidence/collect";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import type { DependencyGraph, DependencyNode } from "../src/graph/types";
import { createZip } from "./helpers/zip";

const DEMO_POM_URL = "https://repo.maven.apache.org/maven2/org/example/demo/1.2.3/demo-1.2.3.pom";
const TOOL_POM_URL = "https://repo.maven.apache.org/maven2/org/example/tool/1.2.3/tool-1.2.3.pom";
const PARENT_POM_URL = "https://repo.maven.apache.org/maven2/org/example/parent/1.2.3/parent-1.2.3.pom";
const CUSTOM_REPOSITORY_URL = "https://repo.example.test/maven-public";
const CUSTOM_DEMO_POM_URL = `${CUSTOM_REPOSITORY_URL}/org/example/demo/1.2.3/demo-1.2.3.pom`;
const CUSTOM_DEMO_JAR_URL = `${CUSTOM_REPOSITORY_URL}/org/example/demo/1.2.3/demo-1.2.3.jar`;
const CUSTOM_DEMO_JAR_CHECKSUM_URL = `${CUSTOM_DEMO_JAR_URL}.sha256`;

describe("Maven Central evidence", () => {
  test("fetches exact Maven Central BOM model documents", async () => {
    const requests: string[] = [];
    const result = await fetchMavenCentralModelPoms({
      requests: [{
        usage: "imported_bom",
        dependency: "org.junit:junit-bom@5.14.4",
        groupId: "org.junit",
        artifactId: "junit-bom",
        version: "5.14.4"
      }],
      fetchArtifact: async (url) => {
        requests.push(url);
        return okResponse([
          "<project>",
          "  <groupId>org.junit</groupId>",
          "  <artifactId>junit-bom</artifactId>",
          "  <version>5.14.4</version>",
          "</project>"
        ].join("\n"));
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(requests).toEqual([
      "https://repo.maven.apache.org/maven2/org/junit/junit-bom/5.14.4/junit-bom-5.14.4.pom"
    ]);
    expect(result.value).toEqual([expect.objectContaining({
      dependency: "org.junit:junit-bom@5.14.4",
      source: requests[0]
    })]);
  });

  test("rejects a Maven Central model document with mismatched identity", async () => {
    const result = await fetchMavenCentralModelPoms({
      requests: [{
        usage: "parent",
        dependency: "org.example:expected-parent@1.0.0",
        groupId: "org.example",
        artifactId: "expected-parent",
        version: "1.0.0"
      }],
      fetchArtifact: async () => okResponse([
        "<project>",
        "  <groupId>org.example</groupId>",
        "  <artifactId>different-parent</artifactId>",
        "  <version>1.0.0</version>",
        "</project>"
      ].join("\n"))
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Maven model identity mismatch.");
    expect(result.error).toMatchObject({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      details: { reason: "identity_mismatch" }
    });
  });

  test("uses a project-declared Maven repository only when its exact host is allowed", async () => {
    const requests: string[] = [];
    const result = await collectGraphEvidence({
      graph: mavenGraph(
        [mavenNode("org.example:demo", "1.2.3")],
        [CUSTOM_REPOSITORY_URL]
      ),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      allowedArtifactHosts: ["repo.example.test"],
      fetchArtifact: async (url) => {
        requests.push(url);
        if (url === DEMO_POM_URL) return notFoundResponse();
        if (url === CUSTOM_DEMO_POM_URL) {
          return okResponse([
            "<project>",
            "  <groupId>org.example</groupId>",
            "  <artifactId>demo</artifactId>",
            "  <version>1.2.3</version>",
            "  <licenses><license><name>Eclipse Public License v2.0</name></license></licenses>",
            "</project>"
          ].join("\n"));
        }
        return notFoundResponse();
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(requests).toEqual([DEMO_POM_URL, CUSTOM_DEMO_POM_URL]);
    expect(result.value[0]).toMatchObject({
      metadataLicense: "Eclipse Public License v2.0",
      metadataSource: "Maven repository repo.example.test pom.xml",
      source: "tarball"
    });
  });

  test("does not contact a project-declared Maven repository without an explicit host allowlist", async () => {
    const requests: string[] = [];
    const result = await collectGraphEvidence({
      graph: mavenGraph(
        [mavenNode("org.example:demo", "1.2.3")],
        [CUSTOM_REPOSITORY_URL]
      ),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => {
        requests.push(url);
        return notFoundResponse();
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(requests).toEqual([DEMO_POM_URL]);
    expect(result.value[0]?.source).toBe("unavailable");
  });

  test("uses checksum and embedded identity verified Maven JAR license evidence", async () => {
    const jar = createZip({
      "META-INF/maven/org.example/demo/pom.properties": "groupId=org.example\nartifactId=demo\nversion=1.2.3\n",
      "META-INF/LICENSE": "GNU GENERAL PUBLIC LICENSE Version 3"
    });
    const checksum = createHash("sha256").update(jar).digest("hex");
    const requests: string[] = [];
    const result = await collectGraphEvidence({
      graph: mavenGraph(
        [mavenNode("org.example:demo", "1.2.3")],
        [CUSTOM_REPOSITORY_URL]
      ),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      allowedArtifactHosts: ["repo.example.test"],
      fetchArtifact: async (url) => {
        requests.push(url);
        if (url === DEMO_POM_URL) return notFoundResponse();
        if (url === CUSTOM_DEMO_POM_URL) {
          return okResponse([
            "<project>",
            "  <groupId>org.example</groupId>",
            "  <artifactId>demo</artifactId>",
            "  <version>1.2.3</version>",
            "</project>"
          ].join("\n"));
        }
        if (url === CUSTOM_DEMO_JAR_CHECKSUM_URL) return okResponse(checksum);
        if (url === CUSTOM_DEMO_JAR_URL) return okBufferResponse(jar);
        return notFoundResponse();
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(requests).toEqual([
      DEMO_POM_URL,
      CUSTOM_DEMO_POM_URL,
      CUSTOM_DEMO_JAR_CHECKSUM_URL,
      CUSTOM_DEMO_JAR_URL
    ]);
    expect(result.value[0]).toMatchObject({
      source: "tarball",
      files: [{ path: "META-INF/LICENSE", kind: "license" }]
    });
    expect(normalizeLicenseEvidence(result.value[0]!)).toMatchObject({
      expression: "GPL-3.0-only",
      choices: ["GPL-3.0-only"]
    });
  });

  test("fails closed when a Maven JAR disagrees with its repository SHA-256 checksum", async () => {
    const jar = createZip({
      "META-INF/maven/org.example/demo/pom.properties": "groupId=org.example\nartifactId=demo\nversion=1.2.3\n"
    });
    const result = await collectGraphEvidence({
      graph: mavenGraph(
        [mavenNode("org.example:demo", "1.2.3")],
        [CUSTOM_REPOSITORY_URL]
      ),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      allowedArtifactHosts: ["repo.example.test"],
      fetchArtifact: async (url) => {
        if (url === DEMO_POM_URL) return notFoundResponse();
        if (url === CUSTOM_DEMO_POM_URL) {
          return okResponse([
            "<project>",
            "  <groupId>org.example</groupId>",
            "  <artifactId>demo</artifactId>",
            "  <version>1.2.3</version>",
            "</project>"
          ].join("\n"));
        }
        if (url === CUSTOM_DEMO_JAR_CHECKSUM_URL) return okResponse("0".repeat(64));
        if (url === CUSTOM_DEMO_JAR_URL) return okBufferResponse(jar);
        return notFoundResponse();
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Maven JAR checksum mismatch.");
    expect(result.error).toMatchObject({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      details: { reason: "maven_jar_checksum_mismatch" }
    });
  });

  test("fetches exact POMs, inherits parent licenses, and deduplicates shared parent requests", async () => {
    const requests: Array<{ url: string; authorization?: string }> = [];
    const result = await collectGraphEvidence({
      graph: mavenGraph([
        mavenNode("org.example:demo", "1.2.3"),
        mavenNode("org.example:tool", "1.2.3")
      ]),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      registryAuthTokens: new Map([["repo.maven.apache.org", "must-not-leak"]]),
      evidenceConcurrency: 2,
      fetchArtifact: async (url, options) => {
        requests.push({
          url,
          ...(options?.headers?.authorization
            ? { authorization: options.headers.authorization }
            : {})
        });
        if (url === DEMO_POM_URL) return okResponse(childPom("demo"));
        if (url === TOOL_POM_URL) return okResponse(childPom("tool"));
        if (url === PARENT_POM_URL) return okResponse(parentPom());
        return notFoundResponse();
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(requests.filter((request) => request.url === PARENT_POM_URL)).toHaveLength(1);
    expect(requests.every((request) => request.authorization === undefined)).toBe(true);
    expect(result.value).toHaveLength(2);
    for (const evidence of result.value) {
      expect(evidence).toMatchObject({
        metadataLicense: "Eclipse Public License - v 2.0",
        metadataSource: "Maven Central parent pom.xml (org.example:parent@1.2.3)",
        source: "tarball",
        warnings: []
      });
      expect(normalizeLicenseEvidence(evidence)).toMatchObject({
        expression: "EPL-2.0",
        choices: ["EPL-2.0"],
        confidence: "medium"
      });
    }
  });

  test("uses the artifact cache for an offline Maven Central scan", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-central-cache-"));
    let fetchCount = 0;

    try {
      const online = await collectGraphEvidence({
        graph: mavenGraph([mavenNode("org.example:demo", "1.2.3")]),
        projectRoot: process.cwd(),
        allowLocalProjectEvidence: false,
        cacheDir,
        fetchArtifact: async (url) => {
          fetchCount += 1;
          if (url === DEMO_POM_URL) return okResponse(childPom("demo"));
          if (url === PARENT_POM_URL) return okResponse(parentPom());
          return notFoundResponse();
        }
      });
      expect(online.ok).toBe(true);
      expect(fetchCount).toBe(2);

      const offline = await collectGraphEvidence({
        graph: mavenGraph([mavenNode("org.example:demo", "1.2.3")]),
        projectRoot: process.cwd(),
        allowLocalProjectEvidence: false,
        cacheDir,
        offline: true,
        fetchArtifact: async () => {
          throw new Error("Offline Maven evidence must not use the network.");
        }
      });
      expect(offline.ok).toBe(true);
      if (!offline.ok) throw new Error(offline.error.message);
      expect(offline.value[0]).toMatchObject({
        metadataLicense: "Eclipse Public License - v 2.0",
        source: "tarball"
      });
      expect(fetchCount).toBe(2);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test("fails closed when the returned POM identity does not match the exact request", async () => {
    const result = await collectGraphEvidence({
      graph: mavenGraph([mavenNode("org.example:demo", "1.2.3")]),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async () => okResponse([
        "<project>",
        "  <groupId>org.example</groupId>",
        "  <artifactId>other</artifactId>",
        "  <version>1.2.3</version>",
        "</project>"
      ].join("\n"))
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Maven identity mismatch failure.");
    expect(result.error).toMatchObject({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      details: { reason: "identity_mismatch" }
    });
  });

  test("turns a missing Central POM into unavailable evidence without aborting the graph", async () => {
    const result = await collectGraphEvidence({
      graph: mavenGraph([mavenNode("org.example:missing", "1.2.3")]),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async () => notFoundResponse()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual([{
      packageId: "org.example:missing@1.2.3",
      files: [],
      source: "unavailable",
      warnings: [
        "Package evidence could not be fetched (REGISTRY_METADATA_FETCH_FAILED): Failed to fetch Maven Central POM metadata."
      ]
    }]);
  });

  test("rejects Maven Central redirects to another host", async () => {
    const result = await collectGraphEvidence({
      graph: mavenGraph([mavenNode("org.example:demo", "1.2.3")]),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async () => ({
        ok: false,
        status: 302,
        statusText: "Found",
        headers: {
          get: (name: string) => name.toLowerCase() === "location"
            ? "https://example.com/forged.pom"
            : null
        },
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0)
      })
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cross-host Maven redirect failure.");
    expect(result.error).toMatchObject({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input"
    });
  });
});

function mavenGraph(nodes: DependencyNode[], mavenRepositoryUrls: string[] = []): DependencyGraph {
  return {
    rootName: "fixture",
    lockfilePath: "pom.xml",
    ...(mavenRepositoryUrls.length > 0 ? { mavenRepositoryUrls } : {}),
    nodes
  };
}

function mavenNode(name: string, version: string): DependencyNode {
  return {
    id: `${name}@${version}`,
    name,
    version,
    ecosystem: "maven",
    dependencyType: "production",
    direct: true,
    paths: [["fixture", `${name}@${version}`]]
  };
}

function childPom(artifactId: string): string {
  return [
    "<project>",
    "  <parent>",
    "    <groupId>org.example</groupId>",
    "    <artifactId>parent</artifactId>",
    "    <version>1.2.3</version>",
    "  </parent>",
    `  <artifactId>${artifactId}</artifactId>`,
    "</project>"
  ].join("\n");
}

function parentPom(): string {
  return [
    "<project>",
    "  <groupId>org.example</groupId>",
    "  <artifactId>parent</artifactId>",
    "  <version>1.2.3</version>",
    "  <licenses>",
    "    <license><name>Eclipse Public License - v 2.0</name></license>",
    "  </licenses>",
    "</project>"
  ].join("\n");
}

function okResponse(input: string): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: () => null };
  body: ReadableStream<Uint8Array>;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  const bytes = Buffer.from(input, "utf8");
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  };
}

function okBufferResponse(bytes: Buffer): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: () => null };
  body: ReadableStream<Uint8Array>;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  };
}

function notFoundResponse(): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: () => null };
  body: null;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}
