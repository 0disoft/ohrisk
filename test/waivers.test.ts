import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_WAIVER_FILE_NAME, readRiskWaivers } from "../src/policy/waivers";

describe("readRiskWaivers", () => {
  test("publishes a closed waiver-file schema for roots and items", () => {
    const schema = JSON.parse(
      readFileSync(path.resolve(import.meta.dir, "../schemas/waiver-file.schema.json"), "utf8")
    ) as {
      additionalProperties: boolean;
      properties: { waivers: { items: { additionalProperties: boolean } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.waivers.items.additionalProperties).toBe(false);
  });

  test("rejects unknown waiver root fields", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-waiver-root-"));
    try {
      writeFileSync(
        path.join(projectRoot, DEFAULT_WAIVER_FILE_NAME),
        JSON.stringify({ waivers: [], metadata: {} })
      );
      const result = readRiskWaivers(projectRoot);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected an unknown root field to fail.");
      expect(result.error.message).toContain("unknown field(s): metadata");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects unknown waiver item fields including misspelled expiry dates", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-waiver-item-"));
    try {
      writeFileSync(
        path.join(projectRoot, DEFAULT_WAIVER_FILE_NAME),
        JSON.stringify({
          waivers: [{ id: "finding", reason: "Reviewed.", expiresOnn: "2026-09-30" }]
        })
      );
      const result = readRiskWaivers(projectRoot);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected a misspelled expiry field to fail.");
      expect(result.error.message).toContain("unknown field(s): expiresOnn");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

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
