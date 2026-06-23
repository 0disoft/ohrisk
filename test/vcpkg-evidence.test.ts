import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectVcpkgPackageEvidence } from "../src/evidence/vcpkg-package";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectVcpkgPackageEvidence", () => {
  test("reads copyright evidence from a local vcpkg install tree", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-vcpkg-evidence-"));
    tempRoots.push(projectRoot);

    const shareDir = path.join(
      projectRoot,
      "vcpkg_installed",
      "x64-windows",
      "share",
      "risklib"
    );
    mkdirSync(shareDir, { recursive: true });
    writeFileSync(
      path.join(shareDir, "copyright"),
      "SPDX-License-Identifier: AGPL-3.0-only",
      "utf8"
    );

    const evidence = collectVcpkgPackageEvidence({
      packageId: "risklib@1.0.0",
      packageName: "risklib",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risklib@1.0.0",
      source: "local",
      files: [
        {
          path: "x64-windows/share/risklib/copyright",
          kind: "license",
          text: "SPDX-License-Identifier: AGPL-3.0-only"
        }
      ]
    });
  });

  test("returns unavailable evidence when the install tree is absent", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-vcpkg-evidence-"));
    tempRoots.push(projectRoot);

    const evidence = collectVcpkgPackageEvidence({
      packageId: "risklib@1.0.0",
      packageName: "risklib",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risklib@1.0.0",
      source: "unavailable",
      files: []
    });
    expect(evidence.value.warnings).toContain(
      "vcpkg package copyright file was not found in local vcpkg_installed directories."
    );
  });
});
