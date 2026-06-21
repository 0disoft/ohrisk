import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectComposerPackageEvidence } from "../src/evidence/composer-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectComposerPackageEvidence", () => {
  test("reads license evidence from a local Composer vendor directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-composer-evidence-"));
    const packageDir = path.join(projectRoot, "vendor", "acme", "risk");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "composer.json"),
        JSON.stringify({
          name: "acme/risk",
          version: "1.0.0",
          license: "AGPL-3.0-only"
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const evidence = collectComposerPackageEvidence({
        packageId: "acme/risk@1.0.0",
        packageName: "acme/risk",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "acme/risk@1.0.0",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "composer.json",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "AGPL-3.0-only",
        choices: ["AGPL-3.0-only"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("composer.json license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not follow Composer package names outside the vendor directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-composer-traversal-"));
    const outsideDir = path.join(projectRoot, "risk");

    try {
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(
        path.join(outsideDir, "composer.json"),
        JSON.stringify({ license: "AGPL-3.0-only" }),
        "utf8"
      );

      const evidence = collectComposerPackageEvidence({
        packageId: "../risk@1.0.0",
        packageName: "../risk",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "../risk@1.0.0",
        files: [],
        source: "unavailable"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
