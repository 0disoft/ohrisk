import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { collectSwiftPackageEvidence } from "../src/evidence/swift-package";

describe("collectSwiftPackageEvidence", () => {
  test("reads license evidence from SwiftPM checkouts", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-swift-evidence-"));
    const packageDir = path.join(projectRoot, ".build", "checkouts", "RiskSwift");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, "LICENSE"), "SPDX-License-Identifier: AGPL-3.0-only\n", "utf8");

      const evidence = collectSwiftPackageEvidence({
        packageId: "riskswift@1.0.0",
        packageName: "riskswift",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
      expect(evidence.value.files[0]?.text).toContain("AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Swift package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-swift-evidence-limit-"));
    const packageDir = path.join(projectRoot, ".build", "checkouts", "RiskSwift");

    try {
      mkdirSync(packageDir, { recursive: true });
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(packageDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectSwiftPackageEvidence({
        packageId: "riskswift@1.0.0",
        packageName: "riskswift",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).toContain(
        "Swift package evidence file limit reached at 50 files."
      );
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Swift package checkout."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
