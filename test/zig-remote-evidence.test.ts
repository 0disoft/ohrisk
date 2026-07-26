import { test } from "bun:test";
import { equal } from "node:assert";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { collectRemoteZigTarballEvidence } from "../src/evidence/zig-package";

function createTarEntry(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, "ascii");
  header.write("0000644", 100, "ascii");
  const sizeOctal = data.length.toString(8).padStart(11, "0") + "\x00";
  header.write(sizeOctal, 124, "ascii");
  header.write("0", 156, "ascii");

  // Compute checksum with checksum field as spaces (8 bytes at offset 148)
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\x00 ";
  header.write(checksumStr, 148, "ascii");

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

function createTestTarball(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts = entries.map((e) => createTarEntry(e.name, e.data));
  const zeroBlock = Buffer.alloc(1024, 0); // two zero blocks = end of archive
  const tar = Buffer.concat([...parts, zeroBlock]);
  return gzipSync(tar);
}

function computeZigOldHash(files: Array<{ path: string; data: Buffer }>): string {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const perFileHashes: Buffer[] = [];
  for (const entry of sorted) {
    const hasher = createHash("sha256");
    hasher.update(entry.path);
    hasher.update(Buffer.from([0, 0]));
    hasher.update(entry.data);
    perFileHashes.push(hasher.digest());
  }
  const overallHasher = createHash("sha256");
  for (const h of perFileHashes) overallHasher.update(h);
  return "1220" + overallHasher.digest("hex");
}

test("collectRemoteZigTarballEvidence > verifies old-format hash and collects license evidence", () => {
  const licenseData = Buffer.from("MIT License\n\nCopyright (c) 2024 Test");
  const buildZigData = Buffer.from('const std = @import("std");\n');

  const tarball = createTestTarball([
    { name: "test-pkg/LICENSE", data: licenseData },
    { name: "test-pkg/build.zig", data: buildZigData }
  ]);

  const expectedHash = computeZigOldHash([
    { path: "LICENSE", data: licenseData },
    { path: "build.zig", data: buildZigData }
  ]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "test-pkg@unknown",
    packageName: "test-pkg",
    tarball,
    expectedHash
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "tarball");
  equal(result.value.files.length, 1);
  equal(result.value.files[0]!.path, "LICENSE");
  equal(result.value.files[0]!.kind, "license");
  equal(result.value.warnings === undefined || result.value.warnings.length === 0, true);
});

test("collectRemoteZigTarballEvidence > collects evidence with unverified warning for unknown hash format", () => {
  const licenseData = Buffer.from("MIT License");

  const tarball = createTestTarball([
    { name: "pkg/LICENSE", data: licenseData }
  ]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "pkg@unknown",
    packageName: "pkg",
    tarball,
    expectedHash: "invalid-hash-format"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "tarball");
  equal(result.value.files.length, 1);
  equal(result.value.warnings!.length > 0, true);
  equal(result.value.warnings![0]!.includes("not verifiable"), true);
});

test("collectRemoteZigTarballEvidence > handles tarball with no license file", () => {
  const srcData = Buffer.from('const std = @import("std");\n');

  const tarball = createTestTarball([
    { name: "pkg/src/main.zig", data: srcData }
  ]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "pkg@unknown",
    packageName: "pkg",
    tarball,
    expectedHash: "unknown"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.files.length, 0);
  equal(result.value.warnings!.some((w) => w.includes("No LICENSE")), true);
});

test("collectRemoteZigTarballEvidence > collects multiple evidence files from tarball", () => {
  const licenseData = Buffer.from("MIT License");
  const noticeData = Buffer.from("NOTICE: This is test software.");
  const copyingData = Buffer.from("Copying permitted under MIT.");

  const tarball = createTestTarball([
    { name: "pkg/LICENSE", data: licenseData },
    { name: "pkg/NOTICE", data: noticeData },
    { name: "pkg/COPYING", data: copyingData }
  ]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "pkg@unknown",
    packageName: "pkg",
    tarball,
    expectedHash: "unknown"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.files.length, 3);
  const paths = result.value.files.map((f) => f.path).sort();
  equal(paths[0], "COPYING");
  equal(paths[1], "LICENSE");
  equal(paths[2], "NOTICE");
});
