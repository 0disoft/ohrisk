import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { readArchiveBytes, readArchiveFile } from "../src/archive/archive-reader";
import type { OhriskError } from "../src/shared/errors";
import type { Result } from "../src/shared/result";
import { createTar, createTarEntries } from "./helpers/tar";
import { createZip, createZipEntries } from "./helpers/zip";

describe("archive reader", () => {
  test("accepts zero-length Gradle JAR directories with DOS directory and regular Unix bits", () => {
    const bytes = createZip({ "META-INF": "" });
    const centralOffset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralOffset).toBeGreaterThanOrEqual(0);
    bytes.writeUInt32LE(0x81a40010, centralOffset + 38);

    const result = readArchiveBytes({
      displayName: "gradle.jar",
      bytes,
      formatHint: "zip"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.entries).toEqual([
      expect.objectContaining({ path: "META-INF", type: "directory", size: 0 })
    ]);
  });

  test("accepts the exact two-byte empty deflate encoding used by Gradle JAR directories", () => {
    const bytes = createZipEntries([{
      path: "META-INF/",
      data: "",
      directory: true,
      method: 8
    }]);
    const result = readArchiveBytes({
      displayName: "gradle-empty-directory.jar",
      bytes,
      formatHint: "zip"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.entries).toEqual([
      expect.objectContaining({
        path: "META-INF",
        type: "directory",
        size: 0,
        compressedSize: 2
      })
    ]);
  });

  test("indexes stored and deflated ZIP files and materializes them lazily", () => {
    for (const deflate of [false, true]) {
      const bytes = createZip(
        {
          "project/package-lock.json": "{\"lockfileVersion\":3}",
          "project/README.md": "hello"
        },
        { deflate }
      );
      const result = readArchiveBytes({ displayName: "fixture.zip", bytes });

      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.format).toBe("zip");
      expect(result.value.displayPath).toBe("fixture.zip");
      expect(result.value.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(result.value.listPaths()).toEqual([
        "project/README.md",
        "project/package-lock.json"
      ]);
      expect(result.value.readText("project/README.md")).toEqual({ ok: true, value: "hello" });
    }
  });

  test("snapshots caller-owned bytes before indexing lazy entries", () => {
    const bytes = createZip({ "data.txt": "stable" });
    const result = readArchiveBytes({ displayName: "snapshot.zip", bytes });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dataOffset = 30 + Buffer.byteLength("data.txt");
    bytes[dataOffset] = "X".charCodeAt(0);
    expect(result.value.readText("data.txt")).toEqual({ ok: true, value: "stable" });
  });

  test("owns file bytes after the exact-size read completes", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ohrisk-archive-reader-"));
    const archivePath = join(cwd, "fixture.zip");
    try {
      writeFileSync(archivePath, createZip({ "data.txt": "from file" }));
      const result = readArchiveFile({ cwd, archivePath: "fixture.zip" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      writeFileSync(archivePath, createZip({ "data.txt": "replaced" }));
      expect(result.value.readText("data.txt")).toEqual({ ok: true, value: "from file" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("indexes plain TAR and TAR.GZ without changing nested archive files", () => {
    const tar = createTar({
      "bundle/data.zip": "opaque nested bytes",
      "bundle/package-lock.json": "{}"
    });
    for (const fixture of [
      { displayName: "fixture.tar", bytes: tar, format: "tar" },
      { displayName: "fixture.tgz", bytes: gzipSync(tar), format: "tar.gz" }
    ] as const) {
      const result = readArchiveBytes({ displayName: fixture.displayName, bytes: fixture.bytes });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.format).toBe(fixture.format);
      expect(result.value.listPaths()).toEqual([
        "bundle/data.zip",
        "bundle/package-lock.json"
      ]);
      expect(result.value.readText("bundle/data.zip")).toEqual({
        ok: true,
        value: "opaque nested bytes"
      });
    }
  });

  test("applies safe PAX paths and GNU longname records", () => {
    const paxPath = `pax/${"segment/".repeat(12)}file.txt`;
    const gnuPath = `gnu/${"long-".repeat(24)}name.txt`;
    const bytes = createTarEntries([
      { path: "PaxHeader", type: "x", content: paxRecord("path", paxPath) },
      { path: "ignored-pax-name", content: "pax" },
      { path: "././@LongLink", type: "L", content: Buffer.from(`${gnuPath}\0`, "utf8") },
      { path: "ignored-gnu-name", content: "gnu" }
    ]);
    const result = readArchiveBytes({ displayName: "extended.tar", bytes });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.listPaths()).toEqual([gnuPath, paxPath].sort());
    expect(result.value.readText(paxPath)).toEqual({ ok: true, value: "pax" });
    expect(result.value.readText(gnuPath)).toEqual({ ok: true, value: "gnu" });
  });

  test("rejects traversal, Windows aliases, and non-NFC entry paths", () => {
    for (const entryPath of [
      "../escape.txt",
      "/absolute.txt",
      "C:/drive.txt",
      "server\\share.txt",
      "folder//empty.txt",
      "folder/./dot.txt",
      "folder/name:stream",
      "folder/CON.txt",
      "folder/trailing. ",
      "cafe\u0301.txt"
    ]) {
      const result = readArchiveBytes({
        displayName: "unsafe.zip",
        bytes: createZipEntries([{ path: entryPath, data: "x" }])
      });
      expect(errorCode(result)).toBe("ARCHIVE_ENTRY_PATH_INVALID");
    }
  });

  test("rejects duplicate paths and file-directory prefix collisions", () => {
    const duplicateResult = readArchiveBytes({
      displayName: "duplicate.zip",
      bytes: createZipEntries([
        { path: "same.txt", data: "one" },
        { path: "same.txt", data: "two" }
      ])
    });
    expect(errorCode(duplicateResult)).toBe("ARCHIVE_DUPLICATE_ENTRY");

    const collisionResult = readArchiveBytes({
      displayName: "collision.tar",
      bytes: createTarEntries([
        { path: "node", content: "file" },
        { path: "node/child", content: "child" }
      ])
    });
    expect(errorCode(collisionResult)).toBe("ARCHIVE_DUPLICATE_ENTRY");

    const reverseCollisionResult = readArchiveBytes({
      displayName: "reverse-collision.tar",
      bytes: createTarEntries([
        { path: "node/child", content: "child" },
        { path: "NODE", content: "file" }
      ])
    });
    expect(errorCode(reverseCollisionResult)).toBe("ARCHIVE_DUPLICATE_ENTRY");

    const caseAliasResult = readArchiveBytes({
      displayName: "case-alias.zip",
      bytes: createZipEntries([
        { path: "App/lock.json", data: "one" },
        { path: "app/LOCK.json", data: "two" }
      ])
    });
    expect(errorCode(caseAliasResult)).toBe("ARCHIVE_DUPLICATE_ENTRY");
  });

  test("rejects TAR links and other non-regular entry types", () => {
    for (const type of ["1", "2", "3", "4", "6", "S", "Z"]) {
      const result = readArchiveBytes({
        displayName: "type.tar",
        bytes: createTarEntries([{ path: "unsafe", type, linkPath: "target" }])
      });
      expect(errorCode(result)).toBe("ARCHIVE_ENTRY_TYPE_UNSUPPORTED");
    }
  });

  test("checks ZIP CRC32 when an entry is materialized", () => {
    const bytes = createZip({ "data.txt": "crc protected" });
    const dataOffset = 30 + Buffer.byteLength("data.txt");
    bytes[dataOffset] = (bytes[dataOffset] ?? 0) ^ 0xff;
    const archive = readArchiveBytes({ displayName: "crc.zip", bytes });

    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    expect(errorCode(archive.value.readEntry("data.txt"))).toBe("ARCHIVE_INTEGRITY_FAILED");
  });

  test("starts a fresh deadline for lazy ZIP materialization after the source was idle", () => {
    let now = 0;
    const archive = readArchiveBytes({
      displayName: "idle.zip",
      bytes: createZip({ "data.txt": "still fast" }),
      limits: { workDeadlineMs: 10 },
      now: () => now
    });

    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    now = 100;
    expect(archive.value.readEntry("data.txt")).toEqual({
      ok: true,
      value: Buffer.from("still fast")
    });
  });

  test("enforces the fresh deadline during lazy ZIP CRC work", () => {
    let now = 0;
    let advancePerCall = 0;
    const archive = readArchiveBytes({
      displayName: "slow-crc.zip",
      bytes: createZip({ "data.txt": "slow" }),
      limits: { workDeadlineMs: 10 },
      now: () => {
        const observed = now;
        now += advancePerCall;
        return observed;
      }
    });

    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    advancePerCall = 6;
    const result = archive.value.readEntry("data.txt");
    expect(errorCode(result)).toBe("ARCHIVE_LIMIT_EXCEEDED");
    if (!result.ok) {
      expect(result.error.details?.limit).toBe("workDeadlineMs");
      expect(result.error.details?.observed).toBe(12);
    }
  });

  test("rejects malformed, encrypted, and unsupported-compression ZIPs", () => {
    expect(errorCode(readArchiveBytes({
      displayName: "truncated.zip",
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    }))).toBe("ARCHIVE_MALFORMED");

    expect(errorCode(readArchiveBytes({
      displayName: "encrypted.zip",
      bytes: createZipEntries([{ path: "secret.txt", data: "x", encrypted: true }])
    }))).toBe("ARCHIVE_ENCRYPTED");

    expect(errorCode(readArchiveBytes({
      displayName: "method.zip",
      bytes: createZipEntries([{ path: "file.txt", data: "x", method: 12 }])
    }))).toBe("ARCHIVE_COMPRESSION_UNSUPPORTED");

    const descriptor = createZip({ "descriptor.txt": "x" });
    descriptor.writeUInt16LE(descriptor.readUInt16LE(6) | 0x0008, 6);
    const centralOffset = 30 + Buffer.byteLength("descriptor.txt") + 1;
    descriptor.writeUInt16LE(descriptor.readUInt16LE(centralOffset + 8) | 0x0008, centralOffset + 8);
    expect(errorCode(readArchiveBytes({
      displayName: "descriptor.zip",
      bytes: descriptor
    }))).toBe("ARCHIVE_FORMAT_UNSUPPORTED");
  });

  test("rejects TAR checksum damage and incomplete end markers", () => {
    const checksumDamage = createTar({ "file.txt": "hello" });
    checksumDamage[0] = (checksumDamage[0] ?? 0) ^ 1;
    expect(errorCode(readArchiveBytes({
      displayName: "checksum.tar",
      bytes: checksumDamage
    }))).toBe("ARCHIVE_INTEGRITY_FAILED");

    const missingEnd = createTar({ "file.txt": "hello" }).subarray(0, 1024);
    expect(errorCode(readArchiveBytes({
      displayName: "missing-end.tar",
      bytes: missingEnd,
      formatHint: "tar"
    }))).toBe("ARCHIVE_MALFORMED");
  });

  test("enforces input, entry, caller text, and cumulative materialization limits", () => {
    const bytes = createZip({ "large.txt": "123456" });
    expect(errorCode(readArchiveBytes({
      displayName: "input.zip",
      bytes,
      limits: { inputBytes: bytes.length - 1 }
    }))).toBe("ARCHIVE_LIMIT_EXCEEDED");
    expect(errorCode(readArchiveBytes({
      displayName: "entry.zip",
      bytes,
      limits: { entryBytes: 5 }
    }))).toBe("ARCHIVE_LIMIT_EXCEEDED");
    const tarGz = gzipSync(createTar({ "file.txt": "hello" }));
    const compressedTarLimit = readArchiveBytes({
      displayName: "bounded.tar.gz",
      bytes: tarGz,
      limits: { materializedBytes: 1024 }
    });
    expect(errorCode(compressedTarLimit)).toBe("ARCHIVE_LIMIT_EXCEEDED");
    if (!compressedTarLimit.ok) {
      expect(compressedTarLimit.error.details?.limit).toBe("materializedBytes");
      expect(compressedTarLimit.error.details?.max).toBe(1024);
      expect(compressedTarLimit.error.details?.observed).toBe(1025);
    }

    const retainedTar = createTar({ "file.txt": "hello" });
    const retainedTarArchive = readArchiveBytes({
      displayName: "retained.tar.gz",
      bytes: gzipSync(retainedTar),
      limits: { materializedBytes: retainedTar.length + 5 }
    });
    expect(retainedTarArchive.ok).toBe(true);
    if (retainedTarArchive.ok) {
      expect(retainedTarArchive.value.readEntry("file.txt").ok).toBe(true);
      expect(errorCode(retainedTarArchive.value.readEntry("file.txt"))).toBe(
        "ARCHIVE_LIMIT_EXCEEDED"
      );
    }

    const archive = readArchiveBytes({
      displayName: "materialized.zip",
      bytes,
      limits: { materializedBytes: 6 }
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    expect(errorCode(archive.value.readText("large.txt", 5))).toBe("ARCHIVE_LIMIT_EXCEEDED");
    expect(archive.value.readEntry("large.txt").ok).toBe(true);
    expect(errorCode(archive.value.readEntry("large.txt"))).toBe("ARCHIVE_LIMIT_EXCEEDED");
  });

  test("converts hostile inputs and invalid lazy reads into Result errors", () => {
    const hostileInputs = [
      Buffer.alloc(0),
      Buffer.from("not an archive"),
      Buffer.alloc(513, 0xff),
      createZip({ "ok.txt": "ok" }).subarray(0, 40)
    ];
    for (const bytes of hostileInputs) {
      expect(() => readArchiveBytes({ displayName: "hostile.bin", bytes })).not.toThrow();
      expect(readArchiveBytes({ displayName: "hostile.bin", bytes }).ok).toBe(false);
    }

    const archive = readArchiveBytes({
      displayName: "valid.zip",
      bytes: createZip({ "ok.txt": "ok" })
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) return;
    expect(() => archive.value.readEntry("../escape")).not.toThrow();
    expect(errorCode(archive.value.readEntry("../escape"))).toBe("ARCHIVE_ENTRY_PATH_INVALID");
    expect(() => archive.value.readText("missing.txt")).not.toThrow();
    expect(errorCode(archive.value.readText("missing.txt"))).toBe("ARCHIVE_READ_FAILED");
  });
});

function errorCode<T>(result: Result<T, OhriskError>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const observed = Buffer.byteLength(record);
    if (observed === length) return record;
    length = observed;
  }
}
