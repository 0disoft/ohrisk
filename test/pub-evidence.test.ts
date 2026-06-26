import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { collectPubPackageEvidence } from "../src/evidence/pub-package";

describe("collectPubPackageEvidence", () => {
  test("reads license evidence from Dart package_config root URIs", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pub-evidence-"));
    const packageDir = path.join(projectRoot, ".pub-cache", "hosted", "pub.dev", "risk_package-1.0.0");

    try {
      mkdirSync(path.join(projectRoot, ".dart_tool"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".dart_tool", "package_config.json"),
        JSON.stringify({
          configVersion: 2,
          packages: [
            {
              name: "risk_package",
              rootUri: "../.pub-cache/hosted/pub.dev/risk_package-1.0.0",
              packageUri: "lib/"
            }
          ]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        [
          "name: risk_package",
          "version: 1.0.0",
          "license: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "SPDX-License-Identifier: AGPL-3.0-only\n", "utf8");

      const evidence = collectPubPackageEvidence({
        packageId: "risk_package@1.0.0",
        packageName: "risk_package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.source).toBe("local");
      expect(evidence.value.metadataLicense).toBe("AGPL-3.0-only");
      expect(evidence.value.metadataSource).toBe("pubspec.yaml");
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Dart pub evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pub-evidence-limit-"));
    const packageDir = path.join(projectRoot, ".pub-cache", "hosted", "pub.dev", "risk_package-1.0.0");

    try {
      mkdirSync(path.join(projectRoot, ".dart_tool"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".dart_tool", "package_config.json"),
        JSON.stringify({
          configVersion: 2,
          packages: [
            {
              name: "risk_package",
              rootUri: "../.pub-cache/hosted/pub.dev/risk_package-1.0.0",
              packageUri: "lib/"
            }
          ]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        [
          "name: risk_package",
          "version: 1.0.0",
          "license: MIT"
        ].join("\n"),
        "utf8"
      );
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(packageDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }

      const evidence = collectPubPackageEvidence({
        packageId: "risk_package@1.0.0",
        packageName: "risk_package",
        version: "1.0.0",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).toContain(
        "Dart pub package evidence file limit reached at 50 files."
      );
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Dart pub package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
