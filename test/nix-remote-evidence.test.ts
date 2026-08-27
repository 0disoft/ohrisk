import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { collectGraphEvidence } from "../src/evidence/collect";
import { collectNixTarXzArchiveEvidence } from "../src/evidence/nix-github";
import { createTarGz } from "./helpers/tar";

const COMMIT = "11707dc2f618dd54ca8739b309ec4fc024de578b";
const NAR_HASH = "sha256-r0cHBTAAc4xNl3OihOmqGSfHf081XrpZZQOpmm1WuuU=";
const XZ_TAR = Buffer.from(
  "/Td6WFoAAATm1rRGAgAhARYAAAB0L+Wj4Cf/AHtdADmbyxHv7EAclFRpnwybSnTHNC+PyWMy2ovnXO/NOmuYopQfWMBVjupAai7b/Izu5w4x4HG7JVSM3w9lH/Y6Z6w9hAW6wi4g5end7xLAuaYaN0q4Mk5L8gzNX3oG9aCDQ4aHsG383Xg2l+6v59tV0Kg1PjER/gr3K40GugAAKEzIcy6IazAAAZcBgFAAAB1Ds3+xxGf7AgAAAAAEWVo=",
  "base64"
);

describe("remote Nix evidence", () => {
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

  test("collects verified NixOS release tar.xz evidence", async () => {
    const graph = nixTarXzGraph(NAR_HASH);
    const evidence = await collectGraphEvidence({
      graph,
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(XZ_TAR, url)
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value).toEqual([expect.objectContaining({
      packageId: graph.nodes[0]!.id,
      source: "tarball",
      warnings: [],
      files: [{ path: "LICENSE", kind: "license", text: "MIT License\n" }]
    })]);
  });

  test("collects verified NixOS channel release tar.xz evidence", async () => {
    const resolved = "https://releases.nixos.org/nixos/25.11/nixos-25.11.5198.e576e3c9cf9b/nixexprs.tar.xz";
    const graph = nixTarXzGraph(NAR_HASH, {
      rev: "e576e3c9cf9bad747afcddd9e34f51d18c855b4e",
      resolved
    });
    const evidence = await collectGraphEvidence({
      graph,
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(XZ_TAR, url)
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value).toEqual([expect.objectContaining({
      packageId: graph.nodes[0]!.id,
      source: "tarball",
      warnings: []
    })]);
  });

  test("fails closed when NixOS release tar.xz exceeds the expanded size limit", async () => {
    const temporaryDirectoriesBefore = nixTemporaryDirectories();
    const evidence = await collectNixTarXzArchiveEvidence({
      packageId: "nixpkgs@fixture",
      tarball: XZ_TAR,
      expectedNarHash: NAR_HASH,
      unpackedMaxBytes: 1
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected bounded XZ decompression to fail.");
    expect(evidence.error).toMatchObject({
      code: "TARBALL_PARSE_FAILED",
      details: { maxUnpackedBytes: 1 }
    });
    expect(nixTemporaryDirectories()).toEqual(temporaryDirectoriesBefore);
  });
});

function nixTemporaryDirectories(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("ohrisk-nix-xz-"))
    .sort();
}

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

function nixTarXzGraph(
  integrity: string,
  overrides: { rev: string; resolved: string } = {
    rev: "ed67bc86e84e51d4a88e73c7fd36006dc876476f",
    resolved: "https://releases.nixos.org/nixpkgs/nixpkgs-26.05pre993032.ed67bc86e84e/nixexprs.tar.xz"
  }
) {
  const { rev, resolved } = overrides;
  return {
    lockfilePath: "flake.lock",
    nodes: [{
      id: `tarball:${resolved}@${rev}`,
      name: `tarball:${resolved}`,
      version: rev,
      ecosystem: "nix" as const,
      resolved,
      integrity,
      dependencyType: "unknown" as const,
      direct: true,
      paths: [["root", "nixpkgs"]]
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
