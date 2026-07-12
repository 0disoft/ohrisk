import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion();

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
      publishConfig?: { access?: string };
      files?: string[];
      engines?: { node?: string };
      packageManager?: string;
      scripts?: Record<string, string>;
      repository?: { url?: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8")
    ) as { include?: string[] };
    const releaseTsconfig = JSON.parse(
      readFileSync(path.join(repoRoot, "tsconfig.release.json"), "utf8")
    ) as { extends?: string; files?: unknown; include?: unknown; exclude?: unknown };

    expect(packageJson.name).toBe("ohrisk");
    expect(packageJson.version).toBe(packageVersion);
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines?.node).toBe(">=24.0.0");
    expect(packageJson.bin).toEqual({ ohrisk: "dist/cli.js" });
    expect(packageJson.files).toEqual(["CHANGELOG.md", "dist", "schemas"]);
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.repository?.url).toBe("git+https://github.com/0disoft/ohrisk.git");
    expect(packageJson.dependencies?.["@0disoft/laqu"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@0disoft/laqu"]).toBe("latest");
    expect(packageJson.devDependencies?.["@types/bun"]).toBe("1.3.14");
    expect(packageJson.devDependencies?.["@types/node"]).toBe("24.13.2");
    expect(packageJson.devDependencies?.["@yarnpkg/lockfile"]).toBe("1.1.0");
    expect(packageJson.devDependencies?.typescript).toBe("6.0.3");
    expect(packageJson.devDependencies?.yaml).toBe("2.9.0");

    expect(packageJson.scripts?.build).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.["build:action"]).toBe("bun scripts/build-action.ts");
    expect(packageJson.scripts?.prepack).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.typecheck).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts?.lint).toBe("tsc -p tsconfig.lint.json && bun scripts/check-source-hygiene.ts");
    expect(packageJson.scripts?.["format:check"]).toBe("bun scripts/check-format.ts");
    expect(packageJson.scripts?.["test:fuzz"]).toBe("bun test test/parser-fuzz.test.ts");
    expect(packageJson.scripts?.["test:coverage"]).toBe("bun scripts/check-coverage.ts");
    expect(packageJson.scripts?.["check:action-bundle"])
      .toBe("bun scripts/check-action-bundle.ts");
    expect(packageJson.scripts?.check).toContain("bun run typecheck");
    expect(packageJson.scripts?.check).toContain("bun run verify:docs");
    expect(packageJson.scripts?.check).toContain("bun test");
    expect(packageJson.scripts?.check).toContain("bun run test:fuzz");
    expect(packageJson.scripts?.["verify:release"]).toContain("bun run check");
    expect(packageJson.scripts?.["verify:release"]).toContain("bun run test:coverage");
    expect(packageJson.scripts?.["verify:release"]).toContain("npm pack --silent --dry-run --json");
    expect(packageJson.scripts?.["verify:release"]).toContain("scripts/package-smoke.ts");

    expect(new Set(tsconfig.include)).toEqual(new Set([
      "src/**/*.ts",
      "test/**/*.ts",
      "scripts/**/*.ts"
    ]));
    expect(existsSync(path.join(repoRoot, "tsconfig.release.json"))).toBe(true);
    expect(releaseTsconfig.extends).toBe("./tsconfig.json");
    expect(releaseTsconfig.files).toBeUndefined();
    expect(releaseTsconfig.include).toBeUndefined();
    expect(releaseTsconfig.exclude).toBeUndefined();
  });

  test("uses Node as the packaged and action CLI runtime", () => {
    const mainEntrypoint = readFileSync(path.join(repoRoot, "src", "cli", "main.ts"), "utf8");
    const versionSource = readFileSync(path.join(repoRoot, "src", "cli", "version.ts"), "utf8");
    const buildScript = readFileSync(path.join(repoRoot, "scripts", "build.ts"), "utf8");
    const bundleScript = readFileSync(path.join(repoRoot, "scripts", "bundle.ts"), "utf8");
    const actionCheck = readFileSync(
      path.join(repoRoot, "scripts", "check-action-bundle.ts"),
      "utf8"
    );
    const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(mainEntrypoint.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(mainEntrypoint).toContain("isCliEntrypoint(import.meta.url, process.argv[1])");
    expect(versionSource).toContain(`OHRISK_VERSION = "${packageVersion}"`);
    expect(buildScript).toContain("assertVersionContract()");
    expect(buildScript).toContain('rmSync("dist"');
    expect(buildScript).toContain('rmSync("action-dist"');
    expect(buildScript).toContain('copyFileSync(packageBundle, "action-dist/cli.js")');
    expect(bundleScript).toContain('packages: "bundle"');
    expect(bundleScript).toContain('target: "node"');
    expect(bundleScript).toContain("assertBuiltCliVersion");
    expect(actionCheck).toContain("action-dist/cli.js is stale");
    expect(readme).toContain("the packaged CLI runs on Node.js");
    expect(readme).toContain("npm install -g ohrisk");
    expect(readme).toContain("pnpm dlx ohrisk scan");
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
