import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectCondaPackageEvidence } from "../src/evidence/conda-package";

describe("collectCondaPackageEvidence", () => {
  test("reads license evidence from a local conda package cache", () => {
    const projectRoot = path.join(tmpdir(), `ohrisk-conda-evidence-${process.pid}-${Date.now()}`);
    const packageDir = path.join(projectRoot, ".conda", "pkgs", "risk-conda-1.0.0-py312_0");

    try {
      mkdirSync(path.join(packageDir, "info", "licenses"), { recursive: true });
      writeFileSync(
        path.join(packageDir, "info", "index.json"),
        JSON.stringify({
          name: "risk-conda",
          version: "1.0.0",
          license: "AGPL-3.0-only"
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "info", "licenses", "LICENSE"),
        "GNU Affero General Public License version 3",
        "utf8"
      );

      const evidence = collectCondaPackageEvidence({
        packageId: "conda:risk-conda@1.0.0",
        packageName: "risk-conda",
        version: "1.0.0",
        resolved: "https://conda.anaconda.org/conda-forge/linux-64/risk-conda-1.0.0-py312_0.tar.bz2",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error("Expected Conda package evidence collection to succeed.");
      }

      expect(evidence.value).toMatchObject({
        packageId: "conda:risk-conda@1.0.0",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "info/index.json",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["info/licenses/LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Conda package evidence files at the configured limit", () => {
    const projectRoot = path.join(tmpdir(), `ohrisk-conda-evidence-limit-${process.pid}-${Date.now()}`);
    const packageDir = path.join(projectRoot, ".conda", "pkgs", "risk-conda-1.0.0-py312_0");
    const licensesDir = path.join(packageDir, "info", "licenses");

    try {
      mkdirSync(licensesDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "info", "index.json"),
        JSON.stringify({
          name: "risk-conda",
          version: "1.0.0",
          license: "MIT"
        }),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(licensesDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectCondaPackageEvidence({
        packageId: "conda:risk-conda@1.0.0",
        packageName: "risk-conda",
        version: "1.0.0",
        resolved: "https://conda.anaconda.org/conda-forge/linux-64/risk-conda-1.0.0-py312_0.tar.bz2",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).toContain(
        "Conda package evidence file limit reached at 50 files."
      );
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Conda package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
