import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("README report contract", () => {
  test("documents the beginner HTML report flow", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("Beginner HTML report flow on Windows PowerShell");
    expect(readme).toContain("bun add -g ohrisk@latest");
    expect(readme).toContain('ohrisk scan --html --output "$env:TEMP\\ohrisk-report.html" --open');
    expect(readme).toContain("The scan prints a progress bar");
    expect(readme).toContain("Wrote report to ...");
    expect(readme).toContain("temporary `127.0.0.1` browser");
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
    expect(readme).toContain("ci --no-waivers");
  });
});
