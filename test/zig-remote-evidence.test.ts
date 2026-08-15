import { test } from "bun:test";
import { equal, ok as assertOk } from "node:assert";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { collectRemoteZigTarballEvidence } from "../src/evidence/zig-package";
import { extractZigManifestMetadata } from "../src/graph/zig-zon";

function createTarEntry(name: string, data: Buffer, type = "0", linkName = ""): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, "latin1");
  header.write("0000644", 100, "ascii");
  const sizeOctal = data.length.toString(8).padStart(11, "0") + "\x00";
  header.write(sizeOctal, 124, "ascii");
  header.write(type, 156, "ascii");
  header.write(linkName, 157, 100, "latin1");

  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  const checksumStr = checksum.toString(8).padStart(6, "0") + "\x00 ";
  header.write(checksumStr, 148, "ascii");

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

function createTestTarball(entries: Array<{
  name: string;
  data: Buffer;
  type?: string;
  linkName?: string;
}>): Buffer {
  const parts = entries.map((entry) =>
    createTarEntry(entry.name, entry.data, entry.type, entry.linkName)
  );
  const zeroBlock = Buffer.alloc(1024, 0);
  const tar = Buffer.concat([...parts, zeroBlock]);
  return gzipSync(tar);
}

function computeZigHashData(files: Array<{ path: string; data: Buffer }>): { digest: Buffer; totalSize: number } {
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path, "latin1"), Buffer.from(b.path, "latin1"))
  );
  const perFileHashes: Buffer[] = [];
  let totalSize = 0;
  for (const entry of sorted) {
    const hasher = createHash("sha256");
    hasher.update(Buffer.from(entry.path, "latin1"));
    hasher.update(Buffer.from([0, 0]));
    hasher.update(entry.data);
    perFileHashes.push(hasher.digest());
    totalSize += entry.data.length;
  }
  const overallHasher = createHash("sha256");
  for (const h of perFileHashes) overallHasher.update(h);
  return { digest: overallHasher.digest(), totalSize };
}

function computeZigOldHash(files: Array<{ path: string; data: Buffer }>): string {
  return "1220" + computeZigHashData(files).digest.toString("hex");
}

