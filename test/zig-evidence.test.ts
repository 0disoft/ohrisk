import { test } from "bun:test";
import { equal } from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectZigPackageEvidence } from "../src/evidence/zig-package";

test("collectZigPackageEvidence > reads license evidence from a local Zig path dependency", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "ohrisk-zig-"));
  const packageDir = path.join(tempDir, "libs", "mydep");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "LICENSE"), "MIT License\n\nCopyright (c) 2024 Test");

  const result = collectZigPackageEvidence({
    packageId: "mydep@unknown",
    packageName: "mydep",
    projectRoot: tempDir,
    resolved: "libs/mydep"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "local");
  equal(result.value.files.length, 1);
  equal(result.value.files[0]!.path, "LICENSE");
  equal(result.value.files[0]!.kind, "license");
});

test("collectZigPackageEvidence > returns unavailable for remote URL packages", () => {
  const result = collectZigPackageEvidence({
    packageId: "dep@0.0.0",
    packageName: "dep",
    projectRoot: "/tmp",
    resolved: "https://github.com/example/dep/archive/abc123.tar.gz"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "unavailable");
  equal(result.value.files.length, 0);
});

test("collectZigPackageEvidence > returns unavailable when no resolved path", () => {
  const result = collectZigPackageEvidence({
    packageId: "dep@unknown",
    packageName: "dep",
    projectRoot: "/tmp"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "unavailable");
});

test("collectZigPackageEvidence > rejects paths outside the project root", () => {
  const result = collectZigPackageEvidence({
    packageId: "dep@unknown",
    packageName: "dep",
    projectRoot: "/tmp",
    resolved: "../../../etc"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "unavailable");
});

test("collectZigPackageEvidence > warns when no license file is found", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "ohrisk-zig-"));
  const packageDir = path.join(tempDir, "libs", "nolicense");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "README.md"), "no license here");

  const result = collectZigPackageEvidence({
    packageId: "nolicense@unknown",
    packageName: "nolicense",
    projectRoot: tempDir,
    resolved: "libs/nolicense"
  });

  equal(result.ok, true);
  if (!result.ok) return;

  equal(result.value.source, "local");
  equal(result.value.files.length, 0);
  equal(result.value.warnings.length > 0, true);
});
