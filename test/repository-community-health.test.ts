import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("repository community health", () => {
  test("publishes a private security reporting and response contract", () => {
    const security = read("SECURITY.md");

    expect(security).toContain("https://github.com/0disoft/ohrisk/security/advisories/new");
    expect(security).toContain("latest published version");
    expect(security).toContain("within 7 calendar days");
    expect(security).toContain("Do not open a public issue");
  });

  test("documents a bounded contribution workflow", () => {
    const contributing = read("CONTRIBUTING.md");

    expect(contributing).toContain("Node.js 24");
    expect(contributing).toContain("Bun 1.3.14");
    expect(contributing).toContain("bun run verify:release");
    expect(contributing).toContain("Adding an ecosystem");
    expect(contributing).toContain("Do not include credentials");
  });

  test("provides focused issue forms and a private security route", () => {
    const config = parseYaml(read(".github/ISSUE_TEMPLATE/config.yml")) as {
      blank_issues_enabled?: boolean;
      contact_links?: Array<{ url?: string }>;
    };

    expect(config.blank_issues_enabled).toBe(false);
    expect(config.contact_links?.map((link) => link.url)).toContain(
      "https://github.com/0disoft/ohrisk/security/advisories/new"
    );
    expect(read(".github/ISSUE_TEMPLATE/bug.yml")).toContain("Ohrisk version");
    expect(read(".github/ISSUE_TEMPLATE/license-result.yml")).toContain("False positive");
    expect(read(".github/ISSUE_TEMPLATE/license-result.yml")).toContain("False negative");
    expect(read(".github/ISSUE_TEMPLATE/feature.yml")).toContain("Problem to solve");
  });

  test("keeps the pull request template specific to this CLI", () => {
    const template = read(".github/PULL_REQUEST_TEMPLATE.md");

    expect(template).toContain("User-visible impact");
    expect(template).toContain("Compatibility and security impact");
    expect(template).toContain("Validation");
    expect(template).not.toContain("DB schema changes");
    expect(template).not.toContain("Related ADR");
  });

  test("names the maintainer and conduct reporting route", () => {
    expect(read("docs/product/00-product-brief.md")).toContain("Owner: 0disoft");
    expect(read("docs/product/02-spec.md")).toContain("Owner: 0disoft");
    expect(read("CODE_OF_CONDUCT.md")).toContain("rodisoft1@gmail.com");
  });
});