function computeZigNewHash(
  files: Array<{ path: string; data: Buffer }>,
  name: string,
  version: string,
  fingerprint: bigint
): string {
  const { digest, totalSize } = computeZigHashData(files);
  const id = Number(fingerprint & 0xFFFFFFFFn);
  const saturatedSize = Math.min(totalSize, 0xFFFFFFFF);

  const hashplus = Buffer.alloc(33);
  hashplus.writeUInt32LE(id, 0);
  hashplus.writeUInt32LE(saturatedSize, 4);
  digest.subarray(0, 25).copy(hashplus, 8);

  const hashplusB64 = hashplus.toString("base64url");
  return `${name}-${version}-${hashplusB64}`;
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

test("collectRemoteZigTarballEvidence > ignores a global PAX metadata header like Zig", () => {
  const licenseData = Buffer.from("MIT License");
  const buildZigData = Buffer.from('const std = @import("std");\n');
  const tarball = createTestTarball([
    {
      name: "pax_global_header",
      data: Buffer.from("52 comment=github.com/zigtools/zls archive metadata\n"),
      type: "g"
    },
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
  equal(result.value.files.length, 1);
  equal(result.value.files[0]?.path, "LICENSE");
});

test("collectRemoteZigTarballEvidence > verifies new-format hash with fingerprint from build.zig.zon", () => {
  const licenseData = Buffer.from("MIT License\n\nCopyright (c) 2024 Test");
  const buildZigData = Buffer.from('const std = @import("std");\n');

  const zonContent = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "" },
    .dependencies = .{},
}`);

  const files = [
    { path: "LICENSE", data: licenseData },
    { path: "build.zig", data: buildZigData },
    { path: "build.zig.zon", data: zonContent }
  ];

  const tarball = createTestTarball([
    { name: "zls/LICENSE", data: licenseData },
    { name: "zls/build.zig", data: buildZigData },
    { name: "zls/build.zig.zon", data: zonContent }
  ]);

  const expectedHash = computeZigNewHash(files, "zls", "0.17.0-dev", 0xa66330b97eb969aen);

  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    tarball,
    expectedHash
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "tarball");
  equal(result.value.files.length, 1);
  equal(result.value.warnings === undefined || result.value.warnings.length === 0, true);
});

test("collectRemoteZigTarballEvidence > withholds evidence for invalid fingerprint underscores", () => {
  for (const fingerprint of [
    "0x_c96e70cf00000001",
    "0xc96e__70cf00000001",
    "0xc96e70cf00000001_"
  ]) {
    const licenseData = Buffer.from("MIT License");
    const zonContent = Buffer.from(`.{
      .name = .app,
      .version = "1.0.0",
      .fingerprint = ${fingerprint},
      .paths = .{ "" },
      .dependencies = .{},
    }`);
    const files = [
      { path: "LICENSE", data: licenseData },
      { path: "build.zig.zon", data: zonContent }
    ];
    const result = collectRemoteZigTarballEvidence({
      packageId: "app@1.0.0",
      packageName: "app",
      tarball: createTestTarball(files.map((entry) => ({
        name: `app/${entry.path}`,
        data: entry.data
      }))),
      expectedHash: computeZigNewHash(files, "app", "1.0.0", 0xc96e70cf00000001n)
    });

    equal(result.ok, true);
    if (!result.ok) continue;
    equal(result.value.source, "unavailable");
    equal(result.value.files.length, 0);
    equal(result.value.warnings?.some((warning) => warning.includes("invalid build.zig.zon")), true);
  }
});

test("collectRemoteZigTarballEvidence > verifies Zig's new-format hash for a naked tarball", () => {
  const licenseData = Buffer.from("BSD 3-Clause License");
  const buildZigData = Buffer.from('const std = @import("std");\n');
  const files = [
    { path: "LICENSE", data: licenseData },
    { path: "build.zig", data: buildZigData }
  ];
  const tarball = createTestTarball([
    { name: "tracy/LICENSE", data: licenseData },
    { name: "tracy/build.zig", data: buildZigData }
  ]);
  const expectedHash = computeZigNewHash(files, "N", "V", 0xffffn);

  const result = collectRemoteZigTarballEvidence({
    packageId: "tracy@0.13.1",
    packageName: "tracy",
    tarball,
    expectedHash
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "tarball");
  equal(result.value.files.length, 1);
  equal(result.value.files[0]?.path, "LICENSE");
});

test("collectRemoteZigTarballEvidence > fails closed on new-format hash mismatch", () => {
  const licenseData = Buffer.from("MIT License");
  const zonContent = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "" },
    .dependencies = .{},
}`);

  const files = [
    { path: "LICENSE", data: licenseData },
    { path: "build.zig.zon", data: zonContent }
  ];

  const tarball = createTestTarball([
    { name: "zls/LICENSE", data: licenseData },
    { name: "zls/build.zig.zon", data: zonContent }
  ]);

  // Keep the zls checksum valid while using a different package ID.
  const wrongHash = computeZigNewHash(files, "zls", "0.17.0-dev", 0xa66330b912345678n);

  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    tarball,
    expectedHash: wrongHash
  });

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "PACKAGE_INTEGRITY_CHECK_FAILED");
});

