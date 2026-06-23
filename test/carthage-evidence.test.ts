import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectCarthagePackageEvidence } from "../src/evidence/carthage-package";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectCarthagePackageEvidence", () => {
  test("reads license evidence from a local Carthage checkout", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-carthage-evidence-"));
    tempRoots.push(projectRoot);

    const checkoutDir = path.join(projectRoot, "Carthage", "Checkouts", "RiskKit");
    mkdirSync(checkoutDir, { recursive: true });
    writeFileSync(path.join(checkoutDir, "LICENSE"), "GNU AFFERO GENERAL PUBLIC LICENSE Version 3", "utf8");

    const evidence = collectCarthagePackageEvidence({
      packageId: "Acme/RiskKit@1.2.3",
      packageName: "Acme/RiskKit",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "Acme/RiskKit@1.2.3",
      source: "local",
      files: [
        {
          path: "LICENSE",
          kind: "license"
        }
      ]
    });
  });
});
