import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectLuarocksPackageEvidence } from "../src/evidence/luarocks-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectLuarocksPackageEvidence", () => {
  test("reads license metadata from a local LuaRocks rockspec", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-luarocks-evidence-"));
    tempRoots.push(projectRoot);

    const rockspecDir = path.join(
      projectRoot,
      "lua_modules",
      "lib",
      "luarocks",
      "rocks-5.4",
      "risk-rock",
      "1.0.0-1"
    );
    mkdirSync(rockspecDir, { recursive: true });
    writeFileSync(
      path.join(rockspecDir, "risk-rock-1.0.0-1.rockspec"),
      [
        'package = "risk-rock"',
        'version = "1.0.0-1"',
        "description = {",
        '  license = "MIT"',
        "}"
      ].join("\n"),
      "utf8"
    );

    const evidence = collectLuarocksPackageEvidence({
      packageId: "risk-rock@1.0.0-1",
      packageName: "risk-rock",
      version: "1.0.0-1",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk-rock@1.0.0-1",
      metadataLicense: "MIT",
      metadataSource: "rockspec",
      source: "local"
    });

    const normalized = normalizeLicenseEvidence(evidence.value);
    expect(normalized).toMatchObject({
      expression: "MIT",
      choices: ["MIT"],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain("rockspec license: MIT");
  });

  test("reads literal license tables from a local LuaRocks rockspec", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-luarocks-evidence-"));
    tempRoots.push(projectRoot);

    writeFileSync(
      path.join(projectRoot, "risk-rock-1.0.0-1.rockspec"),
      [
        'package = "risk-rock"',
        'version = "1.0.0-1"',
        "description = {",
        '  license = { "MIT", "BSD-2-Clause" }',
        "}"
      ].join("\n"),
      "utf8"
    );

    const evidence = collectLuarocksPackageEvidence({
      packageId: "risk-rock@1.0.0-1",
      packageName: "risk-rock",
      version: "1.0.0-1",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk-rock@1.0.0-1",
      metadataLicenses: ["MIT", "BSD-2-Clause"],
      metadataSource: "rockspec",
      source: "local"
    });

    const normalized = normalizeLicenseEvidence(evidence.value);
    expect(normalized).toMatchObject({
      expression: "MIT OR BSD-2-Clause",
      choices: ["MIT", "BSD-2-Clause"],
      confidence: "high"
    });
    expect(normalized.evidenceSources).toContain("rockspec licenses field");
  });

  test("returns unavailable evidence when no local rockspec is present", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-luarocks-evidence-"));
    tempRoots.push(projectRoot);

    const evidence = collectLuarocksPackageEvidence({
      packageId: "risk-rock@1.0.0-1",
      packageName: "risk-rock",
      version: "1.0.0-1",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk-rock@1.0.0-1",
      source: "unavailable",
      files: []
    });
    expect(evidence.value.warnings).toContain(
      "LuaRocks package rockspec was not found in the project root or local rocks tree."
    );
  });
});
