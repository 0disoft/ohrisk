import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function extractLinks(text: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const linkText = match[1];
    const url = match[2];
    if (linkText !== undefined && url !== undefined) {
      links.push({ text: linkText, url });
    }
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
      const target = link.url.split("#", 1)[0];
      if (target === undefined) throw new Error("Expected a documentation link target.");
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
      const target = link.url.split("#", 1)[0];
      if (target === undefined) throw new Error("Expected a documentation link target.");
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

  test("documents the bounded remote repository and HTML output contract", () => {
    const commandContract = readFileSync(
      path.join(repoRoot, "docs", "cli", "command-contract.md"),
      "utf8"
    );
    const remoteBoundary = readFileSync(
      path.join(repoRoot, "docs", "remote-fetching.md"),
      "utf8"
    );
    const reportFormats = readFileSync(
      path.join(repoRoot, "docs", "report-formats.md"),
      "utf8"
    );
    const normalizedCommandContract = commandContract.replace(/\s+/g, " ");
    const normalizedRemoteBoundary = remoteBoundary.replace(/\s+/g, " ");

    expect(commandContract).toContain("## Remote Repository Input");
    expect(commandContract).toContain("https://github.com/<owner>/<repository>[.git]");
    expect(commandContract).toContain("50,000 entries");
    expect(commandContract).toContain("512 MiB");
    expect(commandContract).toContain("Symbolic-link entries are never followed");
    expect(normalizedCommandContract).toContain("A symbolic link cannot supply a lockfile or manifest");
    expect(normalizedCommandContract).toContain("no dependency project was detected");
    expect(normalizedCommandContract).toContain("merges every supported input across multiple nested project roots");
    expect(normalizedCommandContract).toContain("limited to 64 project roots and 128 dependency inputs");
    expect(commandContract).toContain("not supported by `ci`, `diff`, or the GitHub Action");
    expect(remoteBoundary).toContain("public GitHub HTTPS repository input");
    expect(normalizedRemoteBoundary).toContain("multiple nested project roots are merged into one repository-wide graph");
    expect(remoteBoundary).toContain("not the clone, owns policy, waivers, cache, and report output");
    expect(remoteBoundary).toContain("Symbolic-link blobs are also skipped");
    expect(normalizedRemoteBoundary).toContain("cannot act as a dependency manifest or lockfile");
    expect(remoteBoundary).toContain("https://repo.maven.apache.org/maven2/");
    expect(remoteBoundary).toContain("eight inherited parent levels");
    expect(remoteBoundary).toContain("exact host is explicitly allowed by policy or `--allow-host`");
    expect(remoteBoundary).toContain("publishes a SHA-256 sidecar");
    expect(remoteBoundary).toContain("META-INF/maven/<groupId>/<artifactId>/pom.properties");
    expect(normalizedCommandContract).toContain("bounded npm/PyPI/Maven remote package-evidence pipeline");
    expect(normalizedCommandContract).toContain("exact reactor-internal module dependencies are excluded");
    expect(reportFormats).toContain("`scan --html <github-url>` writes `<repository>-ohrisk.html`");
    expect(reportFormats).toContain("restriction scope: documentation in <path>");
    expect(reportFormats).toContain("restriction scope: data in <path>");
    expect(reportFormats).toContain("Fingerprint waivers for corrected Maven findings must be reviewed after upgrade");
    expect(readFileSync(path.join(repoRoot, "docs", "profiles.md"), "utf8")).toContain(
      "they do not override a separate package-code license"
    );
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