test("collectRemoteZigTarballEvidence > withholds new-hash evidence when .paths is missing or empty", () => {
  const licenseData = Buffer.from("MIT License");

  for (const pathsField of ["", "    .paths = .{},\n"]) {
    const zonContent = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
${pathsField}    .dependencies = .{},
}`);
    const files = [
      { path: "LICENSE", data: licenseData },
      { path: "build.zig.zon", data: zonContent }
    ];
    const result = collectRemoteZigTarballEvidence({
      packageId: "zls@0.17.0-dev",
      packageName: "zls",
      tarball: createTestTarball(files.map((entry) => ({
        name: `zls/${entry.path}`,
        data: entry.data
      }))),
      expectedHash: computeZigNewHash(files, "zls", "0.17.0-dev", 0xa66330b97eb969aen)
    });

    equal(result.ok, true);
    if (!result.ok) continue;
    equal(result.value.source, "unavailable");
    equal(result.value.files.length, 0);
    equal(result.value.warnings?.some((warning) => warning.includes("non-empty .paths")), true);
  }
});

test("collectRemoteZigTarballEvidence > withholds evidence for unsupported ZON string escapes", () => {
  const licenseData = Buffer.from("MIT License");
  const zonContent = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "" },
    .unknown = "bad\\q",
    .dependencies = .{},
}`);
  const files = [
    { path: "LICENSE", data: licenseData },
    { path: "build.zig.zon", data: zonContent }
  ];
  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    tarball: createTestTarball(files.map((entry) => ({
      name: `zls/${entry.path}`,
      data: entry.data
    }))),
    expectedHash: computeZigNewHash(files, "zls", "0.17.0-dev", 0xa66330b97eb969aen)
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "unavailable");
  equal(result.value.files.length, 0);
  equal(result.value.warnings?.some((warning) => warning.includes("invalid build.zig.zon")), true);
});

test("extractZigManifestMetadata > extracts name, version, and fingerprint", () => {
  const zon = `.{\n    .name = .zls,\n    .version = "0.17.0-dev",\n    .fingerprint = 0xa66330b97eb969ae,\n    .dependencies = .{},\n}`;
  const meta = extractZigManifestMetadata(zon);

  assertOk(meta !== undefined);
  if (!meta) return;
  equal(meta.name, "zls");
  equal(meta.version, "0.17.0-dev");
  equal(meta.fingerprint, 0xa66330b97eb969aen);
});

test("extractZigManifestMetadata > rejects invalid fingerprint checksums and IDs", () => {
  for (const fingerprint of ["0x000000017eb969ae", "0xa66330b900000000", "0xa66330b9ffffffff"]) {
    const zon = `.{\n    .name = .zls,\n    .version = "0.17.0-dev",\n    .fingerprint = ${fingerprint},\n    .dependencies = .{},\n}`;
    equal(extractZigManifestMetadata(zon), undefined);
  }
});

test("extractZigManifestMetadata > rejects invalid paths field shapes", () => {
  const invalidPaths = [
    `"LICENSE"`,
    `.{ .named = "LICENSE" }`,
    `.{ "LICENSE", .unexpected }`
  ];

  for (const paths of invalidPaths) {
    const zon = `.{\n    .name = .zls,\n    .version = "0.17.0-dev",\n    .fingerprint = 0xa66330b97eb969ae,\n    .paths = ${paths},\n}`;
    equal(extractZigManifestMetadata(zon), undefined);
  }
});

test("extractZigManifestMetadata > rejects invalid Zig names and versions", () => {
  const invalidMetadata = [
    { name: `.${"a".repeat(33)}`, version: "1.0.0" },
    { name: ".zls", version: "not-semver" },
    { name: ".zls", version: "1".repeat(33) }
  ];

  for (const metadata of invalidMetadata) {
    const zon = `.{
      .name = ${metadata.name},
      .version = "${metadata.version}",
      .dependencies = .{},
    }`;
    equal(extractZigManifestMetadata(zon), undefined);
  }
});

test("extractZigManifestMetadata > returns undefined for manifest without fingerprint", () => {
  const zon = `.{\n    .name = .nofp,\n    .version = "0.1.0",\n    .dependencies = .{},\n}`;
  const meta = extractZigManifestMetadata(zon);

  assertOk(meta !== undefined);
  if (!meta) return;
  equal(meta.name, "nofp");
  equal(meta.version, "0.1.0");
  equal(meta.fingerprint, undefined);
});

