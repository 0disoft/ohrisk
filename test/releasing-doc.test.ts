import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion();

describe("release documentation", () => {
  test("keeps public install examples on the latest dated release", () => {
    const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
    const latestReleasedVersion = /^##\s+(\d+\.\d+\.\d+)\s+-\s+\d{4}-\d{2}-\d{2}\s*$/m.exec(changelog)?.[1];
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(latestReleasedVersion).toBeDefined();
    expect(readme).toContain(`npm install -g ohrisk@${latestReleasedVersion}`);
    if (latestReleasedVersion !== packageVersion) {
      expect(readme).not.toContain(`npm install -g ohrisk@${packageVersion}`);
    }
  });

  test("keeps automated publish gates explicit", () => {
    const releasing = readFileSync(path.join(repoRoot, "RELEASING.md"), "utf8");

    expect(releasing).toContain("Publish npm package");
    expect(releasing).toContain("when a `v*` tag is pushed");
    expect(releasing).toContain("NPM_TOKEN");
    expect(releasing).toContain("bun run verify:release");
    expect(releasing).toContain(`git tag v${packageVersion}`);
    expect(releasing).toContain("package.json");
    expect(releasing).toContain(`npm view ohrisk@${packageVersion} version`);
    expect(releasing).toContain(
      `npm view ohrisk@${packageVersion} dist.tarball`
    );
    expect(releasing).toContain(
      `npm view ohrisk@${packageVersion} dist.integrity`
    );
    expect(releasing).toContain("CHANGELOG.md");
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
