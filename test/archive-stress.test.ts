import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ARCHIVE_LIMITS,
  readArchiveBytes
} from "../src/archive/archive-reader";
import type { OhriskError } from "../src/shared/errors";
import type { Result } from "../src/shared/result";
import { createZipEntries } from "./helpers/zip";

describe("archive resource ceilings", () => {
  test("accepts exactly 50,000 entries and rejects the next declared entry", () => {
    const bytes = createZipEntries(
      Array.from({ length: DEFAULT_ARCHIVE_LIMITS.entries }, (_, index) => ({
        path: `entries/${index.toString().padStart(5, "0")}.txt`,
        data: ""
      }))
    );

    const accepted = readArchiveBytes({ displayName: "entry-limit.zip", bytes });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.error.message);
    expect(accepted.value.listPaths()).toHaveLength(DEFAULT_ARCHIVE_LIMITS.entries);

    const overLimit = Buffer.from(bytes);
    const eocdOffset = overLimit.byteLength - 22;
    overLimit.writeUInt16LE(DEFAULT_ARCHIVE_LIMITS.entries + 1, eocdOffset + 8);
    overLimit.writeUInt16LE(DEFAULT_ARCHIVE_LIMITS.entries + 1, eocdOffset + 10);

    const rejected = readArchiveBytes({ displayName: "entry-limit-plus-one.zip", bytes: overLimit });
    expect(errorCode(rejected)).toBe("ARCHIVE_LIMIT_EXCEEDED");
    if (!rejected.ok) {
      expect(rejected.error.details).toMatchObject({
        limit: "entries",
        max: DEFAULT_ARCHIVE_LIMITS.entries,
        observed: DEFAULT_ARCHIVE_LIMITS.entries + 1
      });
    }
  });

  test("accepts 64 path segments and rejects 65", () => {
    const maximumDepthPath = Array.from(
      { length: DEFAULT_ARCHIVE_LIMITS.pathSegments },
      (_, index) => `s${index}`
    ).join("/");
    const accepted = readArchiveBytes({
      displayName: "maximum-depth.zip",
      bytes: createZipEntries([{ path: maximumDepthPath, data: "ok" }])
    });
    expect(accepted.ok).toBe(true);

    const overDepthPath = `${maximumDepthPath}/overflow`;
    const rejected = readArchiveBytes({
      displayName: "over-depth.zip",
      bytes: createZipEntries([{ path: overDepthPath, data: "no" }])
    });
    expect(errorCode(rejected)).toBe("ARCHIVE_LIMIT_EXCEEDED");
    if (!rejected.ok) {
      expect(rejected.error.details).toMatchObject({
        limit: "pathSegments",
        max: DEFAULT_ARCHIVE_LIMITS.pathSegments,
        observed: DEFAULT_ARCHIVE_LIMITS.pathSegments + 1
      });
    }
  });

  test("rejects a highly compressible entry before materialization", () => {
    const expanded = Buffer.alloc(DEFAULT_ARCHIVE_LIMITS.compressionRatioMinBytes, 0);
    const rejected = readArchiveBytes({
      displayName: "compression-bomb.zip",
      bytes: createZipEntries([{ path: "zeros.bin", data: expanded }], { deflate: true })
    });

    expect(errorCode(rejected)).toBe("ARCHIVE_LIMIT_EXCEEDED");
    if (!rejected.ok) {
      expect(rejected.error.details?.limit).toBe("compressionRatio");
      expect(rejected.error.details?.max).toBe(DEFAULT_ARCHIVE_LIMITS.compressionRatio);
      expect(rejected.error.details?.observed).toBeGreaterThan(
        DEFAULT_ARCHIVE_LIMITS.compressionRatio
      );
    }
  });
});

function errorCode<T>(result: Result<T, OhriskError>): string | undefined {
  return result.ok ? undefined : result.error.code;
}