test("collectRemoteZigTarballEvidence > withholds evidence for an unverifiable hash format", () => {
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

  equal(result.value.source, "unavailable");
  equal(result.value.files.length, 0);
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
    expectedHash: computeZigOldHash([
      { path: "src/main.zig", data: srcData }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.files.length, 0);
  equal(result.value.warnings!.some((w) => w.includes("No supported license")), true);
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
    expectedHash: computeZigOldHash([
      { path: "LICENSE", data: licenseData },
      { path: "NOTICE", data: noticeData },
      { path: "COPYING", data: copyingData }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.files.length, 3);
  const paths = result.value.files.map((f) => f.path).sort();
  equal(paths[0], "COPYING");
  equal(paths[1], "LICENSE");
  equal(paths[2], "NOTICE");
});

test("collectRemoteZigTarballEvidence > ignores license files excluded by manifest paths", () => {
  const manifest = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "build.zig.zon" },
  }`);
  const license = Buffer.from("attacker-controlled license");
  const expectedHash = computeZigNewHash(
    [{ path: "build.zig.zon", data: manifest }],
    "zls",
    "0.17.0-dev",
    0xa66330b97eb969aen
  );

  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    expectedHash,
    tarball: createTestTarball([
      { name: "pkg/build.zig.zon", data: manifest },
      { name: "pkg/LICENSE", data: license }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "tarball");
  equal(result.value.files.length, 0);
  equal(result.value.warnings?.some((warning) => warning.includes("No supported license")), true);
});

test("collectRemoteZigTarballEvidence > preserves non-UTF-8 path bytes for filtering and hashing", () => {
  const binaryDirectory = String.fromCharCode(0x80);
  const manifest = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "\\x80" },
  }`);
  const license = Buffer.from("MIT License");
  const binaryLicensePath = `${binaryDirectory}/LICENSE`;
  const expectedHash = computeZigNewHash(
    [{ path: binaryLicensePath, data: license }],
    "zls",
    "0.17.0-dev",
    0xa66330b97eb969aen
  );

  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    expectedHash,
    tarball: createTestTarball([
      { name: "pkg/build.zig.zon", data: manifest },
      { name: `pkg/${binaryLicensePath}`, data: license }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "tarball");
  equal(result.value.files[0]?.path, binaryLicensePath);
});

test("collectRemoteZigTarballEvidence > normalizes relative manifest paths like Zig", () => {
  const manifest = Buffer.from(`.{
    .name = .zls,
    .version = "0.17.0-dev",
    .fingerprint = 0xa66330b97eb969ae,
    .paths = .{ "./LICENSE", "build.zig.zon" },
  }`);
  const license = Buffer.from("MIT License");
  const expectedHash = computeZigNewHash(
    [
      { path: "build.zig.zon", data: manifest },
      { path: "LICENSE", data: license }
    ],
    "zls",
    "0.17.0-dev",
    0xa66330b97eb969aen
  );

  const result = collectRemoteZigTarballEvidence({
    packageId: "zls@0.17.0-dev",
    packageName: "zls",
    expectedHash,
    tarball: createTestTarball([
      { name: "pkg/build.zig.zon", data: manifest },
      { name: "pkg/LICENSE", data: license }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.files.length, 1);
  equal(result.value.files[0]!.path, "LICENSE");
});

test("collectRemoteZigTarballEvidence > fails closed when an ignored symlink changes Zig hash", () => {
  const license = Buffer.from("MIT License");
  const expectedHash = computeZigOldHash([{ path: "LICENSE", data: license }]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash,
    tarball: createTestTarball([
      { name: "pkg/LICENSE", data: license },
      { name: "pkg/license-link", data: Buffer.alloc(0), type: "2", linkName: "LICENSE" }
    ])
  });

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "TARBALL_PARSE_FAILED");
});

test("collectRemoteZigTarballEvidence > preserves paths when tarball has no common root", () => {
  const readme = Buffer.from("root readme");
  const license = Buffer.from("MIT License");
  const expectedHash = computeZigOldHash([
    { path: "README", data: readme },
    { path: "pkg/LICENSE", data: license }
  ]);

  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash,
    tarball: createTestTarball([
      { name: "README", data: readme },
      { name: "pkg/LICENSE", data: license }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.files.length, 1);
  equal(result.value.files[0]!.path, "pkg/LICENSE");
});

test("collectRemoteZigTarballEvidence > rejects unsafe and noncanonical paths", () => {
  for (const unsafePath of [
    "C:\\LICENSE",
    "pkg\\..\\LICENSE",
    "./pkg/LICENSE",
    "pkg/./LICENSE",
    "pkg//LICENSE"
  ]) {
    const result = collectRemoteZigTarballEvidence({
      packageId: "mypkg@1.0.0",
      packageName: "mypkg",
      expectedHash: `1220${"0".repeat(64)}`,
      tarball: createTestTarball([
        { name: unsafePath, data: Buffer.from("MIT License") }
      ])
    });

    equal(result.ok, false);
    if (result.ok) continue;
    equal(result.error.code, "TARBALL_PARSE_FAILED");
  }
});

test("collectRemoteZigTarballEvidence > preserves trailing spaces in the Zig hash path", () => {
  const license = Buffer.from("MIT License");
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash([{ path: "LICENSE", data: license }]),
    tarball: createTestTarball([
      { name: "pkg/LICENSE ", data: license }
    ])
  });

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "PACKAGE_INTEGRITY_CHECK_FAILED");
});

