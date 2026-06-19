import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_WAIVER_FILE_NAME, readRiskWaivers } from "../src/policy/waivers";

describe("readRiskWaivers", () => {
  test("rejects oversized waiver files before parsing JSON", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-waiver-size-"));
    const waiverPath = path.join(projectRoot, DEFAULT_WAIVER_FILE_NAME);

    try {
      writeFileSync(waiverPath, Buffer.alloc(9));

      const result = readRiskWaivers(projectRoot, {
        waiverFileMaxBytes: 8
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized waiver file to fail.");
      }

      expect(result.error.code).toBe("WAIVER_FILE_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe("Ohrisk waiver file exceeded the maximum supported size.");
      expect(result.error.details).toMatchObject({
        path: waiverPath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
