import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release documentation", () => {
  test("keeps manual publish gates explicit", () => {
    const releasing = readFileSync(path.join(repoRoot, "RELEASING.md"), "utf8");

    expect(releasing).toContain("human-run release checklist");
    expect(releasing).toContain("npm authentication is available");
    expect(releasing).toContain("bun run verify:release");
    expect(releasing).toContain("npm whoami");
    expect(releasing).toContain("npm publish --access public");
    expect(releasing).toContain("npm view ohrisk version");
    expect(releasing).toContain("git tag v0.76.0");
    expect(releasing).toContain("CHANGELOG.md");
  });
});
