import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectCpanPackageEvidence } from "../src/evidence/cpan-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import { createTarGz } from "./helpers/tar";

describe("collectCpanPackageEvidence", () => {
  test("reads license metadata from a local Carton cache archive", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cpan-evidence-"));
    const archivePath = path.join(
      projectRoot,
      "local",
      "cache",
      "authors",
      "id",
      "A",
      "AC",
      "ACME",
      "App-Risk-1.0.tar.gz"
    );

    try {
      mkdirSync(path.dirname(archivePath), { recursive: true });
      writeFileSync(
        archivePath,
        createTarGz({
          "App-Risk-1.0/META.json": JSON.stringify({
            name: "App-Risk",
            version: "1.0",
            license: ["mit"]
          })
        })
      );

      const result = collectCpanPackageEvidence({
        packageId: "App-Risk@1.0",
        packageName: "App-Risk",
        version: "1.0",
        resolved: "A/AC/ACME/App-Risk-1.0.tar.gz",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "App-Risk@1.0",
        source: "local",
        metadataLicense: "MIT",
        metadataSource: "CPAN META"
      });

      const normalized = normalizeLicenseEvidence(result.value);
      expect(normalized).toMatchObject({
        expression: "MIT",
        choices: ["MIT"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("CPAN META license: MIT");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns unavailable evidence when no local Carton cache archive is present", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cpan-evidence-"));

    try {
      const result = collectCpanPackageEvidence({
        packageId: "App-Risk@1.0",
        packageName: "App-Risk",
        version: "1.0",
        resolved: "A/AC/ACME/App-Risk-1.0.tar.gz",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value).toMatchObject({
        packageId: "App-Risk@1.0",
        source: "unavailable",
        files: []
      });
      expect(result.value.warnings).toContain(
        "CPAN distribution archive was not found in the local Carton cache."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
