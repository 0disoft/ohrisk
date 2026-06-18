import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { collectGraphEvidence } from "../src/evidence/collect";
import { collectLocalPackageEvidence } from "../src/evidence/local-package";
import { collectTarballEvidence } from "../src/evidence/tarball";
import { parseBunLockfile } from "../src/graph/npm-bun-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const bunProjectDir = path.join(fixturesDir, "bun-project");

describe("collectLocalPackageEvidence", () => {
  test("reads package metadata and license files", () => {
    const result = collectLocalPackageEvidence({
      packageId: "permissive-parent@1.0.0",
      packageDir: path.join(bunProjectDir, ".registry", "permissive-parent")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicense).toBe("MIT");
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files[0]?.path).toBe("LICENSE");
    expect(result.value.files[0]?.kind).toBe("license");
    expect(result.value.files[0]?.text).toContain("MIT License");
    expect(result.value.files[0]?.text).toContain("Permission is hereby granted");
    expect(result.value.warnings).toEqual([]);
  });
});

describe("collectTarballEvidence", () => {
  test("reads package metadata and license files from a gzipped tarball", () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "tarball-fixture",
        version: "1.0.0",
        license: "Apache-2.0"
      }),
      "package/LICENSE": "Apache License fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-fixture@1.0.0",
      tarball
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicense).toBe("Apache-2.0");
    expect(result.value.files).toEqual([
      {
        path: "LICENSE",
        kind: "license",
        text: "Apache License fixture text."
      }
    ]);
  });
});

describe("collectGraphEvidence", () => {
  test("collects evidence for every package in a parsed graph", () => {
    const graph = parseBunLockfile(path.join(bunProjectDir, "bun.lock"));

    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      throw new Error(graph.error.message);
    }

    const evidence = collectGraphEvidence({
      graph: graph.value,
      projectRoot: bunProjectDir
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toHaveLength(6);
    expect(evidence.value.map((item) => item.packageId)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "dual-license@2.0.0",
      "gpl-package@5.0.0",
      "missing-license@4.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(evidence.value.flatMap((item) => item.files)).toHaveLength(5);
    const missingLicense = evidence.value.find((item) => item.packageId === "missing-license@4.0.0");
    expect(missingLicense).toMatchObject({
      files: [],
      warnings: ["No LICENSE, LICENCE, COPYING, or NOTICE file found."]
    });
    expect(missingLicense).not.toHaveProperty("packageJsonLicense");
  });
});

function createTarGz(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const header = Buffer.alloc(512);

    header.write(filePath, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(" ", 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

    chunks.push(header, data, Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length));
  }

  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
