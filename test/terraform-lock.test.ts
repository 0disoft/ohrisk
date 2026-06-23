import { describe, expect, test } from "bun:test";

import { parseTerraformLockText } from "../src/graph/terraform-lock";

describe("parseTerraformLockText", () => {
  test("parses provider blocks from .terraform.lock.hcl", () => {
    const result = parseTerraformLockText([
      'provider "registry.terraform.io/hashicorp/aws" {',
      '  version     = "5.31.0"',
      '  constraints = "~> 5.0"',
      "  hashes = [",
      '    "h1:abc"',
      "  ]",
      "}",
      "",
      'provider "registry.terraform.io/cloudflare/cloudflare" {',
      '  version = "4.25.0"',
      "}"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "registry.terraform.io/cloudflare/cloudflare@4.25.0",
        name: "registry.terraform.io/cloudflare/cloudflare",
        version: "4.25.0",
        ecosystem: "terraform",
        resolved: "registry.terraform.io/cloudflare/cloudflare",
        dependencyType: "production",
        direct: true,
        paths: [[".", "registry.terraform.io/cloudflare/cloudflare@4.25.0"]]
      },
      {
        id: "registry.terraform.io/hashicorp/aws@5.31.0",
        name: "registry.terraform.io/hashicorp/aws",
        version: "5.31.0",
        ecosystem: "terraform",
        resolved: "registry.terraform.io/hashicorp/aws",
        dependencyType: "production",
        direct: true,
        paths: [[".", "registry.terraform.io/hashicorp/aws@5.31.0"]]
      }
    ]);
  });

  test("reports provider blocks without versions as typed errors", () => {
    const result = parseTerraformLockText([
      'provider "registry.terraform.io/hashicorp/aws" {',
      "  hashes = []",
      "}"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("TERRAFORM_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: ".terraform.lock.hcl",
      provider: "registry.terraform.io/hashicorp/aws",
      reason: "missing_version"
    });
  });
});
