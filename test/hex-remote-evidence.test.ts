import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { collectGraphEvidence } from "../src/evidence/collect";
import { createTarEntries, createTarGz } from "./helpers/tar";

describe("remote Hex package evidence", () => {
  test("collects license evidence from the checksum-verified public Hex tarball", async () => {
    const tarball = hexTarball("risk_hex", "1.2.3", ["Apache-2.0"], {
      LICENSE: "Apache License\nVersion 2.0, January 2004\n"
    });
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: hexGraph("risk_hex", "1.2.3", tarball),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(tarball, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(fetchedUrls).toEqual(["https://repo.hex.pm/tarballs/risk_hex-1.2.3.tar"]);
    expect(evidence.value).toEqual([expect.objectContaining({
      packageId: "risk_hex@1.2.3",
      metadataLicense: "Apache-2.0",
      metadataSource: "metadata.config",
      source: "tarball",
      warnings: [],
      files: [expect.objectContaining({ path: "LICENSE", kind: "license" })]
    })]);
  });

  test("fails closed when the public Hex tarball differs from mix.lock", async () => {
    const tarball = hexTarball("risk_hex", "1.2.3", ["MIT"], { LICENSE: "MIT License\n" });
    const graph = hexGraph("risk_hex", "1.2.3", tarball);
    graph.nodes[0]!.integrity = `sha256-${Buffer.alloc(32).toString("base64")}`;

    const evidence = await collectGraphEvidence({
      graph,
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(tarball, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected Hex checksum mismatch to fail.");
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("fails closed when verified Hex metadata has a different identity", async () => {
    const tarball = hexTarball("other_hex", "1.2.3", ["MIT"], { LICENSE: "MIT License\n" });
    const evidence = await collectGraphEvidence({
      graph: hexGraph("risk_hex", "1.2.3", tarball),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(tarball, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected Hex identity mismatch to fail.");
    expect(evidence.error.details?.reason).toBe("hex_package_identity_mismatch");
  });
});

function hexGraph(name: string, version: string, tarball: Buffer) {
  const id = `${name}@${version}`;
  return {
    lockfilePath: "mix.lock",
    nodes: [{
      id,
      name,
      version,
      ecosystem: "hex" as const,
      resolved: `https://repo.hex.pm/tarballs/${name}-${version}.tar`,
      integrity: sha256Integrity(tarball),
      dependencyType: "production" as const,
      direct: true,
      paths: [["root", id]]
    }]
  };
}

function hexTarball(
  name: string,
  version: string,
  licenses: string[],
  files: Record<string, string>
): Buffer {
  const versionBytes = Buffer.from("3");
  const metadata = Buffer.from([
    `{<<"name">>,<<"${name}">>}.`,
    `{<<"version">>,<<"${version}">>}.`,
    `{<<"licenses">>,[${licenses.map((license) => `<<"${license}">>`).join(",")}]}.`
  ].join("\n"));
  const contents = createTarGz(files);
  const checksum = createHash("sha256")
    .update(versionBytes)
    .update(metadata)
    .update(contents)
    .digest("hex")
    .toUpperCase();

  return createTarEntries([
    { path: "VERSION", content: versionBytes },
    { path: "metadata.config", content: metadata },
    { path: "contents.tar.gz", content: contents },
    { path: "CHECKSUM", content: checksum }
  ]);
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
