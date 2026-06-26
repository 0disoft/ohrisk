import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectCargoPackageEvidence } from "../src/evidence/cargo-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectCargoPackageEvidence", () => {
  test("reads license evidence from local Cargo registry source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license = \"Apache-2.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(crateDir, "LICENSE"),
        "Apache License\nVersion 2.0, January 2004\n",
        "utf8"
      );

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "risk-crate@1.0.0",
        metadataLicense: "Apache-2.0",
        metadataSource: "Cargo.toml",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "Apache-2.0",
        choices: ["Apache-2.0"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("Cargo.toml license: Apache-2.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores Cargo license-file paths outside the package directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-"));
    const registryRoot = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef"
    );
    const crateDir = path.join(registryRoot, "risk-crate-1.0.0");

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license-file = \"../LICENSE\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(registryRoot, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toEqual([]);
      expect(evidence.value.warnings).toContain("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Cargo package source.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Cargo package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-limit-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(crateDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Cargo package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
