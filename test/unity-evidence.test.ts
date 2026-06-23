import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { collectUnityPackageEvidence } from "../src/evidence/unity-package";

describe("collectUnityPackageEvidence", () => {
  test("reads license evidence from Unity PackageCache", () => {
    const projectRoot = path.join(tmpdir(), `ohrisk-unity-evidence-${process.pid}-${Date.now()}`);
    const packageDir = path.join(projectRoot, "Library", "PackageCache", "com.acme.risk@1.2.3");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "com.acme.risk",
          version: "1.2.3",
          license: "AGPL-3.0-only"
        })
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU AFFERO GENERAL PUBLIC LICENSE");

      const result = collectUnityPackageEvidence({
        packageId: "com.acme.risk@1.2.3",
        packageName: "com.acme.risk",
        version: "1.2.3",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.source).toBe("local");
      expect(result.value.packageJsonLicense).toBe("AGPL-3.0-only");
      expect(result.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
