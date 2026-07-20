import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectGraphEvidence } from "../src/evidence/collect";
import { createTarGz } from "./helpers/tar";

describe("remote Cargo crate evidence", () => {
  test("fetches an exact checksum-identified crate from the fixed crates.io host", async () => {
    const crate = cargoCrate("risk-crate", "1.2.3", {
      LICENSE: "Apache License\nVersion 2.0, January 2004\n"
    });
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: cargoGraph({
        name: "risk-crate",
        version: "1.2.3",
        integrity: sha256Integrity(crate),
        resolved: "registry+https://github.com/rust-lang/crates.io-index"
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(crate, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchedUrls).toEqual([
      "https://static.crates.io/crates/risk-crate/risk-crate-1.2.3.crate"
    ]);
    expect(evidence.value[0]).toMatchObject({
      packageId: "risk-crate@1.2.3",
      metadataLicense: "Apache-2.0",
      metadataSource: "Cargo.toml",
      source: "tarball",
      warnings: []
    });
    expect(evidence.value[0]?.files.map((file) => file.path)).toEqual(["LICENSE"]);
  });

  test("does not fetch crates without checksums or from non-crates.io sources", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "Cargo.lock",
        nodes: [
          cargoNode({
            name: "missing-checksum",
            version: "1.0.0",
            resolved: "registry+https://github.com/rust-lang/crates.io-index"
          }),
          cargoNode({
            name: "git-crate",
            version: "2.0.0",
            integrity: `sha256-${Buffer.alloc(32).toString("base64")}`,
            resolved: "git+https://github.com/example/git-crate#0123456789abcdef"
          })
        ]
      },
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.alloc(0), url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchCount).toBe(0);
    expect(evidence.value.map((item) => item.source)).toEqual(["unavailable", "unavailable"]);
  });

  test("accepts the exact sparse crates.io source identity", async () => {
    const crate = cargoCrate("sparse-crate", "1.0.0", { LICENSE: "MIT License\n" });
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: cargoGraph({
        name: "sparse-crate",
        version: "1.0.0",
        integrity: sha256Integrity(crate),
        resolved: "registry+https://index.crates.io/"
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(crate, url);
      }
    });

    expect(evidence.ok).toBe(true);
    expect(fetchCount).toBe(1);
  });

  test("rejects private DNS answers before fetching a Cargo crate", async () => {
    const crate = cargoCrate("private-crate", "1.0.0", { LICENSE: "MIT License\n" });
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: cargoGraph({
        name: "private-crate",
        version: "1.0.0",
        integrity: sha256Integrity(crate),
        resolved: "registry+https://github.com/rust-lang/crates.io-index"
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "10.0.0.8", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(crate, url);
      }
    });

    expect(fetchCount).toBe(0);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected private Cargo artifact DNS to fail.");
    expect(evidence.error).toMatchObject({
      code: "TARBALL_FETCH_FAILED",
      details: { artifactHost: "static.crates.io", reason: "private_ipv4" }
    });
  });

  test("rejects a Cargo crate redirect to another host", async () => {
    const crate = cargoCrate("redirect-crate", "1.0.0", { LICENSE: "MIT License\n" });
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: cargoGraph({
        name: "redirect-crate",
        version: "1.0.0",
        integrity: sha256Integrity(crate),
        resolved: "registry+https://github.com/rust-lang/crates.io-index"
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return {
          ok: false,
          status: 302,
          statusText: "Found",
          url,
          headers: {
            get: (name: string) => name.toLowerCase() === "location"
              ? "https://cdn.example.test/redirect-crate-1.0.0.crate"
              : null
          },
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    expect(fetchedUrls).toEqual([
      "https://static.crates.io/crates/redirect-crate/redirect-crate-1.0.0.crate"
    ]);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected cross-host Cargo redirect to fail.");
    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
  });

  test("fails closed on a Cargo checksum mismatch through graph collection", async () => {
    const crate = cargoCrate("mismatch-crate", "1.0.0", { LICENSE: "MIT License\n" });
    const evidence = await collectGraphEvidence({
      graph: cargoGraph({
        name: "mismatch-crate",
        version: "1.0.0",
        integrity: `sha256-${Buffer.alloc(32).toString("base64")}`,
        resolved: "registry+https://github.com/rust-lang/crates.io-index"
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(crate, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected Cargo checksum mismatch to fail.");
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("keeps an offline Cargo cache miss unavailable without network access", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-offline-cache-"));
    let fetchCount = 0;
    try {
      const evidence = await collectGraphEvidence({
        graph: cargoGraph({
          name: "offline-crate",
          version: "1.0.0",
          integrity: `sha256-${Buffer.alloc(32).toString("base64")}`,
          resolved: "registry+https://github.com/rust-lang/crates.io-index"
        }),
        projectRoot: ".",
        allowLocalProjectEvidence: false,
        offline: true,
        cacheDir,
        fetchArtifact: async (url) => {
          fetchCount += 1;
          return artifactResponse(Buffer.alloc(0), url);
        }
      });

      expect(fetchCount).toBe(0);
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

function cargoCrate(
  name: string,
  version: string,
  files: Record<string, string>
): Buffer {
  const root = `${name}-${version}`;
  return createTarGz({
    [`${root}/Cargo.toml`]: [
      "[package]",
      `name = "${name}"`,
      `version = "${version}"`,
      "license = \"Apache-2.0\""
    ].join("\n"),
    ...Object.fromEntries(Object.entries(files).map(([fileName, contents]) => [
      `${root}/${fileName}`,
      contents
    ]))
  });
}

function cargoGraph(input: {
  name: string;
  version: string;
  integrity?: string;
  resolved?: string;
}) {
  return {
    lockfilePath: "Cargo.lock",
    nodes: [cargoNode(input)]
  };
}

function cargoNode(input: {
  name: string;
  version: string;
  integrity?: string;
  resolved?: string;
}) {
  const id = `${input.name}@${input.version}`;
  return {
    id,
    name: input.name,
    version: input.version,
    ecosystem: "cargo" as const,
    ...(input.integrity ? { integrity: input.integrity } : {}),
    ...(input.resolved ? { resolved: input.resolved } : {}),
    dependencyType: "production" as const,
    direct: true,
    paths: [["root", id]]
  };
}

function sha256Integrity(bytes: Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
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