test("collectRemoteZigTarballEvidence > rejects truncated tar entry padding", () => {
  const license = Buffer.from("MIT");
  const truncatedTar = createTarEntry("pkg/LICENSE", license).subarray(0, 512 + license.length);
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash([{ path: "LICENSE", data: license }]),
    tarball: gzipSync(truncatedTar)
  });

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "TARBALL_PARSE_FAILED");
});

test("collectRemoteZigTarballEvidence > rejects a trailing partial tar header", () => {
  const license = Buffer.from("MIT");
  const partialHeaderTar = Buffer.concat([
    createTarEntry("pkg/LICENSE", license),
    Buffer.alloc(511, 0x61)
  ]);
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash([{ path: "LICENSE", data: license }]),
    tarball: gzipSync(partialHeaderTar)
  });

  equal(result.ok, false);
  if (result.ok) return;
  equal(result.error.code, "TARBALL_PARSE_FAILED");
});

test("collectRemoteZigTarballEvidence > includes directory entries when detecting the tar root", () => {
  const license = Buffer.from("MIT License");
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash([{ path: "pkg/LICENSE", data: license }]),
    tarball: createTestTarball([
      { name: "noise/", data: Buffer.alloc(0), type: "5" },
      { name: "pkg/LICENSE", data: license }
    ])
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "tarball");
  equal(result.value.files[0]!.path, "pkg/LICENSE");
});

test("collectRemoteZigTarballEvidence > withholds old-hash evidence for an invalid manifest", () => {
  const license = Buffer.from("MIT License");
  const invalidManifest = Buffer.from(`.{
    .name = .mypkg,
    .version = "not-semver",
    .dependencies = .{},
  }`);
  const files = [
    { path: "LICENSE", data: license },
    { path: "build.zig.zon", data: invalidManifest }
  ];
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash(files),
    tarball: createTestTarball(files.map((entry) => ({
      name: `pkg/${entry.path}`,
      data: entry.data
    })))
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "unavailable");
  equal(result.value.files.length, 0);
  equal(result.value.warnings?.some((warning) => warning.includes("invalid build.zig.zon")), true);
});

test("collectRemoteZigTarballEvidence > withholds old-hash evidence for malformed manifest dependencies", () => {
  const license = Buffer.from("MIT License");
  const invalidManifest = Buffer.from(`.{
    .name = .mypkg,
    .version = "1.0.0",
    .dependencies = .{ .dep = .{ .path = "vendor/dep", .hash = 123 } },
  }`);
  const files = [
    { path: "LICENSE", data: license },
    { path: "build.zig.zon", data: invalidManifest }
  ];
  const result = collectRemoteZigTarballEvidence({
    packageId: "mypkg@1.0.0",
    packageName: "mypkg",
    expectedHash: computeZigOldHash(files),
    tarball: createTestTarball(files.map((entry) => ({
      name: `pkg/${entry.path}`,
      data: entry.data
    })))
  });

  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value.source, "unavailable");
  equal(result.value.files.length, 0);
});
