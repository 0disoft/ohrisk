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
  test("README Documentation section docs links are GitHub absolute URLs", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const section = extractSection(readme, "## Documentation");
    expect(section).not.toBe("");

    const links = extractLinks(section);
    const docsLinks = links.filter((l) => l.url.includes("/docs/"));

    expect(docsLinks.length).toBeGreaterThan(0);

    for (const link of docsLinks) {
      expect(link.url).toMatch(
        /^https:\/\/github\.com\/0disoft\/ohrisk\/blob\/main\/docs\//
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

    // SARIF includes waived findings as suppressed results
    expect(doc).toContain("suppressed results");
    // SARIF summarizes expired/unmatched as count properties, not object lists
    expect(doc).toContain("ohriskExpiredWaiverCount");
    expect(doc).toContain("ohriskUnmatchedWaiverCount");
    expect(doc).toContain("NOT listed as individual objects");
  });

  test("docs/report-formats.md preserves CycloneDX boundary statements", () => {
    const doc = readFileSync(
      path.join(repoRoot, "docs", "report-formats.md"),
      "utf8"
    );

    // CycloneDX does not list waived findings
    expect(doc).toContain("NOT listed");
    // CycloneDX includes waiver mode metadata
    expect(doc).toContain("ohrisk:waiverMode");
  });
});
