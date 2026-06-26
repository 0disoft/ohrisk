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

  test("reads module replacement evidence from the replacement module cache entry", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-replace-evidence-"));
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "acme",
      "risk-fork@v1.0.1"
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
        resolved: "go-module:github.com/acme/risk-fork@v1.0.1",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.packageId).toBe("github.com/acme/risk@v1.0.0");
      expect(evidence.value.source).toBe("local");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
      expect(evidence.value.warnings).toContain(
        "Go replacement evidence was read from github.com/acme/risk-fork@v1.0.1."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reads local replacement evidence only from paths inside the project root", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-local-replace-evidence-"));
    const replacementDir = path.join(projectRoot, "forks", "risk");

    try {
      mkdirSync(replacementDir, { recursive: true });
      writeFileSync(path.join(replacementDir, "go.mod"), "module github.com/acme/risk\n", "utf8");
      writeFileSync(path.join(replacementDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = collectGoModuleEvidence({
        packageId: "github.com/acme/risk@v1.0.0",
        modulePath: "github.com/acme/risk",
        version: "v1.0.0",
        resolved: "./forks/risk",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
      expect(evidence.value.warnings).toContain("Go module uses local replacement path: ./forks/risk.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not read local replacement evidence outside the project root", () => {
    const parentDir = mkdtempSync(path.join(tmpdir(), "ohrisk-go-outside-replace-parent-"));
    const projectRoot = path.join(parentDir, "project");
    const outsideDir = path.join(parentDir, "outside-risk");

    try {
      mkdirSync(projectRoot, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(path.join(outsideDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = collectGoModuleEvidence({
        packageId: "github.com/acme/risk@v1.0.0",
        modulePath: "github.com/acme/risk",
        version: "v1.0.0",
        resolved: "../outside-risk",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "github.com/acme/risk@v1.0.0",
        files: [],
        source: "unavailable"
      });
      expect(evidence.value.warnings).toContain(
        "Go local replacement source was not found or was outside the project root."
      );
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  test("stops collecting Go module evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-evidence-limit-"));
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
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(moduleDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

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

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Go module source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
