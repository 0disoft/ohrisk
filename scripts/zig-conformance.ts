import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { collectRemoteZigTarballEvidence } from "../src/evidence/zig-package";
import { parseZigHash } from "../src/graph/zig-zon";

const ZIG_VERSION = "0.16.0";
const PACKAGE_NAME = "ohrisk_conformance";
const PACKAGE_VERSION = "1.2.3-dev.4+build.5";
const PACKAGE_ROOT = "package";
const INCLUDED_PATHS = ["build.zig", "build.zig.zon", "LICENSE", "src"] as const;
const INCLUDED_PATH_LITERALS = [
  "\"build.zig\"",
  "\"build.zig.zon\"",
  "\"LICENSE\"",
  "\"s\\x72\\u{63}\""
] as const;
const FINGERPRINT_ID = 0x12345678;

const repoRoot = path.join(import.meta.dir, "..");
const conformanceRoot = path.join(repoRoot, ".tmp", "zig-conformance");
const zigExecutable = path.join(
  conformanceRoot,
  "tool",
  `zig-x86_64-windows-${ZIG_VERSION}`,
  "zig.exe"
);
const workRoot = path.join(conformanceRoot, "work", String(process.pid));
const packageRoot = path.join(workRoot, PACKAGE_ROOT);
const cacheRoot = path.join(workRoot, "cache");
const referencePath = path.join(repoRoot, "test", "fixtures", "zig-conformance.json");

const packageFiles = new Map<string, string>([
  [
    "build.zig",
    "const std = @import(\"std\");\npub fn build(_: *std.Build) void {}\n"
  ],
  ["LICENSE", "MIT License\n\nCopyright (c) Ohrisk conformance fixture\n"],
  ["src/main.zig", "pub fn answer() u8 { return 42; }\n"],
  ["src/β.zig", "pub const beta = true;\n"],
  ["src/π.zig", "pub const pi = 3.14159;\n"],
  ["excluded/LICENSE-FAKE", "GPL-3.0-only\n"]
]);

const fingerprint = createFingerprint(PACKAGE_NAME, FINGERPRINT_ID);
const manifestText = [
  ".{",
  `    .name = .${PACKAGE_NAME},`,
  `    .version = \"${PACKAGE_VERSION}\",`,
  `    .fingerprint = 0x${fingerprint.toString(16).padStart(16, "0")},`,
  `    .paths = .{ ${INCLUDED_PATH_LITERALS.join(", ")} },`,
  "}"
].join("\n") + "\n";
packageFiles.set("build.zig.zon", manifestText);

function run(): void {
  const update = process.argv.slice(2).includes("--update");
  prepareFixture();

  const zigHash = fetchZigHash();
  const parsedHash = parseZigHash(zigHash);
  if (!parsedHash || parsedHash.format !== "new") {
    throw new Error(`Zig returned an unsupported package hash: ${zigHash}`);
  }
  if (parsedHash.name !== PACKAGE_NAME || parsedHash.version !== PACKAGE_VERSION) {
    throw new Error(`Zig hash identity drifted: ${zigHash}`);
  }

  const evidence = collectRemoteZigTarballEvidence({
    packageId: `pkg:generic/zig/${PACKAGE_NAME}@${PACKAGE_VERSION}`,
    packageName: PACKAGE_NAME,
    tarball: gzipSync(createTarball(packageFiles)),
    expectedHash: zigHash
  });
  if (!evidence.ok) {
    throw new Error(
      `Ohrisk rejected the Zig oracle hash: ${evidence.error.code}: ${evidence.error.message}`
    );
  }
  if (evidence.value.source !== "tarball") {
    throw new Error(`Ohrisk did not verify the Zig oracle hash: ${evidence.value.warnings.join("; ")}`);
  }
  const evidencePaths = evidence.value.files.map((file) => file.path);
  if (evidencePaths.length !== 1 || evidencePaths[0] !== "LICENSE") {
    throw new Error(`Unexpected Zig evidence files: ${evidencePaths.join(", ")}`);
  }

  const reference = {
    schemaVersion: 1,
    zigVersion: ZIG_VERSION,
    packageName: PACKAGE_NAME,
    packageVersion: PACKAGE_VERSION,
    fingerprint: `0x${fingerprint.toString(16).padStart(16, "0")}`,
    paths: [...INCLUDED_PATHS],
    hash: zigHash
  };

  if (update) {
    mkdirSync(path.dirname(referencePath), { recursive: true });
    writeFileSync(referencePath, `${JSON.stringify(reference, null, 2)}\n`, "utf8");
    console.log(`Updated ${path.relative(repoRoot, referencePath)} with Zig ${ZIG_VERSION} oracle data.`);
    return;
  }

  const expected = JSON.parse(readFileSync(referencePath, "utf8")) as unknown;
  if (JSON.stringify(expected) !== JSON.stringify(reference)) {
    throw new Error(
      "Zig conformance reference drifted. Review Zig and Ohrisk behavior, then run the update intent intentionally."
    );
  }

  console.log(`Zig ${ZIG_VERSION} conformance passed: ${zigHash}`);
}

function prepareFixture(): void {
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });

  for (const [relativePath, text] of packageFiles) {
    const destination = path.join(packageRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, text, "utf8");
  }
}

function fetchZigHash(): string {
  const result = spawnSync(
    zigExecutable,
    ["fetch", ".", "--global-cache-dir", cacheRoot],
    {
      cwd: packageRoot,
      encoding: "utf8",
      shell: false
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `Zig fetch failed with exit ${result.status}.`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join("\n")
    );
  }

  const hash = result.stdout.trim();
  if (!hash) {
    throw new Error("Zig fetch returned an empty package hash.");
  }
  return hash;
}

function createFingerprint(name: string, id: number): bigint {
  return (BigInt(crc32(Buffer.from(name, "utf8"))) << 32n) | BigInt(id >>> 0);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createTarball(files: ReadonlyMap<string, string>): Buffer {
  const chunks: Buffer[] = [createTarEntry(`${PACKAGE_ROOT}/`, "", "5")];
  for (const [filePath, text] of files) {
    chunks.push(createTarEntry(`${PACKAGE_ROOT}/${filePath}`, text, "0"));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarEntry(filePath: string, text: string, type: "0" | "5"): Buffer {
  const data = Buffer.from(text, "utf8");
  const header = Buffer.alloc(512);
  const pathBytes = Buffer.from(filePath, "utf8");
  if (pathBytes.length > 100) {
    throw new Error(`Conformance TAR path is too long: ${filePath}`);
  }
  pathBytes.copy(header, 0);
  header.write(type === "5" ? "0000755\0" : "0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length);
  return Buffer.concat([header, data, padding]);
}

if (import.meta.main) {
  run();
}
