import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectConanPackageEvidence } from "../src/evidence/conan-package";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectConanPackageEvidence", () => {
  test("reads license evidence from a local Conan cache package source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-conan-evidence-"));
    tempRoots.push(projectRoot);

    const exportDir = path.join(
      projectRoot,
      ".conan",
      "data",
      "risklib",
      "1.0.0",
      "_",
      "_",
      "export"
    );
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(
      path.join(exportDir, "conanfile.py"),
      [
        "from conan import ConanFile",
        "",
        "class RiskLibConan(ConanFile):",
        "    name = \"risklib\"",
        "    version = \"1.0.0\"",
        "    license = \"AGPL-3.0-only\""
      ].join("\n"),
      "utf8"
    );
    writeFileSync(path.join(exportDir, "LICENSE"), "GNU AFFERO GENERAL PUBLIC LICENSE Version 3", "utf8");

    const evidence = collectConanPackageEvidence({
      packageId: "risklib@1.0.0",
      packageName: "risklib",
      version: "1.0.0",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risklib@1.0.0",
      source: "local",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "conanfile.py",
      files: [
        {
          path: "LICENSE",
          kind: "license"
        }
      ]
    });
  });

  test("uses the recipe name segment for namespaced Conan Package URL identities", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-conan-evidence-"));
    tempRoots.push(projectRoot);

    const exportDir = path.join(
      projectRoot,
      ".conan",
      "data",
      "risklib",
      "1.0.0",
      "_",
      "_",
      "export"
    );
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(
      path.join(exportDir, "conanfile.py"),
      [
        "from conan import ConanFile",
        "",
        "class RiskLibConan(ConanFile):",
        "    name = \"risklib\"",
        "    version = \"1.0.0\"",
        "    license = \"MIT\""
      ].join("\n"),
      "utf8"
    );

    const evidence = collectConanPackageEvidence({
      packageId: "example.com/risklib@1.0.0",
      packageName: "example.com/risklib",
      version: "1.0.0",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "example.com/risklib@1.0.0",
      source: "local",
      metadataLicense: "MIT",
      metadataSource: "conanfile.py"
    });
  });
});
