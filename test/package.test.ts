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
      exports?: Record<string, string | { types?: string }>;
      typesVersions?: Record<string, Record<string, string[]>>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tsconfig = JSON.parse(
      readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8")
    ) as {
      include?: string[];
      compilerOptions?: {
        noUncheckedIndexedAccess?: boolean;
        exactOptionalPropertyTypes?: boolean;
        skipLibCheck?: boolean;
      };
    };
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
    expect(packageJson.exports).toEqual({
      "./report-types": {
        types: "./dist/report-types.d.ts"
      },
      "./schemas/common": "./schemas/common.schema.json",
      "./schemas/scan-report": "./schemas/scan-report.schema.json",
      "./schemas/diff-report": "./schemas/diff-report.schema.json",
      "./schemas/explain-report": "./schemas/explain-report.schema.json",
      "./schemas/waiver-file": "./schemas/waiver-file.schema.json",
      "./schemas/*": "./schemas/*",
      "./dist/*": "./dist/*",
      "./CHANGELOG.md": "./CHANGELOG.md",
      "./README.md": "./README.md",
      "./LICENSE": "./LICENSE",
      "./package.json": "./package.json"
    });
    expect(packageJson.typesVersions).toEqual({
      "*": {
        "report-types": ["dist/report-types.d.ts"]
      }
    });
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.repository?.url).toBe("git+https://github.com/0disoft/ohrisk.git");
    expect(packageJson.dependencies?.["@0disoft/laqu"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@0disoft/laqu"]).toBe("^1.1.9");
    expect(packageJson.devDependencies?.["@types/bun"]).toBe("^1.3.14");
    expect(packageJson.devDependencies?.["@types/node"]).toBe("^26.2.0");
    expect(packageJson.devDependencies?.["@yarnpkg/lockfile"]).toBe("^1.1.0");
    expect(packageJson.devDependencies?.typescript).toBe("^7.0.2");
    expect(packageJson.devDependencies?.yaml).toBe("^2.9.0");

    expect(packageJson.scripts?.build).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.["build:action"]).toBe("bun scripts/build-action.ts");
    expect(packageJson.scripts?.prepack).toBe("bun scripts/build.ts");
    expect(packageJson.scripts?.typecheck).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts?.["typecheck:strict-source"]).toBeUndefined();
    expect(packageJson.scripts?.lint).toBe("tsc -p tsconfig.lint.json && bun scripts/check-source-hygiene.ts");
    expect(packageJson.scripts?.["format:check"]).toBe("bun scripts/check-format.ts");
    expect(packageJson.scripts?.["test:fuzz"]).toBe("bun test test/parser-fuzz.test.ts");
    expect(packageJson.scripts?.["test:platform"]).toContain("test/evidence-cache.test.ts");
    expect(packageJson.scripts?.["test:platform"]).toContain("test/write-output.test.ts");
    expect(packageJson.scripts?.["test:coverage"]).toBe("bun scripts/check-coverage.ts");
    expect(packageJson.scripts?.["eval:heldout"]).toBe("bun scripts/evaluate-license-heldout.ts");
    expect(packageJson.scripts?.["eval:heldout:tools"])
      .toBe("bun scripts/compare-license-heldout-tools.ts");
    expect(packageJson.scripts?.["check:action-bundle"])
      .toBe("bun scripts/check-action-bundle.ts");
    expect(packageJson.scripts?.["check:static"]).toBe(
      "bun run format:check && bun run lint && bun run typecheck && bun run verify:docs && bun run check:action-bundle"
    );
    expect(packageJson.scripts?.check).toBe("bun run check:static && bun test");
    expect(packageJson.scripts?.["verify:release"]).toBe(
      "bun run check:static && bun run test:coverage && bun run eval:heldout && npm pack --silent --dry-run --json && bun run scripts/package-smoke.ts"
    );

    expect(new Set(tsconfig.include)).toEqual(new Set([
      "src/**/*.ts",
      "test/**/*.ts",
      "scripts/**/*.ts"
    ]));
    expect(tsconfig.compilerOptions?.noUncheckedIndexedAccess).toBe(true);
    expect(tsconfig.compilerOptions?.exactOptionalPropertyTypes).toBe(true);
    expect(tsconfig.compilerOptions?.skipLibCheck).toBe(false);
    expect(existsSync(path.join(repoRoot, "tsconfig.release.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "tsconfig.strict-source.json"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "types", "report-types.d.ts"))).toBe(true);
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
    expect(versionSource).toContain('from "../../package.json" with { type: "json" }');
    expect(versionSource).toContain("packageMetadata.version");
    expect(buildScript).toContain("assertVersionContract()");
    expect(buildScript).toContain('rmSync("dist"');
    expect(buildScript).toContain('rmSync("action-dist"');
    expect(buildScript).toContain(
      'copyFileSync("types/report-types.d.ts", "dist/report-types.d.ts")'
    );
    expect(buildScript).toContain('copyFileSync(packageBundle, "action-dist/cli.js")');
    expect(bundleScript).toContain('packages: "bundle"');
    expect(bundleScript).toContain('target: "node"');
    expect(bundleScript).toContain("CLI_BUNDLE_VIRTUAL_DIRNAME");
    expect(bundleScript).toContain("assertPortableCliBundle(bundlePath)");
    expect(bundleScript).not.toContain("${process.platform}");
    expect(bundleScript).toContain("assertBuiltCliVersion");
    expect(bundleScript).not.toContain("readSourceVersion");
    expect(actionCheck).toContain("action-dist/cli.js is stale");
    expect(actionCheck).toContain("actionBundleSourceFingerprint()");
    expect(actionCheck).toContain("assertBuiltCliVersion(freshBundle, packageVersion)");
    expect(actionCheck).toContain("assertBuiltCliVersion(checkedInBundle, packageVersion)");
    expect(actionCheck).toContain("freshBytes.equals(checkedInBytes)");
    expect(actionCheck).toContain("not byte-for-byte reproducible");
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
