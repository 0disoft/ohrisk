import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release check workflow", () => {
  test("runs the release-relevant local gates", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as {
      engines?: {
        bun?: string;
      };
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.bun).toBe(">=1.3.0");
    expect(workflow).toContain("name: Release Check");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("run: bun test");
    expect(workflow).toContain("run: npm pack --dry-run --json");
  });
});
