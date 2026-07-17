import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion();

describe("README report contract", () => {
  test("documents the beginner HTML report flow", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("Beginner HTML report flow on Windows PowerShell");
    expect(readme).toContain(`npm install -g ohrisk@${packageVersion}`);
    expect(readme).toContain("ohrisk scan --html --output reports\\ohrisk-report.html --open");
    expect(readme).toContain("The scan prints live terminal progress");
    expect(readme).toContain("plain append-only progress lines");
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
    expect(readme).toContain("stable diff matching that uses finding IDs and fingerprints");
    expect(readme).toContain("ci --no-waivers");
  });

  test("documents bounded archive scanning and its trust boundary", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const normalized = readme.replace(/\s+/g, " ");

    expect(readme).toContain("ohrisk scan --archive artifacts/source.zip");
    expect(readme).toContain(
      "ohrisk ci --archive artifacts/source.tar.gz --all --fail-on high"
    );
    expect(readme).toContain("Archive mode is available for `scan` and `ci`, not `diff`");
    expect(normalized).toContain("nested archives are not opened");
    expect(normalized).toContain("`--archive` cannot be combined with `--lockfile` or `--workspace-root`");
    expect(normalized).toContain("it can be combined with `--all`");
    expect(normalized).toContain("Policy and waiver files inside an archive are never auto-loaded");
    expect(readme).toContain("Encrypted or ZIP64 archives");
    expect(readme).toContain("exact limits");
  });

  test("documents bounded GitHub repository scanning and current-directory HTML output", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const normalized = readme.replace(/\s+/g, " ");

    expect(readme).toContain("ohrisk scan --html https://github.com/0disoft/laqu.git");
    expect(readme).toContain("ohrisk scan --repo https://github.com/0disoft/laqu.git --json");
    expect(readme).toContain("ohrisk scan --html https://github.com/Mbed-TLS/mbedtls.git");
    expect(readme).toContain("laqu-ohrisk.html");
    expect(readme).toContain("requires a Git executable available on `PATH`");
    expect(normalized).toContain("Only public `https://github.com/<owner>/<repository>[.git]` URLs are accepted");
    expect(normalized).toContain("checkout-local policy and waivers are never trusted");
    expect(normalized).toContain("Ohrisk recursively selects the only nested dependency project");
    expect(normalized).toContain("Multiple nested project roots remain ambiguous");
    expect(normalized).toContain("supported by `scan`, not `ci`, `diff`, or the composite GitHub Action");
  });
});

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must contain a string version.");
  }
  return packageJson.version;
}
