import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectHackagePackageEvidence } from "../src/evidence/hackage-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectHackagePackageEvidence", () => {
  test("reads license metadata from a local Stack package database", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-hackage-evidence-"));
    const packageDbDir = path.join(
      projectRoot,
      ".stack-work",
      "install",
      "x86_64-windows",
      "snapshot",
      "9.6.6",
      "pkgdb"
    );

    try {
      mkdirSync(packageDbDir, { recursive: true });
      writeFileSync(
        path.join(packageDbDir, "risk-haskell-1.2.3-abc.conf"),
        [
          "name: risk-haskell",
          "version: 1.2.3",
          "license: MIT"
        ].join("\n"),
        "utf8"
      );

      const result = collectHackagePackageEvidence({
        packageId: "risk-haskell@1.2.3",
        packageName: "risk-haskell",
        version: "1.2.3",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "risk-haskell@1.2.3",
        source: "local",
        metadataLicense: "MIT",
        metadataSource: "ghc-pkg"
      });

      const normalized = normalizeLicenseEvidence(result.value);
      expect(normalized).toMatchObject({
        expression: "MIT",
        choices: ["MIT"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("ghc-pkg license: MIT");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns unavailable evidence when no local Stack package database is present", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-hackage-evidence-"));

    try {
      const result = collectHackagePackageEvidence({
        packageId: "risk-haskell@1.2.3",
        packageName: "risk-haskell",
        version: "1.2.3",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "risk-haskell@1.2.3",
        source: "unavailable",
        files: []
      });
      expect(result.value.warnings).toContain(
        "Hackage package metadata was not found in the local Stack package database."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
