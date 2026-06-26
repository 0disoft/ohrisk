import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectNixPackageEvidence } from "../src/evidence/nix-package";

describe("collectNixPackageEvidence", () => {
  test("reads license files from local path inputs", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nix-evidence-"));
    const inputRoot = path.join(projectRoot, "vendor", "local-flake");

    try {
      mkdirSync(inputRoot, { recursive: true });
      writeFileSync(path.join(inputRoot, "LICENSE"), "MIT License", "utf8");

      const result = collectNixPackageEvidence({
        packageId: "path:./vendor/local-flake@sha256-local",
        resolved: "./vendor/local-flake",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.files).toEqual([
        {
          path: "LICENSE",
          kind: "license",
          text: "MIT License"
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Nix flake input evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nix-evidence-limit-"));
    const inputRoot = path.join(projectRoot, "vendor", "local-flake");

    try {
      mkdirSync(inputRoot, { recursive: true });
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(
          path.join(inputRoot, `LICENSE-${suffix}.txt`),
          `license ${suffix}`,
          "utf8"
        );
      }

      const result = collectNixPackageEvidence({
        packageId: "path:./vendor/local-flake@sha256-local",
        resolved: "./vendor/local-flake",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.files).toHaveLength(50);
      expect(result.value.warnings).toContain(
        "Nix flake input evidence file limit reached at 50 files."
      );
      expect(result.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in local Nix flake input source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
