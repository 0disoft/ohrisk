import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release documentation", () => {
  test("keeps automated publish gates explicit", () => {
    const releasing = readFileSync(path.join(repoRoot, "RELEASING.md"), "utf8");

    expect(releasing).toContain("Publish npm package");
    expect(releasing).toContain("when a `v*` tag is pushed");
    expect(releasing).toContain("NPM_TOKEN");
    expect(releasing).toContain("bun run verify:release");
    expect(releasing).toContain("git tag v0.158.10");
    expect(releasing).toContain("package.json");
    expect(releasing).toContain("npm view ohrisk version");
    expect(releasing).toContain("CHANGELOG.md");
  });
});
