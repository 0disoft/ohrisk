import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function extractLinks(text: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    links.push({ text: match[1], url: match[2] });
  }
  return links;
}

function extractSection(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start + heading.length);
  const nextHeading = rest.indexOf("\n## ");
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

describe("documentation contract", () => {
  test("README Documentation section links are package-safe GitHub docs URLs", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const section = extractSection(readme, "## Documentation");
    expect(section).not.toBe("");

    const links = extractLinks(section);

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      expect(link.url, `${link.text}: ${link.url}`).toMatch(
        /^https:\/\/github\.com\/0disoft\/ohrisk\/blob\/main\/docs\/[\w/-]+\.md(?:#[\w.-]+)?$/
      );
    }
  });

  test("docs/README.md relative link targets exist", () => {
    const docsReadme = readFileSync(
      path.join(repoRoot, "docs", "README.md"),
      "utf8"
    );
    const links = extractLinks(docsReadme);
    const relativeLinks = links.filter((l) => !l.url.startsWith("http"));

    expect(relativeLinks.length).toBeGreaterThan(0);

    for (const link of relativeLinks) {
      const target = link.url.split("#")[0];
      const resolved = path.resolve(repoRoot, "docs", target);
      expect(existsSync(resolved), `missing: ${target}`).toBe(true);
    }
  });

  test("docs/ko/README.md relative link targets exist", () => {
    const koReadme = readFileSync(
      path.join(repoRoot, "docs", "ko", "README.md"),
      "utf8"
    );
    const links = extractLinks(koReadme);
    const relativeLinks = links.filter((l) => !l.url.startsWith("http"));

    expect(relativeLinks.length).toBeGreaterThan(0);

    for (const link of relativeLinks) {
      const target = link.url.split("#")[0];
      const resolved = path.resolve(repoRoot, "docs", "ko", target);
      expect(existsSync(resolved), `missing: ${target}`).toBe(true);
    }
  });

  test("docs/report-formats.md preserves SARIF boundary statements", () => {
    const doc = readFileSync(
      path.join(repoRoot, "docs", "report-formats.md"),
      "utf8"
    );
    const sarifSection = extractSection(doc, "## SARIF");
    expect(sarifSection).not.toBe("");

    // SARIF includes waived findings as suppressed results
    expect(sarifSection).toContain(
      "- **Waived findings**: included as suppressed results"
    );
    // SARIF summarizes expired/unmatched as count properties, not object lists
    expect(sarifSection).toContain(
      "- **Expired/unmatched waivers**: NOT listed as individual objects. Summarized as count properties"
    );
    expect(sarifSection).toContain("ohriskExpiredWaiverCount");
    expect(sarifSection).toContain("ohriskUnmatchedWaiverCount");
  });

  test("docs/report-formats.md preserves CycloneDX boundary statements", () => {
    const doc = readFileSync(
      path.join(repoRoot, "docs", "report-formats.md"),
      "utf8"
    );
    const cyclonedxSection = extractSection(doc, "## CycloneDX");
    expect(cyclonedxSection).not.toBe("");

    // CycloneDX does not list waived findings
    expect(cyclonedxSection).toContain(
      "- **Waived findings**: NOT listed. CycloneDX does not receive waived finding data."
    );
    expect(cyclonedxSection).toContain(
      "- **Expired/unmatched waivers**: NOT listed."
    );
    // CycloneDX includes waiver mode metadata
    expect(cyclonedxSection).toContain(
      "- **Waiver mode**: `ohrisk:waiverMode` in metadata properties"
    );
  });

  test("docs/github-actions.md preserves PR comment and SARIF workflow boundaries", () => {
    const doc = readFileSync(
      path.join(repoRoot, "docs", "github-actions.md"),
      "utf8"
    );

    expect(doc).toContain("ohrisk diff origin/main --prod --fail-on high");
    expect(doc).toContain(
      "ohrisk diff origin/main --prod --markdown --output reports/ohrisk-pr.md"
    );
    expect(doc).toContain("<!-- ohrisk-pr-comment -->");
    expect(doc).toContain("pull-requests: write");
    expect(doc).toContain("github.rest.issues.updateComment");
    expect(doc).toContain("security-events: write");
    expect(doc).toContain("github/codeql-action/upload-sarif@v3");
    expect(doc).toContain("ohrisk ci --prod --strict-waivers");
    expect(doc).toContain("Ohrisk is a risk decision aid, not legal advice.");
  });

  test("docs/risky-demo.md preserves fixture demo commands and package boundary", () => {
    const doc = readFileSync(
      path.join(repoRoot, "docs", "risky-demo.md"),
      "utf8"
    );

    expect(doc).toContain("The published npm");
    expect(doc).toContain("package ships the CLI, not the test fixtures.");
    expect(doc).toContain("ohrisk scan --lockfile test/fixtures/bun-project/bun.lock --profile saas --prod");
    expect(doc).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(doc).toContain("ohrisk scan --lockfile test/fixtures/bun-project/bun.lock --profile distributed-app --prod");
  });
});
