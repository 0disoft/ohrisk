import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { collectCocoapodsPackageEvidence } from "../src/evidence/cocoapods-package";

describe("collectCocoapodsPackageEvidence", () => {
  test("reads license evidence from local Pods source and podspec metadata", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cocoapods-evidence-"));
    const packageDir = path.join(projectRoot, "Pods", "RiskPod");
    const podspecDir = path.join(projectRoot, "Pods", "Local Podspecs");

    try {
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(podspecDir, { recursive: true });
      writeFileSync(
        path.join(podspecDir, "RiskPod.podspec.json"),
        JSON.stringify({
          name: "RiskPod",
          version: "1.0.0",
          license: {
            type: "AGPL-3.0-only"
          }
        }),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "SPDX-License-Identifier: AGPL-3.0-only\n", "utf8");

      const evidence = collectCocoapodsPackageEvidence({
        packageId: "RiskPod@1.0.0",
        packageName: "RiskPod",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.metadataLicense).toBe("AGPL-3.0-only");
      expect(evidence.value.metadataSource).toBe("podspec");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting CocoaPods package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cocoapods-evidence-limit-"));
    const packageDir = path.join(projectRoot, "Pods", "RiskPod");
    const podspecDir = path.join(projectRoot, "Pods", "Local Podspecs");

    try {
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(podspecDir, { recursive: true });
      writeFileSync(
        path.join(podspecDir, "RiskPod.podspec.json"),
        JSON.stringify({
          name: "RiskPod",
          version: "1.0.0",
          license: {
            type: "MIT"
          }
        }),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(packageDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectCocoapodsPackageEvidence({
        packageId: "RiskPod@1.0.0",
        packageName: "RiskPod",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).toContain(
        "CocoaPods package evidence file limit reached at 50 files."
      );
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in CocoaPods package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
