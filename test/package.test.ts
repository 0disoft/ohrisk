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
        node?: string;
      };
      packageManager?: string;
      scripts?: Record<string, string>;
      repository?: {
        url?: string;
      };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe("ohrisk");
    expect(packageJson.version).toBe("0.158.9");
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.node).toBe(">=20.0.0");
    expect(packageJson.bin).toEqual({
      ohrisk: "dist/cli.js"
    });
    expect(packageJson.files).toEqual(["CHANGELOG.md", "dist"]);
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.repository?.url).toBe("git+https://github.com/0disoft/ohrisk.git");
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.devDependencies?.["@yarnpkg/lockfile"]).toBe("1.1.0");
    expect(packageJson.devDependencies?.yaml).toBe("2.9.0");
    expect(packageJson.scripts?.build).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.prepack).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.["verify:release"]).toBe(
      "bun test && npm pack --silent --dry-run --json && bun run scripts/package-smoke.ts"
    );
  });

  test("uses Node as the packaged CLI runtime", () => {
    const mainEntrypoint = readFileSync(path.join(repoRoot, "src", "cli", "main.ts"), "utf8");
    const versionSource = readFileSync(path.join(repoRoot, "src", "cli", "version.ts"), "utf8");
    const buildScript = readFileSync(path.join(repoRoot, "scripts", "build.ts"), "utf8");
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(mainEntrypoint.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(mainEntrypoint).toContain("isCliEntrypoint(import.meta.url, process.argv[1])");
    expect(versionSource).toContain('OHRISK_VERSION = "0.158.9"');
    expect(buildScript).toContain("assertVersionContract()");
    expect(buildScript).toContain("Version mismatch: package.json declares");
    expect(buildScript).toContain('packages: "bundle"');
    expect(buildScript).toContain("chmodSync");
    expect(readme).toContain("the packaged CLI runs on Node.js");
    expect(readme).toContain("npm install -g ohrisk");
    expect(readme).toContain("pnpm dlx ohrisk scan");
  });
});
