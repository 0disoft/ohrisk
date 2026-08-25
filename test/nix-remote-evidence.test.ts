import { describe, expect, test } from "bun:test";

import { collectGraphEvidence } from "../src/evidence/collect";
import { createTarGz } from "./helpers/tar";

const COMMIT = "11707dc2f618dd54ca8739b309ec4fc024de578b";
const NAR_HASH = "sha256-r0cHBTAAc4xNl3OihOmqGSfHf081XrpZZQOpmm1WuuU=";

describe("remote Nix GitHub evidence", () => {
  test("collects root license evidence only after the GitHub source tree matches narHash", async () => {
    const archive = createTarGz({ "source/LICENSE": "MIT License\n" });
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: nixGraph(NAR_HASH),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(archive, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(fetchedUrls).toEqual([
      `https://codeload.github.com/acme/risk-flake/tar.gz/${COMMIT}`
    ]);
    expect(evidence.value).toEqual([expect.objectContaining({
      packageId: `github:acme/risk-flake@${COMMIT}`,
      source: "tarball",
      warnings: [],
      files: [{ path: "LICENSE", kind: "license", text: "MIT License\n" }]
    })]);
  });

  test("fails closed when the fetched GitHub source tree differs from narHash", async () => {
    const archive = createTarGz({ "source/LICENSE": "different bytes\n" });
    const evidence = await collectGraphEvidence({
      graph: nixGraph(NAR_HASH),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(archive, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected Nix narHash mismatch to fail.");
    expect(evidence.error).toMatchObject({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      details: { reason: "nix_nar_hash_mismatch" }
    });
  });

  test("does not fetch a Nix GitHub input without a full commit and valid narHash", async () => {
    let fetchCount = 0;
    const graph = nixGraph("sha256-invalid");
    graph.nodes[0]!.version = "11707dc2";
    graph.nodes[0]!.id = "github:acme/risk-flake@11707dc2";

    const evidence = await collectGraphEvidence({
      graph,
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.alloc(0), url);
      }
    });

    expect(evidence.ok).toBe(true);
    expect(fetchCount).toBe(0);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
  });
});

function nixGraph(integrity: string) {
  const id = `github:acme/risk-flake@${COMMIT}`;
  return {
    lockfilePath: "flake.lock",
    nodes: [{
      id,
      name: "github:acme/risk-flake",
      version: COMMIT,
      ecosystem: "nix" as const,
      resolved: `https://codeload.github.com/acme/risk-flake/tar.gz/${COMMIT}`,
      integrity,
      dependencyType: "unknown" as const,
      direct: true,
      paths: [["root", "risk-flake"]]
    }]
  };
}

function artifactResponse(bytes: Buffer, url: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: {
      get: (name: string) => name.toLowerCase() === "content-length"
        ? String(bytes.length)
        : null
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }),
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  };
}
