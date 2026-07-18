import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectGraphEvidence } from "../src/evidence/collect";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import type { DependencyGraph, DependencyNode } from "../src/graph/types";

const DEMO_POM_URL = "https://repo.maven.apache.org/maven2/org/example/demo/1.2.3/demo-1.2.3.pom";
const TOOL_POM_URL = "https://repo.maven.apache.org/maven2/org/example/tool/1.2.3/tool-1.2.3.pom";
const PARENT_POM_URL = "https://repo.maven.apache.org/maven2/org/example/parent/1.2.3/parent-1.2.3.pom";

describe("Maven Central evidence", () => {
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

function mavenGraph(nodes: DependencyNode[]): DependencyGraph {
  return {
    rootName: "fixture",
    lockfilePath: "pom.xml",
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
