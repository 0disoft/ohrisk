import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("README report contract", () => {
  test("documents the beginner HTML report flow", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("Beginner HTML report flow on Windows PowerShell");
    expect(readme).toContain("npm install -g ohrisk@latest");
    expect(readme).toContain("ohrisk scan --html --output reports\\ohrisk-report.html --open");
    expect(readme).toContain("The scan prints a progress bar");
    expect(readme).toContain("Wrote report to ...");
    expect(readme).toContain("temporary `127.0.0.1` browser");
  });

  test("documents a Quickstart section before When to use it", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    const quickstartIdx = readme.indexOf("## Quickstart");
    const whenIdx = readme.indexOf("## When to use it");
    expect(quickstartIdx).toBeGreaterThan(-1);
    expect(whenIdx).toBeGreaterThan(-1);
    expect(quickstartIdx).toBeLessThan(whenIdx);

    expect(readme).toContain("npm install -g ohrisk");
    expect(readme).toContain("ohrisk scan --profile saas --prod");
    expect(readme).toContain("ohrisk scan --html --output ohrisk-report.html --open");
    expect(readme).toContain("npx ohrisk scan");
  });

  test("keeps Usage as a detailed reference without the duplicate command-shape block", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("Install with another package manager if you do not want npm");
    expect(readme).toContain("Run once with a package-manager exec command");
    expect(readme).toContain("Write browser, SARIF, SBOM, or PR reports to files");
    expect(readme).not.toContain("Once installed as a package, the intended command shape is");
  });

  test("documents waiver mode and fingerprint-bearing report shapes", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("explicit waiver mode in JSON, terminal, Markdown, HTML, and SARIF reports");
    expect(readme).toContain("CycloneDX 1.5 JSON SBOM reports with dependency relationships and Ohrisk risk decision properties");
    expect(readme).toContain("explicit waiver mode in CycloneDX SBOM metadata");
    expect(readme).toContain("Reports include a waiver mode field or summary line");
    expect(readme).toContain("Waiver mode: local (.ohrisk-waivers.json)");
    expect(readme).toContain('"waiverMode": "local"');
    expect(readme).toContain("| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |");
    expect(readme).toContain("fingerprint: agpl-child@0.1.0::production::transitive");
    expect(readme).toContain("stable diff matching that uses finding fingerprints");
    expect(readme).toContain("ci --no-waivers");
  });
});
