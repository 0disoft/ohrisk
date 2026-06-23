import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectJuliaPackageEvidence } from "../src/evidence/julia-package";

describe("collectJuliaPackageEvidence", () => {
  test("reads license evidence from a local Julia depot package source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-julia-evidence-"));
    const packageDir = path.join(projectRoot, ".julia", "packages", "RiskJulia", "abc123");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "Project.toml"),
        [
          "name = \"RiskJulia\"",
          "uuid = \"11111111-1111-1111-1111-111111111111\"",
          "version = \"1.2.3\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const result = collectJuliaPackageEvidence({
        packageId: "RiskJulia@1.2.3",
        packageName: "RiskJulia",
        version: "1.2.3",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "RiskJulia@1.2.3",
        source: "local",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "Project.toml"
      });
      expect(result.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
