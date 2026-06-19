import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("package metadata", () => {
  test("is publishable as the ohrisk CLI package", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as {
      name?: string;
      version?: string;
      private?: boolean;
      license?: string;
      bin?: Record<string, string>;
      publishConfig?: {
        access?: string;
      };
      files?: string[];
      engines?: {
        bun?: string;
      };
      packageManager?: string;
      scripts?: Record<string, string>;
      repository?: {
        url?: string;
      };
      dependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe("ohrisk");
    expect(packageJson.version).toBe("0.101.0");
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.bun).toBe(">=1.3.0");
    expect(packageJson.bin).toEqual({
      ohrisk: "./src/cli/main.ts"
    });
    expect(packageJson.files).toEqual(["CHANGELOG.md", "src"]);
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.repository?.url).toBe("git+https://github.com/0disoft/ohrisk.git");
    expect(packageJson.dependencies?.["@yarnpkg/lockfile"]).toBe("1.1.0");
    expect(packageJson.dependencies?.yaml).toBe("2.9.0");
    expect(packageJson.scripts?.["verify:release"]).toBe(
      "bun test && npm pack --dry-run --json && bun run scripts/package-smoke.ts"
    );
  });

  test("uses Bun as the packaged CLI runtime", () => {
    const mainEntrypoint = readFileSync(path.join(repoRoot, "src", "cli", "main.ts"), "utf8");
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(mainEntrypoint.startsWith("#!/usr/bin/env bun")).toBe(true);
    expect(readme).toContain("the CLI runs on Bun");
    expect(readme).toContain("bun add -g ohrisk");
  });
});
