import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectPythonPackageEvidence } from "../src/evidence/python-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectPythonPackageEvidence", () => {
  test("reads license evidence from Python dist-info METADATA", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-python-evidence-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "requests-2.32.3.dist-info"
    );

    try {
      mkdirSync(path.join(distInfoDir, "licenses"), { recursive: true });
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: requests",
          "Version: 2.32.3",
          "License-Expression: Apache-2.0",
          ""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "licenses", "LICENSE"),
        "Apache License\nVersion 2.0, January 2004\n",
        "utf8"
      );

      const evidence = collectPythonPackageEvidence({
        packageId: "requests@2.32.3",
        packageName: "requests",
        version: "2.32.3",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "requests@2.32.3",
        metadataLicense: "Apache-2.0",
        metadataSource: "METADATA",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["licenses/LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        original: "Apache-2.0",
        expression: "Apache-2.0",
        choices: ["Apache-2.0"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("METADATA license: Apache-2.0");
      expect(normalized.evidenceSources).toContain("file: licenses/LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses recognized license classifiers when License-Expression is absent", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-python-classifier-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "example_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: example-pkg",
          "Version: 1.0.0",
          "Classifier: License :: OSI Approved :: MIT License",
          ""
        ].join("\n"),
        "utf8"
      );

      const evidence = collectPythonPackageEvidence({
        packageId: "example-pkg@1.0.0",
        packageName: "example-pkg",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.metadataLicense).toBe("MIT");
      expect(normalizeLicenseEvidence(evidence.value)).toMatchObject({
        expression: "MIT",
        confidence: "high"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Python package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-python-evidence-limit-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "requests-2.32.3.dist-info"
    );
    const licensesDir = path.join(distInfoDir, "licenses");

    try {
      mkdirSync(licensesDir, { recursive: true });
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: requests",
          "Version: 2.32.3",
          "License-Expression: Apache-2.0",
          ""
        ].join("\n"),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(licensesDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectPythonPackageEvidence({
        packageId: "requests@2.32.3",
        packageName: "requests",
        version: "2.32.3",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files.length).toBeLessThan(51);
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Python dist-info metadata."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
