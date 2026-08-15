import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { collectPubPackageEvidence } from "../src/evidence/pub-package";
import { collectGraphEvidence } from "../src/evidence/collect";
import { createTarGz } from "./helpers/tar";

describe("collectPubPackageEvidence", () => {
  test("reads license evidence from Dart package_config root URIs", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pub-evidence-"));
    const packageDir = path.join(projectRoot, ".pub-cache", "hosted", "pub.dev", "risk_package-1.0.0");

    try {
      mkdirSync(path.join(projectRoot, ".dart_tool"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".dart_tool", "package_config.json"),
        JSON.stringify({
          configVersion: 2,
          packages: [
            {
              name: "risk_package",
              rootUri: "../.pub-cache/hosted/pub.dev/risk_package-1.0.0",
              packageUri: "lib/"
            }
          ]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        [
          "name: risk_package",
          "version: 1.0.0",
          "license: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "SPDX-License-Identifier: AGPL-3.0-only\n", "utf8");

      const evidence = collectPubPackageEvidence({
        packageId: "risk_package@1.0.0",
        packageName: "risk_package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.metadataLicense).toBe("AGPL-3.0-only");
      expect(evidence.value.metadataSource).toBe("pubspec.yaml");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Dart pub evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pub-evidence-limit-"));
    const packageDir = path.join(projectRoot, ".pub-cache", "hosted", "pub.dev", "risk_package-1.0.0");

    try {
      mkdirSync(path.join(projectRoot, ".dart_tool"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".dart_tool", "package_config.json"),
        JSON.stringify({
          configVersion: 2,
          packages: [
            {
              name: "risk_package",
              rootUri: "../.pub-cache/hosted/pub.dev/risk_package-1.0.0",
              packageUri: "lib/"
            }
          ]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        [
          "name: risk_package",
          "version: 1.0.0",
          "license: MIT"
        ].join("\n"),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(packageDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectPubPackageEvidence({
        packageId: "risk_package@1.0.0",
        packageName: "risk_package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).toContain(
        "Dart pub package evidence file limit reached at 50 files."
      );
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Dart pub package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prefers hash-verified pub.dev archives over untrusted local evidence by default", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pub-verified-evidence-"));
    const packageDir = path.join(projectRoot, ".pub-cache", "risk_package-1.0.0");
    const archive = createTarGz({
      "pubspec.yaml": [
        "name: risk_package",
        "version: 1.0.0",
        "license: Apache-2.0"
      ].join("\n"),
      "LICENSE": "Apache License\nVersion 2.0, January 2004\n"
    });
    const fetchedUrls: string[] = [];
    try {
      mkdirSync(path.join(projectRoot, ".dart_tool"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(projectRoot, ".dart_tool", "package_config.json"), JSON.stringify({
        configVersion: 2,
        packages: [{ name: "risk_package", rootUri: "../.pub-cache/risk_package-1.0.0" }]
      }));
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        "name: risk_package\nversion: 1.0.0\nlicense: MIT\n"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "MIT License\n");

      const evidence = await collectGraphEvidence({
        graph: pubGraph({
          resolved: "https://pub.dev/api/archives/risk_package-1.0.0.tar.gz",
          integrity: sha256Integrity(archive)
        }),
        projectRoot,
        resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
        fetchArtifact: async (url) => {
          fetchedUrls.push(url);
          return artifactResponse(archive, url);
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      expect(fetchedUrls).toEqual([
        "https://pub.dev/api/archives/risk_package-1.0.0.tar.gz"
      ]);
      expect(evidence.value[0]).toMatchObject({
        packageId: "risk_package@1.0.0",
        metadataLicense: "Apache-2.0",
        metadataSource: "pubspec.yaml",
        source: "tarball",
        warnings: []
      });
      expect(evidence.value[0]?.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails closed when a pub.dev archive digest does not match the lockfile", async () => {
    const archive = createTarGz({
      "pubspec.yaml": "name: risk_package\nversion: 1.0.0\n",
      "LICENSE": "MIT License\n"
    });
    const evidence = await collectGraphEvidence({
      graph: pubGraph({
        resolved: "https://pub.dev/api/archives/risk_package-1.0.0.tar.gz",
        integrity: `sha256-${Buffer.alloc(32).toString("base64")}`
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(archive, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected pub.dev integrity mismatch.");
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("blocks private pub.dev DNS answers before fetching", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: pubGraph({
        resolved: "https://pub.dev/api/archives/risk_package-1.0.0.tar.gz",
        integrity: `sha256-${Buffer.alloc(32).toString("base64")}`
      }),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "10.0.0.8", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.alloc(0), url);
      }
    });

    expect(fetchCount).toBe(0);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected private pub.dev address rejection.");
    expect(evidence.error).toMatchObject({
      code: "TARBALL_FETCH_FAILED",
      details: { artifactHost: "pub.dev", reason: "private_ipv4" }
    });
  });
});

function pubGraph(input: { resolved: string; integrity: string }) {
  return {
    lockfilePath: "pubspec.lock",
    nodes: [{
      id: "risk_package@1.0.0",
      name: "risk_package",
      version: "1.0.0",
      ecosystem: "pub" as const,
      resolved: input.resolved,
      integrity: input.integrity,
      dependencyType: "production" as const,
      direct: true,
      paths: [["root", "risk_package@1.0.0"]]
    }]
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
