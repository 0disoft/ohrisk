import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectNugetPackageEvidence } from "../src/evidence/nuget-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectNugetPackageEvidence", () => {
  test("reads license evidence from a local NuGet package cache", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-evidence-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <id>Risk.Package</id>",
          "    <version>1.0.0</version>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const evidence = collectNugetPackageEvidence({
        packageId: "Risk.Package@1.0.0",
        packageName: "Risk.Package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "Risk.Package@1.0.0",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "nuspec",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "AGPL-3.0-only",
        choices: ["AGPL-3.0-only"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores NuGet license file paths outside the package directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-evidence-"));
    const packageRoot = path.join(projectRoot, ".nuget", "packages", "risk.package");
    const packageDir = path.join(packageRoot, "1.0.0");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"file\">../LICENSE</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageRoot, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const evidence = collectNugetPackageEvidence({
        packageId: "Risk.Package@1.0.0",
        packageName: "Risk.Package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toEqual([]);
      expect(evidence.value.metadataLicense).toBeUndefined();
      expect(evidence.value.warnings).toContain("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in NuGet package source.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting NuGet package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-evidence-limit-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(packageDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectNugetPackageEvidence({
        packageId: "Risk.Package@1.0.0",
        packageName: "Risk.Package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in NuGet package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
