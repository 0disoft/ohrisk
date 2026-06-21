import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectGoModuleEvidence } from "../src/evidence/go-module";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectGoModuleEvidence", () => {
  test("reads license evidence from local Go module cache", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-evidence-"));
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "acme",
      "risk@v1.0.0"
    );

    try {
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        path.join(moduleDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const evidence = collectGoModuleEvidence({
        packageId: "github.com/acme/risk@v1.0.0",
        modulePath: "github.com/acme/risk",
        version: "v1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "github.com/acme/risk@v1.0.0",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "AGPL-3.0-only",
        choices: ["AGPL-3.0-only"],
        confidence: "medium"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses Go module cache escaping for uppercase path segments", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-uppercase-evidence-"));
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "!azure",
      "risk@v1.0.0"
    );

    try {
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(path.join(moduleDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = collectGoModuleEvidence({
        packageId: "github.com/Azure/risk@v1.0.0",
        modulePath: "github.com/Azure/risk",
        version: "v1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
