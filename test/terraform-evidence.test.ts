import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectTerraformProviderEvidence } from "../src/evidence/terraform-provider";

describe("collectTerraformProviderEvidence", () => {
  test("reads license files from local Terraform provider cache", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-terraform-evidence-"));
    const providerRoot = path.join(
      projectRoot,
      ".terraform",
      "providers",
      "registry.terraform.io",
      "hashicorp",
      "aws",
      "5.31.0",
      "windows_amd64"
    );

    try {
      mkdirSync(providerRoot, { recursive: true });
      writeFileSync(path.join(providerRoot, "LICENSE.txt"), "Mozilla Public License 2.0", "utf8");

      const result = collectTerraformProviderEvidence({
        packageId: "registry.terraform.io/hashicorp/aws@5.31.0",
        sourceAddress: "registry.terraform.io/hashicorp/aws",
        version: "5.31.0",
        projectRoot
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.source).toBe("local");
      expect(result.value.files).toEqual([
        {
          path: "windows_amd64/LICENSE.txt",
          kind: "license",
          text: "Mozilla Public License 2.0"
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
