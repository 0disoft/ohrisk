import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectRPackageEvidence } from "../src/evidence/r-package";

describe("collectRPackageEvidence", () => {
  test("reads license evidence from a local renv package library", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-r-evidence-"));
    const packageDir = path.join(projectRoot, "renv", "library", "R-4.4", "x86_64", "RiskR");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "DESCRIPTION"),
        [
          "Package: RiskR",
          "Version: 1.2.3",
          "License: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const result = collectRPackageEvidence({
        packageId: "RiskR@1.2.3",
        packageName: "RiskR",
        version: "1.2.3",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "RiskR@1.2.3",
        source: "local",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "DESCRIPTION"
      });
      expect(result.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
