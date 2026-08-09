import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyRiskWaivers,
  DEFAULT_WAIVER_FILE_NAME,
  readRiskWaivers,
  type RiskWaiver
} from "../src/policy/waivers";
import {
  buildFindingFingerprint,
  buildFindingId,
  buildLegacyFindingId
} from "../src/policy/finding-id";
import type { RiskFinding } from "../src/policy/types";

function findingWithPaths(paths: string[][]): RiskFinding {
  const id = buildFindingId({
    packageId: "shared@1.0.2",
    dependencyType: "production",
    dependencyScope: "transitive",
    paths
  });
  const fingerprint = buildFindingFingerprint({
    id,
    severity: "high",
    recommendation: "replace",
    reason: "License expression is high risk for saas.",
    evidence: ["source: sbom"]
  });

  return {
    id,
    fingerprint,
    packageId: "shared@1.0.2",
    severity: "high",
    reason: "License expression is high risk for saas.",
    action: "Replace this package or escalate before shipping.",
    dependencyType: "production",
    dependencyScope: "transitive",
    evidence: ["source: sbom"],
    paths,
    recommendation: "replace"
  };
}

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

  test("applies legacy raw-order waiver IDs after canonicalization", () => {
    const paths = [
      ["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"],
      ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"]
    ];
    const finding = findingWithPaths(paths);
    const legacyId = buildLegacyFindingId({
      packageId: finding.packageId,
      dependencyType: finding.dependencyType,
      dependencyScope: finding.dependencyScope,
      paths: finding.paths
    });
    const waiver: RiskWaiver = { id: legacyId, reason: "Reviewed for this release." };

    const result = applyRiskWaivers({
      findings: [finding],
      waivers: [waiver],
      now: new Date("2026-08-09T00:00:00.000Z")
    });

    expect(result.waivedFindings).toHaveLength(1);
    expect(result.waivedFindings[0]?.matchedBy).toBe("id");
    expect(result.unmatchedWaivers).toEqual([]);
    expect(result.activeFindings).toEqual([]);
  });

  test("applies legacy fingerprint waivers after canonicalization", () => {
    const paths = [
      ["fixture-b", "root@1.0.0", "mid-b@1.0.1", "shared@1.0.2"],
      ["fixture-a", "root@1.0.0", "mid-a@1.0.0", "shared@1.0.2"]
    ];
    const finding = findingWithPaths(paths);
    const legacyFingerprint = buildFindingFingerprint({
      id: buildLegacyFindingId({
        packageId: finding.packageId,
        dependencyType: finding.dependencyType,
        dependencyScope: finding.dependencyScope,
        paths: finding.paths
      }),
      severity: finding.severity,
      recommendation: finding.recommendation,
      reason: finding.reason,
      evidence: finding.evidence
    });
    const waiver: RiskWaiver = {
      fingerprint: legacyFingerprint,
      reason: "Reviewed for this release."
    };

    const result = applyRiskWaivers({
      findings: [finding],
      waivers: [waiver],
      now: new Date("2026-08-09T00:00:00.000Z")
    });

    expect(result.waivedFindings).toHaveLength(1);
    expect(result.waivedFindings[0]?.matchedBy).toBe("fingerprint");
    expect(result.unmatchedWaivers).toEqual([]);
  });
});
