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
        node?: string;
      };
      packageManager?: string;
    };

    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.node).toBe(">=20.0.0");
    expect(workflow).toContain("name: Release Check");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("uses: actions/setup-node@v4");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("node --version");
    expect(workflow).toContain("run: bun run verify:release");
  });
});

describe("npm publish workflow", () => {
  test("publishes version tags after release verification", () => {
    const workflow = readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );

    expect(workflow).toContain("name: Publish npm package");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('- "v*"');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("uses: actions/checkout@v4");
    expect(workflow).toContain("uses: actions/setup-node@v4");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("Release tag ${GITHUB_REF_NAME} does not match");
    expect(workflow).toContain("run: bun run verify:release");
    expect(workflow).toContain("already_published=true");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toContain("npm view \"${package_name}\" dist.tarball");
    expect(workflow).toContain("CHANGELOG.md does not contain");
    expect(workflow).toContain("gh release create \"$GITHUB_REF_NAME\"");
    expect(workflow).not.toContain("release:");
  });
});
