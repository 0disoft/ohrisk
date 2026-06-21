import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectRubyGemEvidence } from "../src/evidence/ruby-gem";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectRubyGemEvidence", () => {
  test("reads license evidence from a local Bundler install path", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gem-evidence-"));
    const bundleRoot = path.join(projectRoot, "vendor", "bundle", "ruby", "3.3.0");
    const packageDir = path.join(bundleRoot, "gems", "risk-gem-1.0.0");

    try {
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(path.join(bundleRoot, "specifications"), { recursive: true });
      writeFileSync(
        path.join(bundleRoot, "specifications", "risk-gem-1.0.0.gemspec"),
        [
          "Gem::Specification.new do |s|",
          "  s.name = \"risk-gem\"",
          "  s.version = \"1.0.0\"",
          "  s.license = \"MIT\"",
          "end"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = collectRubyGemEvidence({
        packageId: "risk-gem@1.0.0",
        gemName: "risk-gem",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "risk-gem@1.0.0",
        metadataLicense: "MIT",
        metadataSource: "gemspec",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "MIT",
        choices: ["MIT"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("gemspec license: MIT");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not follow Ruby gem names outside the gems directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gem-traversal-"));
    const bundleRoot = path.join(projectRoot, "vendor", "bundle", "ruby", "3.3.0");
    const outsideDir = path.join(bundleRoot, "risk-gem-1.0.0");

    try {
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(path.join(outsideDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = collectRubyGemEvidence({
        packageId: "../risk-gem@1.0.0",
        gemName: "../risk-gem",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "../risk-gem@1.0.0",
        files: [],
        source: "unavailable"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
