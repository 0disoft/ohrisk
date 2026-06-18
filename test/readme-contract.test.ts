import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("README report contract", () => {
  test("documents waiver mode and fingerprint-bearing report shapes", () => {
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain("explicit waiver mode in JSON, terminal, Markdown, and SARIF reports");
    expect(readme).toContain("Reports include a waiver mode field or summary line");
    expect(readme).toContain("Waiver mode: local (.ohrisk-waivers.json)");
    expect(readme).toContain('"waiverMode": "local"');
    expect(readme).toContain("| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |");
    expect(readme).toContain("fingerprint: agpl-child@0.1.0::production::transitive");
    expect(readme).toContain("ci --no-waivers");
  });
});
