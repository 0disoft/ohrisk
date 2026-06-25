import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { main, type CliIO } from "../src/cli/main";
import { createError } from "../src/shared/errors";
import { err } from "../src/shared/result";
import { createTarGz } from "./helpers/tar";
import { createZip } from "./helpers/zip";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function createTestIO(cwd: string): { io: CliIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    },
    stdout,
    stderr
  };
}

function writeLocalPackage(
  projectDir: string,
  name: string,
  version: string,
  license: string,
  evidenceFilename: string,
  evidenceText: string
): void {
  const packageDir = path.join(projectDir, "node_modules", ...name.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name, version, license }),
    "utf8"
  );
  writeFileSync(path.join(packageDir, evidenceFilename), evidenceText, "utf8");
}

describe("main", () => {
  test("prints help text", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["help"], io);

    const output = stdout.join("\n");
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Ohrisk");
    expect(output).toContain("ohrisk scan");
    expect(output).toContain("ohrisk help [command]");
    expect(output).toContain("ohrisk version");
    expect(output).toContain("--lockfile <path>");
    expect(output).toContain("--help, -h");
    expect(output).toContain("--cyclonedx");
  });

  test("prints command-specific help text", async () => {
    const scan = createTestIO(fixturesDir);
    const scanExitCode = await main(["help", "scan"], scan.io);
    const scanOutput = scan.stdout.join("\n");

    expect(scanExitCode).toBe(0);
    expect(scan.stderr).toEqual([]);
    expect(scanOutput).toContain("Ohrisk scan");
    expect(scanOutput).toContain("ohrisk scan [--lockfile <path>]");
    expect(scanOutput).toContain("--lockfile <path>");
    expect(scanOutput).toContain("--cyclonedx");
    expect(scanOutput).toContain("--help, -h");
    expect(scanOutput).not.toContain("--fail-on");

    const ci = createTestIO(fixturesDir);
    const ciExitCode = await main(["help", "ci"], ci.io);
    const ciOutput = ci.stdout.join("\n");

    expect(ciExitCode).toBe(0);
    expect(ci.stderr).toEqual([]);
    expect(ciOutput).toContain("Ohrisk ci");
    expect(ciOutput).toContain("--fail-on <severity>");
    expect(ciOutput).toContain("--strict-waivers");
    expect(ciOutput).toContain("--help, -h");

    const diff = createTestIO(fixturesDir);
    const diffExitCode = await main(["help", "diff"], diff.io);
    const diffOutput = diff.stdout.join("\n");

    expect(diffExitCode).toBe(0);
    expect(diff.stderr).toEqual([]);
    expect(diffOutput).toContain("Ohrisk diff");
    expect(diffOutput).toContain("ohrisk diff <baseline-ref>");
    expect(diffOutput).toContain("--markdown");
    expect(diffOutput).toContain("--help, -h");
    expect(diffOutput).not.toContain("--sarif");

    const explain = createTestIO(fixturesDir);
    const explainExitCode = await main(["help", "explain"], explain.io);
    const explainOutput = explain.stdout.join("\n");

    expect(explainExitCode).toBe(0);
    expect(explain.stderr).toEqual([]);
    expect(explainOutput).toContain("Ohrisk explain");
    expect(explainOutput).toContain("ohrisk explain <license-expression>");
    expect(explainOutput).toContain("--json");
    expect(explainOutput).toContain("--help, -h");

    const scanFlag = createTestIO(fixturesDir);
    const scanFlagExitCode = await main(["scan", "--help"], scanFlag.io);

    expect(scanFlagExitCode).toBe(0);
    expect(scanFlag.stderr).toEqual([]);
    expect(scanFlag.stdout.join("\n")).toContain("Ohrisk scan");
    expect(scanFlag.stdout.join("\n")).toContain("--help, -h");

    const helpFlag = createTestIO(fixturesDir);
    const helpFlagExitCode = await main(["help", "--help"], helpFlag.io);

    expect(helpFlagExitCode).toBe(0);
    expect(helpFlag.stderr).toEqual([]);
    expect(helpFlag.stdout.join("\n")).toContain("Ohrisk help");
    expect(helpFlag.stdout.join("\n")).toContain("ohrisk help [command]");
    expect(helpFlag.stdout.join("\n")).toContain("--help, -h");

    const versionFlag = createTestIO(fixturesDir);
    const versionFlagExitCode = await main(["version", "--help"], versionFlag.io);

    expect(versionFlagExitCode).toBe(0);
    expect(versionFlag.stderr).toEqual([]);
    expect(versionFlag.stdout.join("\n")).toContain("Ohrisk version");
    expect(versionFlag.stdout.join("\n")).toContain("ohrisk --version");
    expect(versionFlag.stdout.join("\n")).toContain("--help, -h");
  });

  test("prints package version", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["version"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual(["ohrisk 0.154.0"]);
  });

  test("returns invalid input for extra version arguments", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["version", "scan"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("INVALID_ARGUMENT");
    expect(stderr.join("\n")).toContain("version does not accept those extra arguments.");
    expect(stderr.join("\n")).toContain("extraArgs: scan");
  });

  test("prints actionable findings for a Bun project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Ohrisk scan");
    expect(stdout.join("\n")).toContain("Lockfile: bun.lock (bun)");
    expect(stdout.join("\n")).toContain("Dependencies: 6 total, 5 direct, 1 transitive");
    expect(stdout.join("\n")).toContain("Evidence: 5 files, 1 warnings");
    expect(stdout.join("\n")).toContain("Licenses: 5 high-confidence, 0 medium-confidence, 1 low-confidence");
    expect(stdout.join("\n")).toContain("License issues: 1 missing, 0 malformed");
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain("Status: profile-aware risk evaluated");
    expect(stdout.join("\n")).toContain("Findings:");
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
    expect(stdout.join("\n")).toContain(
      "id: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0"
    );
    expect(stdout.join("\n")).toContain(
      "fingerprint: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas."
    );
    expect(stdout.join("\n")).toContain("recommendation: replace");
    expect(stdout.join("\n")).toContain(
      "action: Replace this package or escalate before shipping."
    );
    expect(stdout.join("\n")).toContain("dependency: production transitive");
    expect(stdout.join("\n")).toContain(
      "path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(stdout.join("\n")).toContain("- [high] dev-risk@3.0.0");
    expect(stdout.join("\n")).toContain("recommendation: exclude-dev-only");
    expect(stdout.join("\n")).toContain(
      "action: Keep this package out of production or scan with --prod."
    );
    expect(stdout.join("\n")).toContain("dependency: development direct");
    expect(stdout.join("\n")).toContain("- [unknown] missing-license@4.0.0");
    expect(stdout.join("\n")).toContain(
      "Package metadata does not declare a license expression."
    );
    expect(stdout.join("\n")).toContain("recommendation: collect-evidence");
    expect(stdout.join("\n")).toContain(
      "action: Add or verify package license metadata before approving this package."
    );
    expect(stdout.join("\n")).toContain("warning: No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found.");
    expect(stdout.join("\n")).toContain("file: COPYING (copying)");
    expect(stdout.join("\n")).toContain("- [review] gpl-package@5.0.0");
    expect(stdout.join("\n")).toContain("License expression should be reviewed before shipping under saas.");
    expect(stdout.join("\n")).toContain(
      "Next: Replace or escalate high-risk dependencies before shipping."
    );
  });

  test("prints actionable findings for a package-lock project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "package-lock-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: package-lock.json (package-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: fixture-package-lock-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] dev-risk@3.0.0");
  });

  test("prints actionable findings for an npm-shrinkwrap project", async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-npm-shrinkwrap-project-"));

    try {
      writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({
          name: "fixture-npm-shrinkwrap-project",
          version: "0.0.0",
          dependencies: {
            "permissive-parent": "1.0.0",
            "gpl-package": "5.0.0"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "npm-shrinkwrap.json"),
        JSON.stringify({
          name: "fixture-npm-shrinkwrap-project",
          version: "0.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": {
              name: "fixture-npm-shrinkwrap-project",
              version: "0.0.0",
              dependencies: {
                "permissive-parent": "1.0.0",
                "gpl-package": "5.0.0"
              }
            },
            "node_modules/agpl-child": {
              name: "agpl-child",
              version: "0.1.0"
            },
            "node_modules/gpl-package": {
              name: "gpl-package",
              version: "5.0.0"
            },
            "node_modules/permissive-parent": {
              name: "permissive-parent",
              version: "1.0.0",
              dependencies: {
                "agpl-child": "0.1.0"
              }
            }
          }
        }),
        "utf8"
      );
      writeLocalPackage(projectDir, "permissive-parent", "1.0.0", "MIT", "LICENSE", "MIT License");
      writeLocalPackage(projectDir, "agpl-child", "0.1.0", "AGPL-3.0-only", "COPYING", "GNU Affero General Public License");
      writeLocalPackage(projectDir, "gpl-package", "5.0.0", "GPL-3.0-only", "LICENSE", "GNU General Public License Version 3");

      const { io, stdout, stderr } = createTestIO(projectDir);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Lockfile: npm-shrinkwrap.json (npm-shrinkwrap)");
      expect(output).toContain("Dependencies: 3 total, 2 direct, 1 transitive");
      expect(output).toContain("Risks: 1 high, 1 review, 0 unknown, 1 low");
      expect(output).toContain("- [high] agpl-child@0.1.0");
      expect(output).toContain(
        "path: fixture-npm-shrinkwrap-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
      );
      expect(output).toContain("- [review] gpl-package@5.0.0");
      expect(output).toContain("- [low] permissive-parent@1.0.0");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("scans an explicit lockfile when a project has multiple lockfiles", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "multiple-lockfiles"));
    const exitCode = await main(["scan", "--lockfile", "package-lock.json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: package-lock.json (package-lock)");
    expect(output).toContain("Dependencies: 0 total, 0 direct, 0 transitive");
    expect(output).toContain("Risks: 0 high, 0 review, 0 unknown, 0 low");
  });

  test("keeps optional dependencies in production-only scans", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "optional-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Production only: yes");
    expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
    expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
    expect(output).toContain("- [high] optional-risk@1.0.0");
    expect(output).toContain("dependency: optional direct");
    expect(output).not.toContain("dev-risk@3.0.0");
  });

  test("prints actionable findings for a pnpm-lock project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "pnpm-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: pnpm-lock.yaml (pnpm-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: <root> -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] dev-risk@3.0.0");
  });

  test("prints actionable findings for a Deno npm lockfile project", async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-deno-project-"));

    try {
      writeFileSync(
        path.join(projectDir, "deno.json"),
        JSON.stringify({
          imports: {
            "permissive-parent": "npm:permissive-parent@1.0.0",
            "gpl-package": "npm:gpl-package@5.0.0"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "deno.lock"),
        JSON.stringify({
          version: "4",
          specifiers: {
            "npm:permissive-parent@1.0.0": "1.0.0",
            "npm:gpl-package@5.0.0": "5.0.0"
          },
          npm: {
            "permissive-parent@1.0.0": {
              dependencies: {
                "agpl-child": "0.1.0"
              }
            },
            "agpl-child@0.1.0": {},
            "gpl-package@5.0.0": {}
          },
          workspace: {
            dependencies: [
              "npm:permissive-parent@1.0.0",
              "npm:gpl-package@5.0.0"
            ]
          }
        }),
        "utf8"
      );
      writeLocalPackage(projectDir, "permissive-parent", "1.0.0", "MIT", "LICENSE", "MIT License");
      writeLocalPackage(projectDir, "agpl-child", "0.1.0", "AGPL-3.0-only", "COPYING", "GNU Affero General Public License");
      writeLocalPackage(projectDir, "gpl-package", "5.0.0", "GPL-3.0-only", "LICENSE", "GNU General Public License Version 3");

      const { io, stdout, stderr } = createTestIO(projectDir);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Lockfile: deno.lock (deno-lock)");
      expect(output).toContain("Dependencies: 3 total, 2 direct, 1 transitive");
      expect(output).toContain("Risks: 1 high, 1 review, 0 unknown, 1 low");
      expect(output).toContain("- [high] agpl-child@0.1.0");
      expect(output).toContain(
        `${path.basename(projectDir)} -> permissive-parent@1.0.0 -> agpl-child@0.1.0`
      );
      expect(output).toContain("- [review] gpl-package@5.0.0");
      expect(output).toContain("- [low] permissive-parent@1.0.0");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("prints structured Deno unsupported root specifier details", async () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-deno-unsupported-project-"));

    try {
      writeFileSync(
        path.join(projectDir, "deno.lock"),
        JSON.stringify({
          version: "4",
          specifiers: {
            "npm:permissive-parent@1.0.0": "1.0.0",
            "jsr:@std/path@1": "1.0.0",
            "https://deno.land/std/path/mod.ts": "https://deno.land/std/path/mod.ts",
            "file:./local.ts": "file:./local.ts"
          },
          npm: {
            "permissive-parent@1.0.0": {}
          }
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectDir);
      const exitCode = await main(["scan", "--json"], io);

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);

      const errorOutput = stderr.join("\n");
      expect(errorOutput).toContain("DENO_LOCK_UNSUPPORTED_ROOT_SPECIFIER");
      expect(errorOutput).toContain(
        "unsupportedRootSpecifiers: file:./local.ts, https://deno.land/std/path/mod.ts, jsr:@std/path@1"
      );
      expect(errorOutput).toContain("jsrRootSpecifiers: jsr:@std/path@1");
      expect(errorOutput).toContain("remoteUrlRootSpecifiers: https://deno.land/std/path/mod.ts");
      expect(errorOutput).toContain("otherUnsupportedRootSpecifiers: file:./local.ts");
    } finally {
      rmSync(projectDir, { force: true, recursive: true });
    }
  });

  test("prints actionable findings for a Yarn lockfile project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "yarn-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: yarn.lock (yarn-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: fixture-yarn-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] dev-risk@3.0.0");
  });

  test("prints actionable findings for a Yarn Berry PnP cache project without node_modules", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-pnp-cache-"));
    const cacheDir = path.join(projectRoot, ".yarn", "cache");
    mkdirSync(cacheDir, { recursive: true });

    try {
      writeFileSync(
        path.join(projectRoot, "package.json"),
        JSON.stringify({
          name: "fixture-yarn-pnp-cache",
          dependencies: {
            "pnp-cache-risk": "^1.0.0"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "yarn.lock"),
        [
          "__metadata:",
          "  version: 8",
          "  cacheKey: 10",
          "",
          "\"pnp-cache-risk@npm:^1.0.0\":",
          "  version: 1.0.0",
          "  resolution: \"pnp-cache-risk@npm:1.0.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(cacheDir, "pnp-cache-risk-npm-1.0.0-abc123.zip"),
        createZip({
          "node_modules/pnp-cache-risk/package.json": JSON.stringify({
            name: "pnp-cache-risk",
            version: "1.0.0",
            license: "AGPL-3.0"
          }),
          "node_modules/pnp-cache-risk/LICENSE": "GNU Affero General Public License version 3"
        }, { deflate: true })
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        dependencyGraph: { total: number };
        evidence: { packages: number };
        findings: Array<{ packageId: string; severity: string; evidence: string[] }>;
      };
      expect(payload.dependencyGraph.total).toBe(1);
      expect(payload.evidence.packages).toBe(1);
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "pnp-cache-risk@1.0.0",
          severity: "high",
          evidence: expect.arrayContaining([
            "source: local",
            "package.json license: AGPL-3.0",
            "file: LICENSE (license)"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Rust Cargo.lock project with local Cargo cache evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-project-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Cargo.toml"),
        [
          "[package]",
          "name = \"fixture-rust\"",
          "version = \"0.1.0\"",
          "",
          "[dependencies]",
          "risk-crate = \"1\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Cargo.lock"),
        [
          "[[package]]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "source = \"registry+https://github.com/rust-lang/crates.io-index\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: Cargo.lock (cargo-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-crate@1.0.0");
      expect(output).toContain("path: fixture-rust -> risk-crate@1.0.0");
      expect(output).toContain("source: local; Cargo.toml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("scans Rust Cargo workspace member manifests through the CLI", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-workspace-"));
    const appDir = path.join(projectRoot, "crates", "app");
    const toolDir = path.join(projectRoot, "tools", "dev-tool");
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(appDir, { recursive: true });
      mkdirSync(toolDir, { recursive: true });
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Cargo.toml"),
        [
          "[workspace]",
          "members = [\"crates/app\", \"tools/dev-tool\"]",
          "",
          "[workspace.dependencies]",
          "renamed-risk = { package = \"risk-crate\", version = \"1\" }"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(appDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"app\"",
          "version = \"0.1.0\"",
          "",
          "[dependencies]",
          "renamed-risk.workspace = true"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(toolDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"dev-tool\"",
          "version = \"0.1.0\"",
          "",
          "[dev-dependencies]",
          "dev-only-risk = \"2\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Cargo.lock"),
        [
          "[[package]]",
          "name = \"dev-only-risk\"",
          "version = \"2.0.0\"",
          "source = \"registry+https://github.com/rust-lang/crates.io-index\"",
          "",
          "[[package]]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "source = \"registry+https://github.com/rust-lang/crates.io-index\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: Cargo.lock (cargo-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("- [high] risk-crate@1.0.0");
      expect(output).toContain(`${path.basename(projectRoot)} -> risk-crate@1.0.0`);
      expect(output).toContain("source: local; Cargo.toml license: AGPL-3.0-only");
      expect(output).not.toContain("dev-only-risk@2.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Go module project with local module cache evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-project-"));
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "acme",
      "risk@v1.0.0"
    );

    try {
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "go.mod"),
        [
          "module example.com/fixture-go",
          "",
          "go 1.22",
          "",
          "require github.com/acme/risk v1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "go.sum"),
        [
          "github.com/acme/risk v1.0.0 h1:abc",
          "github.com/acme/risk v1.0.0/go.mod h1:def"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(moduleDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: go.mod (go-mod)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] github.com/acme/risk@v1.0.0");
      expect(output).toContain("path: example.com/fixture-go -> github.com/acme/risk@v1.0.0");
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints findings for a Go module replaced by another module version", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-replace-project-"));
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "acme",
      "risk-fork@v1.0.1"
    );

    try {
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "go.mod"),
        [
          "module example.com/fixture-go",
          "",
          "go 1.22",
          "",
          "require github.com/acme/risk v1.0.0",
          "replace github.com/acme/risk v1.0.0 => github.com/acme/risk-fork v1.0.1"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "go.sum"),
        [
          "github.com/acme/risk v1.0.0 h1:abc",
          "github.com/acme/risk-fork v1.0.1 h1:def",
          "github.com/acme/risk-fork v1.0.1/go.mod h1:ghi"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(moduleDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: go.mod (go-mod)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Evidence: 1 files, 1 warnings");
      expect(output).toContain("- [high] github.com/acme/risk@v1.0.0");
      expect(output).toContain("path: example.com/fixture-go -> github.com/acme/risk@v1.0.0");
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
      expect(output).toContain(
        "warning: Go replacement evidence was read from github.com/acme/risk-fork@v1.0.1."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints findings for a Go workspace using go.work replace directives", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-work-project-"));
    const appDir = path.join(projectRoot, "app");
    const moduleDir = path.join(
      projectRoot,
      "pkg",
      "mod",
      "github.com",
      "acme",
      "risk-fork@v1.0.1"
    );

    try {
      mkdirSync(appDir, { recursive: true });
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "go.work"),
        [
          "go 1.22",
          "",
          "use ./app",
          "",
          "replace github.com/acme/risk => github.com/acme/risk-fork v1.0.1"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(appDir, "go.mod"),
        [
          "module example.com/app",
          "",
          "go 1.22",
          "",
          "require github.com/acme/risk v1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(appDir, "go.sum"),
        [
          "github.com/acme/risk v1.0.0 h1:abc",
          "github.com/acme/risk-fork v1.0.1 h1:def",
          "github.com/acme/risk-fork v1.0.1/go.mod h1:ghi"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(moduleDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: go.work (go-work)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] github.com/acme/risk@v1.0.0");
      expect(output).toContain(
        `path: ${path.basename(projectRoot)} -> example.com/app -> github.com/acme/risk@v1.0.0`
      );
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
      expect(output).toContain(
        "warning: Go replacement evidence was read from github.com/acme/risk-fork@v1.0.1."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python uv.lock project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-uv-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-python\"",
          "version = \"0.1.0\"",
          "dependencies = [\"risk-pkg==1.0.0\"]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "uv.lock"),
        [
          "version = 1",
          "",
          "[[package]]",
          "name = \"fixture-python\"",
          "version = \"0.1.0\"",
          "source = { virtual = \".\" }",
          "dependencies = [",
          "    { name = \"risk-pkg\" },",
          "]",
          "",
          "[[package]]",
          "name = \"risk-pkg\"",
          "version = \"1.0.0\"",
          "source = { registry = \"https://pypi.org/simple\" }"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: uv.lock (uv-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: fixture-python -> risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python pylock.toml project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pylock-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pylock\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "pylock.toml"),
        [
          "lock-version = '1.0'",
          "created-by = 'fixture-locker'",
          "",
          "[[packages]]",
          "name = 'risk-pkg'",
          "version = '1.0.0'"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pylock.toml (pylock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: <root> -> risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a standalone Python pyproject.toml project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pyproject-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pyproject\"",
          "version = \"0.1.0\"",
          "dependencies = [",
          "  \"risk-pkg==1.0.0\",",
          "]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pyproject.toml (pyproject-toml)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: fixture-pyproject -> risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python Pipfile.lock project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pipfile-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Pipfile"),
        [
          "[packages]",
          "risk-pkg = \"*\"",
          "",
          "[dev-packages]",
          "dev-risk = \"*\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Pipfile.lock"),
        JSON.stringify({
          default: {
            "risk-pkg": {
              version: "==1.0.0"
            }
          },
          develop: {
            "dev-risk": {
              version: "==2.0.0"
            }
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: Pipfile.lock (pipfile-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: ohrisk-pipfile-project-");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
      expect(output).not.toContain("dev-risk@2.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python Pipfile.lock project with local source evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pipfile-local-source-project-"));
    const localSourceDir = path.join(projectRoot, "local-risk");

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Pipfile.lock"),
        JSON.stringify({
          default: {
            "local-risk": {
              editable: true,
              path: "./local-risk"
            }
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: Pipfile.lock (pipfile-lock)");
      expect(output).toContain("- [high] local-risk@1.0.0");
      expect(output).toContain("path: ohrisk-pipfile-local-source-project");
      expect(output).toContain("source: local; pyproject.toml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python PDM pdm.lock project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pdm-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pdm\"",
          "version = \"0.1.0\"",
          "dependencies = [",
          "    \"risk-pkg>=1.0.0\",",
          "]",
          "",
          "[dependency-groups]",
          "dev = [\"dev-risk>=2.0.0\"]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "pdm.lock"),
        [
          "[metadata]",
          "groups = [\"default\", \"dev\"]",
          "lock_version = \"4.5.0\"",
          "",
          "[[package]]",
          "name = \"dev-risk\"",
          "version = \"2.0.0\"",
          "groups = [\"dev\"]",
          "",
          "[[package]]",
          "name = \"risk-pkg\"",
          "version = \"1.0.0\"",
          "groups = [\"default\"]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pdm.lock (pdm-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: fixture-pdm -> risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
      expect(output).not.toContain("dev-risk@2.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python PDM pdm.lock project with local source evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pdm-local-source-project-"));
    const localSourceDir = path.join(projectRoot, "local-risk");

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pdm-local\"",
          "version = \"0.1.0\"",
          "dependencies = [\"local-risk @ file:./local-risk\"]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "pdm.lock"),
        [
          "[[package]]",
          "name = \"local-risk\"",
          "groups = [\"default\"]",
          "path = \"./local-risk\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pdm.lock (pdm-lock)");
      expect(output).toContain("- [high] local-risk@1.0.0");
      expect(output).toContain("path: fixture-pdm-local -> local-risk@1.0.0");
      expect(output).toContain("source: local; pyproject.toml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python requirements.txt project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "requirements.txt"),
        [
          "--index-url https://pypi.org/simple",
          "risk-pkg==1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: requirements.txt (requirements-txt)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python requirements.txt project with editable local source evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-editable-project-"));
    const localSourceDir = path.join(projectRoot, "local-risk");

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "requirements.txt"),
        [
          "--index-url https://pypi.org/simple",
          "-e ./local-risk"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(localSourceDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: requirements.txt (requirements-txt)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] local-risk@1.0.0");
      expect(output).toContain("path: ohrisk-requirements-editable-project");
      expect(output).toContain("source: local; pyproject.toml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Python poetry.lock project with local dist-info evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-poetry-project-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pyproject.toml"),
        [
          "[tool.poetry]",
          "name = \"fixture-poetry\"",
          "version = \"0.1.0\"",
          "",
          "[tool.poetry.dependencies]",
          "python = \"^3.12\"",
          "risk-pkg = \"^1.0.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "poetry.lock"),
        [
          "[[package]]",
          "name = \"risk-pkg\"",
          "version = \"1.0.0\"",
          "optional = false",
          "python-versions = \">=3.8\"",
          "groups = [\"main\"]"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: poetry.lock (poetry-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] risk-pkg@1.0.0");
      expect(output).toContain("path: fixture-poetry -> risk-pkg@1.0.0");
      expect(output).toContain("source: local; METADATA license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Java Gradle lockfile project with local Maven POM evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-project-"));
    const pomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "risk",
      "1.0.0"
    );

    try {
      mkdirSync(pomDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(
        path.join(projectRoot, "gradle.lockfile"),
        "com.acme:risk:1.0.0=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(pomDir, "risk-1.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: gradle.lockfile (gradle-lock)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] com.acme:risk@1.0.0");
      expect(output).toContain("path: ");
      expect(output).toContain("com.acme:risk@1.0.0");
      expect(output).toContain("source: local; pom.xml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Java Gradle version catalog project with local Maven POM evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-catalog-project-"));
    const pomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "risk",
      "1.0.0"
    );

    try {
      mkdirSync(path.join(projectRoot, "gradle"), { recursive: true });
      mkdirSync(pomDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "build.gradle.kts"), "plugins { java }\n", "utf8");
      writeFileSync(
        path.join(projectRoot, "gradle", "libs.versions.toml"),
        [
          "[versions]",
          "risk = \"1.0.0\"",
          "",
          "[libraries]",
          "risk-lib = { module = \"com.acme:risk\", version.ref = \"risk\" }"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(pomDir, "risk-1.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("libs.versions.toml (gradle-version-catalog)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] com.acme:risk@1.0.0");
      expect(output).toContain("path: ");
      expect(output).toContain("risk-lib");
      expect(output).toContain("com.acme:risk@1.0.0");
      expect(output).toContain("source: local; pom.xml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints unknown findings for a Bazel MODULE.bazel project without local evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bazel-module-project-"));

    try {
      writeFileSync(
        path.join(projectRoot, "MODULE.bazel"),
        [
          "module(name = \"fixture_bazel\", version = \"0.1.0\")",
          "bazel_dep(name = \"rules_cc\", version = \"0.0.9\")"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: MODULE.bazel (bazel-module)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 0 high, 0 review, 1 unknown, 0 low");
      expect(output).toContain("- [unknown] rules_cc@0.0.9");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("path: fixture_bazel -> rules_cc@0.0.9");
      expect(output).toContain("Bazel module license evidence was not found in local Bazel registry local_path sources.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints local registry evidence for a Bazel MODULE.bazel project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bazel-module-project-"));
    const registryRoot = path.join(projectRoot, "local-registry");
    const moduleVersionDir = path.join(registryRoot, "modules", "rules_cc", "0.0.9");
    const sourceDir = path.join(registryRoot, "sources", "rules_cc");

    try {
      mkdirSync(moduleVersionDir, { recursive: true });
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".bazelrc"),
        `common --registry=${pathToFileURL(registryRoot).href}`,
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "MODULE.bazel"),
        [
          "module(name = \"fixture_bazel\", version = \"0.1.0\")",
          "bazel_dep(name = \"rules_cc\", version = \"0.0.9\")"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(moduleVersionDir, "source.json"),
        JSON.stringify({
          type: "local_path",
          path: "sources/rules_cc"
        }),
        "utf8"
      );
      writeFileSync(path.join(sourceDir, "LICENSE"), "MIT", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: MODULE.bazel (bazel-module)");
      expect(output).toContain("Evidence: 1 files, 0 warnings");
      expect(output).toContain("Risks: 0 high, 0 review, 1 unknown, 0 low");
      expect(output).toContain("- [unknown] rules_cc@0.0.9");
      expect(output).toContain("source: local");
      expect(output).toContain("file: LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Java Maven pom.xml project with local POM evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-project-"));
    const dependencyPomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "risk",
      "1.0.0"
    );

    try {
      mkdirSync(dependencyPomDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pom.xml"),
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>com.example</groupId>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <version>0.1.0</version>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>com.acme</groupId>",
          "      <artifactId>risk</artifactId>",
          "      <version>1.0.0</version>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(dependencyPomDir, "risk-1.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pom.xml (maven-pom)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] com.acme:risk@1.0.0");
      expect(output).toContain("path: fixture-maven -> com.acme:risk@1.0.0");
      expect(output).toContain("source: local; pom.xml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("resolves Java Maven imported BOM versions from the local .m2 repository", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-bom-project-"));
    const bomPomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "platform-bom",
      "2.0.0"
    );
    const dependencyPomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "risk",
      "1.0.0"
    );

    try {
      mkdirSync(bomPomDir, { recursive: true });
      mkdirSync(dependencyPomDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pom.xml"),
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>com.example</groupId>",
          "  <artifactId>fixture-maven-bom</artifactId>",
          "  <version>0.1.0</version>",
          "  <dependencyManagement>",
          "    <dependencies>",
          "      <dependency>",
          "        <groupId>com.acme</groupId>",
          "        <artifactId>platform-bom</artifactId>",
          "        <version>2.0.0</version>",
          "        <type>pom</type>",
          "        <scope>import</scope>",
          "      </dependency>",
          "    </dependencies>",
          "  </dependencyManagement>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>com.acme</groupId>",
          "      <artifactId>risk</artifactId>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(bomPomDir, "platform-bom-2.0.0.pom"),
        [
          "<project>",
          "  <modelVersion>4.0.0</modelVersion>",
          "  <groupId>com.acme</groupId>",
          "  <artifactId>platform-bom</artifactId>",
          "  <version>2.0.0</version>",
          "  <dependencyManagement>",
          "    <dependencies>",
          "      <dependency>",
          "        <groupId>com.acme</groupId>",
          "        <artifactId>risk</artifactId>",
          "        <version>1.0.0</version>",
          "      </dependency>",
          "    </dependencies>",
          "  </dependencyManagement>",
          "</project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(dependencyPomDir, "risk-1.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: pom.xml (maven-pom)");
      expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
      expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
      expect(output).toContain("- [high] com.acme:risk@1.0.0");
      expect(output).toContain("path: fixture-maven-bom -> com.acme:risk@1.0.0");
      expect(output).toContain("source: local; pom.xml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });


  test("tightens GPL severity for distributed apps", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--profile", "distributed-app", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Profile: distributed-app");
    expect(output).toContain("Risks: 2 high, 0 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] gpl-package@5.0.0");
    expect(output).toContain("License expression is high risk for distributed-app.");
    expect(output).toContain("recommendation: replace");
  });

  test("prints JSON report with findings when requested", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--json", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      profile: string;
      prodOnly: boolean;
      dependencyGraph: {
        total: number;
        direct: number;
        transitive: number;
      };
      evidence: {
        packages: number;
        files: number;
        warnings: number;
      };
      licenses: {
        highConfidence: number;
        mediumConfidence: number;
        lowConfidence: number;
        missing: number;
        malformed: number;
      };
      risks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
      waiverMode: string;
      findings: Array<{
        id: string;
        fingerprint: string;
        packageId: string;
        severity: string;
        recommendation: string;
        action: string;
        dependencyType: string;
        dependencyScope: string;
        paths: string[][];
      }>;
      nextAction: string;
    };

    expect(payload.status).toBe("profile_risk_evaluated");
    expect(payload.profile).toBe("saas");
    expect(payload.prodOnly).toBe(true);
    expect(payload.dependencyGraph).toEqual({
      total: 5,
      direct: 4,
      transitive: 1
    });
    expect(payload.evidence).toEqual({
      packages: 5,
      files: 4,
      warnings: 1
    });
    expect(payload.licenses).toEqual({
      highConfidence: 4,
      mediumConfidence: 0,
      lowConfidence: 1,
      missing: 1,
      malformed: 0
    });
    expect(payload.risks).toEqual({
      high: 1,
      review: 1,
      unknown: 1,
      low: 2
    });
    expect(payload.waiverMode).toBe("local");
    expect(payload.nextAction).toBe("Replace or escalate high-risk dependencies before shipping.");
    expect(payload.findings).toHaveLength(5);
    expect(payload.findings[0]).toMatchObject({
      id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      packageId: "agpl-child@0.1.0",
      severity: "high",
      recommendation: "replace",
      action: "Replace this package or escalate before shipping.",
      dependencyType: "production",
      dependencyScope: "transitive"
    });
    expect(payload.findings[0]?.fingerprint).toContain(
      "::high::replace::License expression is high risk for saas."
    );
    expect(payload.findings[0]?.paths[0]).toEqual([
      "fixture-bun-project",
      "permissive-parent@1.0.0",
      "agpl-child@0.1.0"
    ]);
    expect(payload.findings.map((finding) => finding.packageId)).not.toContain("dev-risk@3.0.0");
    expect(payload.findings.map((finding) => finding.packageId)).toContain("missing-license@4.0.0");
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        packageId: "gpl-package@5.0.0",
        severity: "review",
        recommendation: "review"
      })
    );
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        packageId: "dual-license@2.0.0",
        severity: "low",
        recommendation: "allow",
        action: "Preserve required NOTICE or attribution files when distributing this package."
      })
    );
  });

  test("writes report output to a file instead of stdout", async () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-output-"));

    try {
      const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
      io.cwd = path.join(fixturesDir, "bun-project");

      const exitCode = await main(
        ["scan", "--json", "--prod", "--output", path.join(outputRoot, "reports", "scan.json")],
        io
      );

      expect(exitCode).toBe(0);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(
        readFileSync(path.join(outputRoot, "reports", "scan.json"), "utf8")
      ) as {
        status: string;
        prodOnly: boolean;
      };

      expect(payload.status).toBe("profile_risk_evaluated");
      expect(payload.prodOnly).toBe(true);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("returns a filesystem failure when writing report output fails", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.writeReport = (input) => err(createError({
      code: "REPORT_WRITE_FAILED",
      category: "filesystem",
      message: "Failed to write the requested report file.",
      details: {
        outputPath: input.outputPath,
        resolvedPath: path.join(io.cwd, input.outputPath),
        cause: "fixture writer failure"
      }
    }));

    const exitCode = await main(
      ["scan", "--json", "--prod", "--output", "reports/scan.json"],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("REPORT_WRITE_FAILED: Failed to write the requested report file.");
    expect(stderr[0]).toContain("outputPath: reports/scan.json");
    expect(stderr[0]).toContain(`resolvedPath: ${path.join(io.cwd, "reports/scan.json")}`);
    expect(stderr[0]).toContain("cause: fixture writer failure");
  });

  test("prints SARIF report with stable rule ids and lockfile locations", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--sarif", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: {
          driver: {
            name: string;
            semanticVersion: string;
            rules: Array<{
              id: string;
              defaultConfiguration: {
                level: string;
              };
            }>;
          };
        };
        properties: {
          ohriskWaiverMode: string;
        };
        results: Array<{
          ruleId: string;
          ruleIndex: number;
          level: string;
          message: {
            text: string;
          };
          locations: Array<{
            physicalLocation: {
              artifactLocation: {
                uri: string;
              };
              region: {
                startLine: number;
              };
            };
          }>;
          partialFingerprints: {
            primaryLocationLineHash: string;
          };
          properties: {
            packageId: string;
            findingId: string;
            fingerprint: string;
            reason: string;
            recommendation: string;
            action: string;
            dependencyType: string;
            dependencyScope: string;
          };
        }>;
      }>;
    };

    expect(payload.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(payload.version).toBe("2.1.0");
    expect(payload.runs[0]?.tool.driver.name).toBe("Ohrisk");
    expect(payload.runs[0]?.tool.driver.semanticVersion).toBe("0.154.0");
    expect(payload.runs[0]?.properties.ohriskWaiverMode).toBe("local");
    expect(payload.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "ohrisk/license-high",
      "ohrisk/license-unknown",
      "ohrisk/license-review",
      "ohrisk/license-low"
    ]);
    expect(payload.runs[0]?.results).toHaveLength(5);
    expect(payload.runs[0]?.results[0]).toMatchObject({
      ruleId: "ohrisk/license-high",
      ruleIndex: 0,
      level: "error"
    });
    expect(payload.runs[0]?.results[0]?.message.text).toContain("agpl-child@0.1.0");
    expect(payload.runs[0]?.results[0]?.message.text).toContain(
      "Dependency: production transitive."
    );
    expect(payload.runs[0]?.results[0]?.message.text).toContain(
      "Action: Replace this package or escalate before shipping."
    );
    expect(payload.runs[0]?.results[0]?.properties).toMatchObject({
      findingId:
        "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      packageId: "agpl-child@0.1.0",
      reason: "License expression is high risk for saas.",
      recommendation: "replace",
      action: "Replace this package or escalate before shipping.",
      dependencyType: "production",
      dependencyScope: "transitive"
    });
    expect(payload.runs[0]?.results[0]?.properties.fingerprint).toContain(
      "::high::replace::License expression is high risk for saas."
    );
    expect(payload.runs[0]?.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: {
        uri: "bun.lock"
      },
      region: {
        startLine: 1
      }
    });
    expect(payload.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash).toContain(
      "::high::replace::License expression is high risk for saas."
    );
  });

  test("prints waived findings as suppressed SARIF results", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-sarif-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for SARIF audit output."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--sarif", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        runs: Array<{
          properties: {
            ohriskWaiverMode: string;
            ohriskActiveFindingCount: number;
            ohriskWaivedFindingCount: number;
            ohriskExpiredWaiverCount: number;
            ohriskUnmatchedWaiverCount: number;
          };
          results: Array<{
            properties: {
              packageId: string;
              waived?: boolean;
              waiverMatchedBy?: string;
              waiverReason?: string;
            };
            suppressions?: Array<{
              kind: string;
              justification: string;
            }>;
          }>;
        }>;
      };

      expect(payload.runs[0]?.properties).toEqual({
        ohriskWaiverMode: "local",
        ohriskActiveFindingCount: 4,
        ohriskWaivedFindingCount: 1,
        ohriskExpiredWaiverCount: 0,
        ohriskUnmatchedWaiverCount: 0
      });
      expect(payload.runs[0]?.results).toHaveLength(5);

      const suppressed = payload.runs[0]?.results.find(
        (result) => result.properties.packageId === "agpl-child@0.1.0"
      );

      expect(suppressed?.suppressions).toEqual([
        {
          kind: "external",
          justification: "Accepted fixture risk for SARIF audit output."
        }
      ]);
      expect(suppressed?.properties).toMatchObject({
        waived: true,
        waiverMatchedBy: "id",
        waiverReason: "Accepted fixture risk for SARIF audit output."
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints CycloneDX SBOM output", async () => {
    const projectRoot = path.join(fixturesDir, "bun-project");
    const { io, stdout, stderr } = createTestIO(projectRoot);
    const exitCode = await main(["scan", "--cyclonedx", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      bomFormat: string;
      specVersion: string;
      version: number;
      metadata: {
        component: {
          type: string;
          name: string;
          "bom-ref": string;
        };
        properties: Array<{
          name: string;
          value: string;
        }>;
      };
      components: Array<{
        type: string;
        "bom-ref": string;
        name: string;
        version: string;
        purl: string;
        scope: string;
        licenses?: Array<
          | {
              expression: string;
            }
          | {
              license: {
                id?: string;
                name?: string;
              };
            }
        >;
        properties: Array<{
          name: string;
          value: string;
        }>;
      }>;
      dependencies: Array<{
        ref: string;
        dependsOn: string[];
      }>;
    };

    expect(payload.bomFormat).toBe("CycloneDX");
    expect(payload.specVersion).toBe("1.5");
    expect(payload.version).toBe(1);
    expect(payload.metadata.component).toEqual({
      type: "application",
      name: "fixture-bun-project",
      "bom-ref": "project"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:projectRoot",
      value: "."
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:lockfileKind",
      value: "bun"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:lockfilePath",
      value: "bun.lock"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:waiverMode",
      value: "local"
    });
    for (const property of payload.metadata.properties) {
      expect(property.value).not.toContain(projectRoot);
      expect(property.value).not.toContain(fixturesDir);
    }
    expect(payload.components).toHaveLength(5);
    expect(payload.components.map((component) => component.name)).not.toContain("dev-risk");

    const parent = payload.components.find((component) => component.name === "permissive-parent");
    expect(parent).toMatchObject({
      type: "library",
      "bom-ref": "pkg:npm/permissive-parent@1.0.0",
      version: "1.0.0",
      purl: "pkg:npm/permissive-parent@1.0.0",
      scope: "required"
    });

    const dualLicense = payload.components.find((component) => component.name === "dual-license");
    expect(dualLicense?.licenses).toEqual([
      {
        expression: "MIT OR Apache-2.0"
      }
    ]);

    const missingLicense = payload.components.find((component) => component.name === "missing-license");
    expect(missingLicense?.licenses).toBeUndefined();
    expect(missingLicense?.properties).toContainEqual({
      name: "ohrisk:licenseSignals",
      value: "missing"
    });

    const highRisk = payload.components.find((component) => component.name === "agpl-child");
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:riskSeverity",
      value: "high"
    });
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:recommendation",
      value: "replace"
    });
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:action",
      value: "Replace this package or escalate before shipping."
    });
    expect(highRisk?.properties.some(
      (property) => property.name === "ohrisk:fingerprint" && property.value.includes("agpl-child@0.1.0")
    )).toBe(true);

    const projectDependencies = payload.dependencies.find((dependency) => dependency.ref === "project");
    expect([...(projectDependencies?.dependsOn ?? [])].sort()).toEqual([
      "pkg:npm/dual-license@2.0.0",
      "pkg:npm/gpl-package@5.0.0",
      "pkg:npm/missing-license@4.0.0",
      "pkg:npm/permissive-parent@1.0.0"
    ]);
    expect(payload.dependencies).toContainEqual({
      ref: "pkg:npm/permissive-parent@1.0.0",
      dependsOn: ["pkg:npm/agpl-child@0.1.0"]
    });
  });

  test("scans CycloneDX JSON SBOM input with embedded license evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-input-"));

    try {
      writeFileSync(
        path.join(projectRoot, "cyclonedx.json"),
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          metadata: {
            component: {
              name: "fixture-cyclonedx-input",
              "bom-ref": "root-app"
            }
          },
          components: [
            {
              type: "library",
              "bom-ref": "pkg:npm/permissive-parent@1.0.0",
              purl: "pkg:npm/permissive-parent@1.0.0",
              licenses: [{ license: { id: "MIT" } }]
            },
            {
              type: "library",
              "bom-ref": "agpl-child",
              purl: "pkg:pypi/agpl-child@2.0.0",
              licenses: [{ expression: "AGPL-3.0-only" }]
            },
            {
              type: "library",
              "bom-ref": "dev-risk",
              purl: "pkg:maven/org.example/dev-risk@3.0.0",
              scope: "excluded",
              licenses: [{ license: { id: "GPL-3.0-only" } }]
            }
          ],
          dependencies: [
            {
              ref: "root-app",
              dependsOn: ["pkg:npm/permissive-parent@1.0.0", "dev-risk"]
            },
            {
              ref: "pkg:npm/permissive-parent@1.0.0",
              dependsOn: ["agpl-child"]
            }
          ]
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "cyclonedx.json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: cyclonedx.json (cyclonedx-json)");
      expect(output).toContain("Dependencies: 2 total, 1 direct, 1 transitive");
      expect(output).toContain("- [high] agpl-child@2.0.0");
      expect(output).toContain("source: sbom; CycloneDX license: AGPL-3.0-only");
      expect(output).not.toContain("dev-risk@3.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports CycloneDX JSON embedded license evidence in JSON output", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-json-output-"));

    try {
      writeFileSync(
        path.join(projectRoot, "licenses.cdx.json"),
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          metadata: {
            component: {
              name: "fixture-cyclonedx-json-output",
              "bom-ref": "root-app"
            }
          },
          components: [
            {
              type: "library",
              "bom-ref": "agpl-child",
              purl: "pkg:cargo/agpl-child@2.0.0",
              licenses: [{ expression: "AGPL-3.0-only" }]
            }
          ],
          dependencies: [
            {
              ref: "root-app",
              dependsOn: ["agpl-child"]
            }
          ]
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "licenses.cdx.json", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        lockfile: { kind: string; path: string };
        evidence: { packages: number };
        licenses: { highConfidence: number };
        risks: { high: number };
        findings: Array<{ packageId: string; severity: string; evidence: string[] }>;
      };
      expect(payload.lockfile.kind).toBe("cyclonedx-json");
      expect(path.basename(payload.lockfile.path)).toBe("licenses.cdx.json");
      expect(payload.evidence.packages).toBe(1);
      expect(payload.licenses.highConfidence).toBe(1);
      expect(payload.risks.high).toBe(1);
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "agpl-child@2.0.0",
          severity: "high",
          evidence: expect.arrayContaining([
            "source: sbom",
            "CycloneDX license: AGPL-3.0-only"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports CycloneDX absent-license markers as unknown risk", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-noassertion-"));

    try {
      writeFileSync(
        path.join(projectRoot, "cyclonedx.json"),
        JSON.stringify({
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          metadata: {
            component: {
              name: "fixture-cyclonedx-noassertion",
              "bom-ref": "root-app"
            }
          },
          components: [
            {
              type: "library",
              "bom-ref": "noassertion-child",
              purl: "pkg:npm/noassertion-child@1.0.0",
              licenses: [{ expression: "NOASSERTION" }]
            }
          ],
          dependencies: [
            {
              ref: "root-app",
              dependsOn: ["noassertion-child"]
            }
          ]
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "cyclonedx.json", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        licenses: { missing: number; highConfidence: number };
        risks: { high: number; unknown: number };
        findings: Array<{
          packageId: string;
          severity: string;
          recommendation: string;
          evidence: string[];
        }>;
      };
      expect(payload.licenses).toMatchObject({
        missing: 1,
        highConfidence: 0
      });
      expect(payload.risks).toMatchObject({
        high: 0,
        unknown: 1
      });
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "noassertion-child@1.0.0",
          severity: "unknown",
          recommendation: "collect-evidence",
          evidence: expect.arrayContaining([
            "license: missing",
            "CycloneDX license: NOASSERTION",
            "signals: missing"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("scans CycloneDX XML SBOM input with embedded license evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-xml-input-"));

    try {
      writeFileSync(
        path.join(projectRoot, "cyclonedx.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml-input</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="pkg:npm/permissive-parent@1.0.0">
      <purl>pkg:npm/permissive-parent@1.0.0</purl>
      <licenses>
        <license>
          <id>MIT</id>
        </license>
      </licenses>
    </component>
    <component type="library" bom-ref="agpl-child">
      <purl>pkg:pypi/agpl-child@2.0.0</purl>
      <licenses>
        <expression>AGPL-3.0-only</expression>
      </licenses>
    </component>
    <component type="library" bom-ref="dev-risk">
      <purl>pkg:maven/org.example/dev-risk@3.0.0</purl>
      <scope>excluded</scope>
      <licenses>
        <license>
          <id>GPL-3.0-only</id>
        </license>
      </licenses>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="pkg:npm/permissive-parent@1.0.0" />
      <dependency ref="dev-risk" />
    </dependency>
    <dependency ref="pkg:npm/permissive-parent@1.0.0">
      <dependency ref="agpl-child" />
    </dependency>
  </dependencies>
</bom>`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "cyclonedx.xml", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: cyclonedx.xml (cyclonedx-xml)");
      expect(output).toContain("Dependencies: 2 total, 1 direct, 1 transitive");
      expect(output).toContain("- [high] agpl-child@2.0.0");
      expect(output).toContain("source: sbom; CycloneDX license: AGPL-3.0-only");
      expect(output).not.toContain("dev-risk@3.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports CycloneDX XML absent-license markers as unknown risk", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-xml-noassertion-"));

    try {
      writeFileSync(
        path.join(projectRoot, "cyclonedx.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>
<bom xmlns="http://cyclonedx.org/schema/bom/1.5" version="1">
  <metadata>
    <component type="application" bom-ref="root-app">
      <name>fixture-cyclonedx-xml-noassertion</name>
    </component>
  </metadata>
  <components>
    <component type="library" bom-ref="noassertion-xml-child">
      <purl>pkg:npm/noassertion-xml-child@1.0.0</purl>
      <licenses>
        <expression>NOASSERTION</expression>
      </licenses>
    </component>
  </components>
  <dependencies>
    <dependency ref="root-app">
      <dependency ref="noassertion-xml-child" />
    </dependency>
  </dependencies>
</bom>`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "cyclonedx.xml", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        lockfile: { kind: string };
        licenses: { missing: number; highConfidence: number };
        risks: { high: number; unknown: number };
        findings: Array<{
          packageId: string;
          severity: string;
          recommendation: string;
          evidence: string[];
        }>;
      };
      expect(payload.lockfile.kind).toBe("cyclonedx-xml");
      expect(payload.licenses).toMatchObject({
        missing: 1,
        highConfidence: 0
      });
      expect(payload.risks).toMatchObject({
        high: 0,
        unknown: 1
      });
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "noassertion-xml-child@1.0.0",
          severity: "unknown",
          recommendation: "collect-evidence",
          evidence: expect.arrayContaining([
            "license: missing",
            "CycloneDX license: NOASSERTION",
            "signals: missing"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("scans SPDX JSON SBOM input with embedded license evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-input-"));

    try {
      writeFileSync(
        path.join(projectRoot, "spdx.json"),
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          name: "fixture-spdx-input",
          documentDescribes: ["SPDXRef-Package-parent"],
          packages: [
            {
              SPDXID: "SPDXRef-Package-parent",
              name: "permissive-parent",
              licenseConcluded: "MIT",
              externalRefs: [
                {
                  referenceCategory: "PACKAGE-MANAGER",
                  referenceType: "purl",
                  referenceLocator: "pkg:npm/permissive-parent@1.0.0"
                }
              ]
            },
            {
              SPDXID: "SPDXRef-Package-child",
              name: "agpl-child",
              licenseDeclared: "AGPL-3.0-only",
              externalRefs: [
                {
                  referenceCategory: "PACKAGE-MANAGER",
                  referenceType: "purl",
                  referenceLocator: "pkg:cargo/agpl-child@2.0.0"
                }
              ]
            }
          ],
          relationships: [
            {
              spdxElementId: "SPDXRef-Package-parent",
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: "SPDXRef-Package-child"
            }
          ]
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "spdx.json"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: spdx.json (spdx-json)");
      expect(output).toContain("Dependencies: 2 total, 1 direct, 1 transitive");
      expect(output).toContain("- [high] agpl-child@2.0.0");
      expect(output).toContain("source: sbom; SPDX license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports SPDX JSON absent-license markers as unknown risk", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-noassertion-"));

    try {
      writeFileSync(
        path.join(projectRoot, "spdx.json"),
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          name: "fixture-spdx-noassertion",
          documentDescribes: ["SPDXRef-Package-noassertion"],
          packages: [
            {
              SPDXID: "SPDXRef-Package-noassertion",
              name: "noassertion-spdx-child",
              licenseDeclared: "NOASSERTION",
              externalRefs: [
                {
                  referenceCategory: "PACKAGE-MANAGER",
                  referenceType: "purl",
                  referenceLocator: "pkg:npm/noassertion-spdx-child@1.0.0"
                }
              ]
            }
          ]
        }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "spdx.json", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        lockfile: { kind: string };
        licenses: { missing: number; highConfidence: number };
        risks: { high: number; unknown: number };
        findings: Array<{
          packageId: string;
          severity: string;
          recommendation: string;
          evidence: string[];
        }>;
      };
      expect(payload.lockfile.kind).toBe("spdx-json");
      expect(payload.licenses).toMatchObject({
        missing: 1,
        highConfidence: 0
      });
      expect(payload.risks).toMatchObject({
        high: 0,
        unknown: 1
      });
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "noassertion-spdx-child@1.0.0",
          severity: "unknown",
          recommendation: "collect-evidence",
          evidence: expect.arrayContaining([
            "license: missing",
            "warning: SPDX package did not declare usable license evidence.",
            "signals: missing"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("scans SPDX RDF SBOM input with embedded license evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-rdf-input-"));

    try {
      writeFileSync(
        path.join(projectRoot, "spdx.rdf"),
        `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="">
    <spdx:name>fixture-spdx-rdf-input</spdx:name>
    <spdx:describesPackage rdf:resource="#SPDXRef-Package-parent" />
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-parent">
    <spdx:name>permissive-parent</spdx:name>
    <spdx:versionInfo>1.0.0</spdx:versionInfo>
    <spdx:licenseConcluded rdf:resource="http://spdx.org/licenses/MIT" />
    <spdx:externalRef>
      <spdx:ExternalRef>
        <spdx:referenceCategory rdf:resource="http://spdx.org/rdf/references/ReferenceCategoryPackageManager" />
        <spdx:referenceType rdf:resource="http://spdx.org/rdf/references/purl" />
        <spdx:referenceLocator>pkg:npm/permissive-parent@1.0.0</spdx:referenceLocator>
      </spdx:ExternalRef>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Package rdf:about="#SPDXRef-Package-child">
    <spdx:name>agpl-child</spdx:name>
    <spdx:versionInfo>2.0.0</spdx:versionInfo>
    <spdx:licenseDeclared rdf:resource="http://spdx.org/licenses/AGPL-3.0-only" />
    <spdx:externalRef>
      <spdx:ExternalRef>
        <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
        <spdx:referenceType>purl</spdx:referenceType>
        <spdx:referenceLocator>pkg:cargo/agpl-child@2.0.0</spdx:referenceLocator>
      </spdx:ExternalRef>
    </spdx:externalRef>
  </spdx:Package>
  <spdx:Relationship>
    <spdx:spdxElement rdf:resource="#SPDXRef-Package-parent" />
    <spdx:relationshipType rdf:resource="http://spdx.org/rdf/terms#relationshipType_dependsOn" />
    <spdx:relatedSpdxElement rdf:resource="#SPDXRef-Package-child" />
  </spdx:Relationship>
</rdf:RDF>`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "spdx.rdf"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: spdx.rdf (spdx-rdf)");
      expect(output).toContain("Dependencies: 2 total, 1 direct, 1 transitive");
      expect(output).toContain("- [high] agpl-child@2.0.0");
      expect(output).toContain("source: sbom; SPDX license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports SPDX RDF absent-license markers as unknown risk", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-rdf-noassertion-"));

    try {
      writeFileSync(
        path.join(projectRoot, "spdx.rdf"),
        `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:spdx="http://spdx.org/rdf/terms#">
  <spdx:SpdxDocument rdf:about="">
    <spdx:name>fixture-spdx-rdf-noassertion</spdx:name>
    <spdx:describesPackage rdf:resource="#SPDXRef-Package-noassertion" />
  </spdx:SpdxDocument>
  <spdx:Package rdf:about="#SPDXRef-Package-noassertion">
    <spdx:name>noassertion-spdx-rdf-child</spdx:name>
    <spdx:versionInfo>1.0.0</spdx:versionInfo>
    <spdx:licenseDeclared>NOASSERTION</spdx:licenseDeclared>
    <spdx:externalRef>
      <spdx:ExternalRef>
        <spdx:referenceCategory>PACKAGE-MANAGER</spdx:referenceCategory>
        <spdx:referenceType>purl</spdx:referenceType>
        <spdx:referenceLocator>pkg:npm/noassertion-spdx-rdf-child@1.0.0</spdx:referenceLocator>
      </spdx:ExternalRef>
    </spdx:externalRef>
  </spdx:Package>
</rdf:RDF>`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "spdx.rdf", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        lockfile: { kind: string };
        licenses: { missing: number; highConfidence: number };
        risks: { high: number; unknown: number };
        findings: Array<{
          packageId: string;
          severity: string;
          recommendation: string;
          evidence: string[];
        }>;
      };
      expect(payload.lockfile.kind).toBe("spdx-rdf");
      expect(payload.licenses).toMatchObject({
        missing: 1,
        highConfidence: 0
      });
      expect(payload.risks).toMatchObject({
        high: 0,
        unknown: 1
      });
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "noassertion-spdx-rdf-child@1.0.0",
          severity: "unknown",
          recommendation: "collect-evidence",
          evidence: expect.arrayContaining([
            "license: missing",
            "warning: SPDX package did not declare usable license evidence.",
            "signals: missing"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("scans SPDX tag-value SBOM input with embedded license evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-tag-value-input-"));

    try {
      writeFileSync(
        path.join(projectRoot, "sbom.spdx"),
        `
SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0
SPDXID: SPDXRef-DOCUMENT
DocumentName: fixture-spdx-tag-value-input
DocumentNamespace: https://example.test/spdx/fixture
DocumentDescribes: SPDXRef-Package-parent

PackageName: permissive-parent
SPDXID: SPDXRef-Package-parent
PackageVersion: 1.0.0
PackageLicenseConcluded: MIT
ExternalRef: PACKAGE-MANAGER purl pkg:npm/permissive-parent@1.0.0

PackageName: agpl-child
SPDXID: SPDXRef-Package-child
PackageVersion: 2.0.0
PackageLicenseDeclared: AGPL-3.0-only
ExternalRef: PACKAGE-MANAGER purl pkg:cargo/agpl-child@2.0.0

Relationship: SPDXRef-Package-parent DEPENDS_ON SPDXRef-Package-child
`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "sbom.spdx"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Lockfile: sbom.spdx (spdx-tag-value)");
      expect(output).toContain("Dependencies: 2 total, 1 direct, 1 transitive");
      expect(output).toContain("- [high] agpl-child@2.0.0");
      expect(output).toContain("source: sbom; SPDX license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports SPDX tag-value absent-license markers as unknown risk", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-tag-value-noassertion-"));

    try {
      writeFileSync(
        path.join(projectRoot, "sbom.spdx"),
        `
SPDXVersion: SPDX-2.3
SPDXID: SPDXRef-DOCUMENT
DocumentName: fixture-spdx-tag-value-noassertion
DocumentDescribes: SPDXRef-Package-noassertion

PackageName: noassertion-spdx-tag-value-child
SPDXID: SPDXRef-Package-noassertion
PackageVersion: 1.0.0
PackageLicenseDeclared: NOASSERTION
ExternalRef: PACKAGE-MANAGER purl pkg:npm/noassertion-spdx-tag-value-child@1.0.0
`,
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--lockfile", "sbom.spdx", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        lockfile: { kind: string };
        licenses: { missing: number; highConfidence: number };
        risks: { high: number; unknown: number };
        findings: Array<{
          packageId: string;
          severity: string;
          recommendation: string;
          evidence: string[];
        }>;
      };
      expect(payload.lockfile.kind).toBe("spdx-tag-value");
      expect(payload.licenses).toMatchObject({
        missing: 1,
        highConfidence: 0
      });
      expect(payload.risks).toMatchObject({
        high: 0,
        unknown: 1
      });
      expect(payload.findings).toEqual([
        expect.objectContaining({
          packageId: "noassertion-spdx-tag-value-child@1.0.0",
          severity: "unknown",
          recommendation: "collect-evidence",
          evidence: expect.arrayContaining([
            "license: missing",
            "warning: SPDX package did not declare usable license evidence.",
            "signals: missing"
          ])
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints Markdown scan output", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--markdown", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("# Ohrisk scan");
    expect(output).toContain("- Project: `fixture-bun-project`");
    expect(output).not.toContain(fixturesDir);
    expect(output).toContain("- Profile: `saas`");
    expect(output).toContain("- Production only: `yes`");
    expect(output).toContain("- Waiver mode: `local (.ohrisk-waivers.json)`");
    expect(output).toContain(
      "- Licenses: `4 high-confidence`, `0 medium-confidence`, `1 low-confidence`"
    );
    expect(output).toContain("- License issues: `1 missing`, `0 malformed`");
    expect(output).toContain(
      "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |"
    );
    expect(output).toContain(
      "| `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0` | `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas."
    );
    expect(output).toContain("## Next");
    expect(output).toContain("Replace or escalate high-risk dependencies before shipping.");
  });

  test("returns non-zero from ci when findings meet the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain(
      "Threshold: failed on high (2 findings at or above threshold)"
    );
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
  });

  test("prints JSON ci threshold outcome", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["ci", "--json", "--fail-on", "high"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      failOn: string;
      failed: boolean;
      failingFindingCount: number;
    };

    expect(payload.failOn).toBe("high");
    expect(payload.failed).toBe(true);
    expect(payload.failingFindingCount).toBe(2);
  });

  test("excludes waived findings from CI threshold failures while reporting them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-waived-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for this release candidate."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
          review: number;
          unknown: number;
          low: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        failed: boolean;
        failingFindingCount: number;
        findings: Array<{
          packageId: string;
        }>;
        waivedFindings: Array<{
          finding: {
            packageId: string;
            severity: string;
          };
          waiver: {
            reason: string;
          };
          matchedBy: string;
        }>;
      };

      expect(payload.risks.high).toBe(0);
      expect(payload.waivers).toEqual({
        applied: 1,
        expired: 0,
        unmatched: 0
      });
      expect(payload.failed).toBe(false);
      expect(payload.failingFindingCount).toBe(0);
      expect(payload.findings.map((finding) => finding.packageId)).not.toContain("agpl-child@0.1.0");
      expect(payload.waivedFindings).toHaveLength(1);
      expect(payload.waivedFindings[0]).toMatchObject({
        finding: {
          packageId: "agpl-child@0.1.0",
          severity: "high"
        },
        waiver: {
          reason: "Accepted fixture risk for this release candidate."
        },
        matchedBy: "id"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns invalid input for malformed waiver files", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bad-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(path.join(projectRoot, ".ohrisk-waivers.json"), "{", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("\n")).toContain("WAIVER_FILE_PARSE_FAILED");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores local waivers when waiver application is disabled", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-no-waivers-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for this release candidate."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high", "--no-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        failed: boolean;
        failingFindingCount: number;
        findings: Array<{
          packageId: string;
          severity: string;
        }>;
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: unknown[];
      };

      expect(payload.risks.high).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 0
      });
      expect(payload.waiverMode).toBe("ignored");
      expect(payload.failed).toBe(true);
      expect(payload.failingFindingCount).toBe(1);
      expect(payload.findings).toContainEqual(
        expect.objectContaining({
          packageId: "agpl-child@0.1.0",
          severity: "high"
        })
      );
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not read malformed waiver files when waiver application is disabled", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-no-waiver-read-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(path.join(projectRoot, ".ohrisk-waivers.json"), "{", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--json", "--prod", "--no-waivers"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: unknown[];
      };

      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 0
      });
      expect(payload.waiverMode).toBe("ignored");
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports expired waivers without applying them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-expired-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Temporary acceptance expired.",
                expiresOn: "2000-01-01"
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        failed: boolean;
        failingFindingCount: number;
        waivedFindings: unknown[];
        expiredWaivers: Array<{
          id: string;
          reason: string;
          expiresOn: string;
        }>;
      };

      expect(payload.risks.high).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 1,
        unmatched: 0
      });
      expect(payload.failed).toBe(true);
      expect(payload.failingFindingCount).toBe(1);
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([
        {
          id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
          reason: "Temporary acceptance expired.",
          expiresOn: "2000-01-01"
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports unmatched active waivers without applying them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-unmatched-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: Array<{
          id: string;
          reason: string;
        }>;
      };

      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 1
      });
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([
        {
          id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
          reason: "Leftover waiver from a removed dependency."
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails CI strict waiver checks when an active waiver no longer matches a finding", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-strict-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--strict-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        failed: boolean;
        failingFindingCount: number;
        strictWaivers: boolean;
        waiverDriftFailed: boolean;
        waiverDriftCount: number;
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
      };

      expect(payload.failed).toBe(false);
      expect(payload.failingFindingCount).toBe(0);
      expect(payload.strictWaivers).toBe(true);
      expect(payload.waiverDriftFailed).toBe(true);
      expect(payload.waiverDriftCount).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 1
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints passed strict waiver status when CI has no waiver drift", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "permissive-project"));
    const exitCode = await main(["ci", "--prod", "--strict-waivers"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Waiver drift: passed (0 expired or unmatched waivers)");
  });

  test("prints SARIF strict waiver drift properties", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-sarif-strict-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--sarif", "--prod", "--strict-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        runs: Array<{
          properties: {
            ohriskStrictWaivers: boolean;
            ohriskWaiverDriftFailed: boolean;
            ohriskWaiverDriftCount: number;
          };
        }>;
      };

      expect(payload.runs[0]?.properties).toMatchObject({
        ohriskStrictWaivers: true,
        ohriskWaiverDriftFailed: true,
        ohriskWaiverDriftCount: 1
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("writes ci output before returning a failing threshold exit code", async () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-ci-output-"));

    try {
      const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
      const outputPath = path.join(outputRoot, "ci.md");

      const exitCode = await main(
        ["ci", "--markdown", "--fail-on", "high", "--output", outputPath],
        io
      );

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
      expect(readFileSync(outputPath, "utf8")).toContain("# Ohrisk scan");
      expect(readFileSync(outputPath, "utf8")).toContain(
        "- Threshold: failed on high (2 findings at or above threshold)"
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("returns zero from ci when findings stay below the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "permissive-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 0 high, 0 review, 0 unknown, 2 low");
    expect(stdout.join("\n")).toContain("- [low] alias-package@2.0.0");
    expect(stdout.join("\n")).toContain("evidence: license: Apache License, Version 2.0");
    expect(stdout.join("\n")).toContain(
      "Threshold: passed on high (0 findings at or above threshold)"
    );
    expect(stdout.join("\n")).toContain("Next: No action needed for this profile.");
  });

  test("diff reports baseline read failures before collecting current package evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-diff-baseline-first-"));

    try {
      writeFileSync(
        path.join(projectRoot, "package-lock.json"),
        JSON.stringify(
          {
            name: "fixture-diff-baseline-first",
            version: "0.0.0",
            lockfileVersion: 3,
            packages: {
              "": {
                name: "fixture-diff-baseline-first",
                version: "0.0.0",
                dependencies: {
                  "blocked-artifact": "1.0.0"
                }
              },
              "node_modules/blocked-artifact": {
                version: "1.0.0",
                resolved: "http://127.0.0.1/blocked-artifact-1.0.0.tgz"
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      let baselineReads = 0;
      io.readRefFile = () => {
        baselineReads += 1;
        return err(createError({
          code: "GIT_REF_READ_FAILED",
          category: "unsupported_input",
          message: "Failed to read the baseline file from the requested git ref.",
          details: {
            ref: "missing-baseline",
            relativePath: "package-lock.json",
            cause: "fixture baseline unavailable"
          }
        }));
      };

      const exitCode = await main(["diff", "missing-baseline"], io);

      expect(exitCode).toBe(2);
      expect(baselineReads).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toHaveLength(1);
      expect(stderr[0]).toContain("GIT_REF_READ_FAILED");
      expect(stderr[0]).toContain("fixture baseline unavailable");
      expect(stderr[0]).not.toContain("TARBALL_FETCH_FAILED");
      expect(stderr[0]).not.toContain("127.0.0.1");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints only new or changed findings for a git ref diff", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk diff");
    expect(output).toContain("Baseline: main");
    expect(output).toContain("Production only: yes");
    expect(output).toContain("Findings: 5 current, 3 baseline, 2 new or changed");
    expect(output).toContain("New or changed risks: 0 high, 1 review, 1 unknown, 0 low");
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("fingerprint: missing-license@4.0.0");
    expect(output).toContain("dependency: production direct");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] agpl-child@0.1.0");
  });

  test("diff reads the baseline for an explicit lockfile path", async () => {
    const baselineLockfile = readFileSync(
      path.join(fixturesDir, "multiple-lockfiles", "package-lock.json"),
      "utf8"
    );
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "multiple-lockfiles"));
    io.readRefFile = ({ relativePath }) => {
      expect(relativePath).toBe("package-lock.json");
      return { ok: true as const, value: baselineLockfile };
    };

    const exitCode = await main(["diff", "main", "--lockfile", "package-lock.json", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      currentFindingCount: number;
      baselineFindingCount: number;
      newFindingCount: number;
    };
    expect(payload.currentFindingCount).toBe(0);
    expect(payload.baselineFindingCount).toBe(0);
    expect(payload.newFindingCount).toBe(0);
  });

  test("diff reads baseline Gradle dependency-locks directory files", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-locks-diff-"));
    const lockDir = path.join(projectRoot, "gradle", "dependency-locks");
    const riskPomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "risk",
      "1.0.0"
    );
    const newRiskPomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "com",
      "acme",
      "new-risk",
      "2.0.0"
    );
    const runtimeLockfile = "com.acme:risk:1.0.0=runtimeClasspath\n";
    const compileLockfile = "com.acme:new-risk:2.0.0=compileClasspath\n";

    try {
      mkdirSync(lockDir, { recursive: true });
      mkdirSync(riskPomDir, { recursive: true });
      mkdirSync(newRiskPomDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(path.join(lockDir, "compileClasspath.lockfile"), compileLockfile, "utf8");
      writeFileSync(path.join(lockDir, "runtimeClasspath.lockfile"), runtimeLockfile, "utf8");
      writeFileSync(
        path.join(riskPomDir, "risk-1.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(newRiskPomDir, "new-risk-2.0.0.pom"),
        [
          "<project>",
          "  <licenses>",
          "    <license>",
          "      <name>AGPL-3.0-only</name>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === path.join("gradle", "dependency-locks", "compileClasspath.lockfile")) {
          return err(createError({
            code: "GIT_REF_FILE_NOT_FOUND",
            category: "invalid_input",
            message: "The requested baseline file does not exist in the git ref.",
            details: {
              ref: "main",
              relativePath
            }
          }));
        }

        if (relativePath === path.join("gradle", "dependency-locks", "runtimeClasspath.lockfile")) {
          return { ok: true as const, value: runtimeLockfile };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual([
        path.join("gradle", "dependency-locks", "compileClasspath.lockfile"),
        path.join("gradle", "dependency-locks", "runtimeClasspath.lockfile")
      ]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(2);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline pnpm catalog definitions from pnpm-workspace.yaml", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pnpm-catalog-diff-"));
    const lockfile = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      catalog-prod:",
      "        specifier: \"catalog:\"",
      "        version: \"catalog:\"",
      "packages:",
      "  /catalog-prod@1.0.0: {}",
      "snapshots:",
      "  /catalog-prod@1.0.0: {}"
    ].join("\n");
    const workspace = [
      "catalog:",
      "  catalog-prod: 1.0.0"
    ].join("\n");

    try {
      writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "catalog-diff" }));
      writeFileSync(path.join(projectRoot, "pnpm-lock.yaml"), lockfile, "utf8");
      writeFileSync(path.join(projectRoot, "pnpm-workspace.yaml"), workspace, "utf8");
      writeLocalPackage(
        projectRoot,
        "catalog-prod",
        "1.0.0",
        "MIT",
        "LICENSE",
        "MIT License"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        if (relativePath === "pnpm-lock.yaml") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "pnpm-workspace.yaml") {
          return { ok: true as const, value: workspace };
        }

        return err(createError({
          code: "GIT_REF_FILE_NOT_FOUND",
          category: "invalid_input",
          message: "Missing fixture baseline file.",
          details: {
            relativePath
          }
        }));
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline pyproject.toml for Poetry root dependency classification", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-poetry-diff-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );
    const pyproject = [
      "[tool.poetry]",
      "name = \"fixture-poetry-diff\"",
      "version = \"0.1.0\"",
      "",
      "[tool.poetry.dependencies]",
      "python = \"^3.12\"",
      "risk-pkg = \"^1.0.0\""
    ].join("\n");
    const lockfile = [
      "[[package]]",
      "name = \"risk-pkg\"",
      "version = \"1.0.0\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"main\"]"
    ].join("\n");

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "pyproject.toml"), pyproject, "utf8");
      writeFileSync(path.join(projectRoot, "poetry.lock"), lockfile, "utf8");
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "poetry.lock") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "pyproject.toml") {
          return { ok: true as const, value: pyproject };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["poetry.lock", "pyproject.toml"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline pyproject.toml for PDM root dependency classification", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pdm-diff-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );
    const pyproject = [
      "[project]",
      "name = \"fixture-pdm-diff\"",
      "version = \"0.1.0\"",
      "dependencies = [\"risk-pkg>=1.0.0\"]"
    ].join("\n");
    const lockfile = [
      "[[package]]",
      "name = \"risk-pkg\"",
      "version = \"1.0.0\"",
      "groups = [\"default\"]"
    ].join("\n");

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "pyproject.toml"), pyproject, "utf8");
      writeFileSync(path.join(projectRoot, "pdm.lock"), lockfile, "utf8");
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "pdm.lock") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "pyproject.toml") {
          return { ok: true as const, value: pyproject };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["pdm.lock", "pyproject.toml"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline Pipfile.lock local source metadata", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pipfile-local-source-diff-"));
    const localSourceDir = path.join(projectRoot, "local-risk");
    const lockfile = JSON.stringify({
      default: {
        "local-risk": {
          editable: true,
          path: "./local-risk"
        }
      }
    });
    const pyproject = [
      "[project]",
      "name = \"local-risk\"",
      "version = \"1.0.0\"",
      "license = \"AGPL-3.0-only\""
    ].join("\n");
    const license = "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n";

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "Pipfile.lock"), lockfile, "utf8");
      writeFileSync(path.join(localSourceDir, "pyproject.toml"), pyproject, "utf8");
      writeFileSync(path.join(localSourceDir, "LICENSE"), license, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "Pipfile.lock") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "local-risk/pyproject.toml") {
          return { ok: true as const, value: pyproject };
        }

        if (relativePath === "local-risk/LICENSE") {
          return { ok: true as const, value: license };
        }

        return err(
          createError({
            code: "GIT_REF_FILE_NOT_FOUND",
            category: "invalid_input",
            message: "The requested baseline file does not exist in the git ref.",
            details: {
              relativePath
            }
          })
        );
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toContain("Pipfile.lock");
      expect(requestedBaselinePaths).toContain("local-risk/pyproject.toml");
      expect(requestedBaselinePaths).toContain("local-risk/LICENSE");

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline PDM local source metadata", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pdm-local-source-diff-"));
    const localSourceDir = path.join(projectRoot, "local-risk");
    const pyproject = [
      "[project]",
      "name = \"fixture-pdm-local-diff\"",
      "version = \"0.1.0\"",
      "dependencies = [\"local-risk @ file:./local-risk\"]"
    ].join("\n");
    const lockfile = [
      "[[package]]",
      "name = \"local-risk\"",
      "groups = [\"default\"]",
      "path = \"./local-risk\""
    ].join("\n");
    const localPyproject = [
      "[project]",
      "name = \"local-risk\"",
      "version = \"1.0.0\"",
      "license = \"AGPL-3.0-only\""
    ].join("\n");
    const license = "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n";

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "pyproject.toml"), pyproject, "utf8");
      writeFileSync(path.join(projectRoot, "pdm.lock"), lockfile, "utf8");
      writeFileSync(path.join(localSourceDir, "pyproject.toml"), localPyproject, "utf8");
      writeFileSync(path.join(localSourceDir, "LICENSE"), license, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "pdm.lock") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "pyproject.toml") {
          return { ok: true as const, value: pyproject };
        }

        if (relativePath === "local-risk/pyproject.toml") {
          return { ok: true as const, value: localPyproject };
        }

        if (relativePath === "local-risk/LICENSE") {
          return { ok: true as const, value: license };
        }

        return err(
          createError({
            code: "GIT_REF_FILE_NOT_FOUND",
            category: "invalid_input",
            message: "The requested baseline file does not exist in the git ref.",
            details: {
              relativePath
            }
          })
        );
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toContain("pdm.lock");
      expect(requestedBaselinePaths).toContain("pyproject.toml");
      expect(requestedBaselinePaths).toContain("local-risk/pyproject.toml");
      expect(requestedBaselinePaths).toContain("local-risk/LICENSE");

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline nested requirements and constraints files", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-diff-"));
    const distInfoDir = path.join(
      projectRoot,
      ".venv",
      "Lib",
      "site-packages",
      "risk_pkg-1.0.0.dist-info"
    );
    const requirements = [
      "-c constraints.txt",
      "-r base.txt"
    ].join("\n");
    const constraints = "risk-pkg==1.0.0\n";
    const base = "risk-pkg>=1\n";

    try {
      mkdirSync(distInfoDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "requirements.txt"), requirements, "utf8");
      writeFileSync(path.join(projectRoot, "constraints.txt"), constraints, "utf8");
      writeFileSync(path.join(projectRoot, "base.txt"), base, "utf8");
      writeFileSync(
        path.join(distInfoDir, "METADATA"),
        [
          "Metadata-Version: 2.4",
          "Name: risk-pkg",
          "Version: 1.0.0",
          "License-Expression: AGPL-3.0-only",
          ""
        ].join("\n"),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "requirements.txt") {
          return { ok: true as const, value: requirements };
        }

        if (relativePath === "constraints.txt") {
          return { ok: true as const, value: constraints };
        }

        if (relativePath === "base.txt") {
          return { ok: true as const, value: base };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual([
        "requirements.txt",
        "constraints.txt",
        "base.txt"
      ]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline editable requirements local source metadata", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-editable-diff-"));
    const localSourceDir = path.join(projectRoot, "local-risk");
    const requirements = "-e ./local-risk\n";
    const pyproject = [
      "[project]",
      "name = \"local-risk\"",
      "version = \"1.0.0\"",
      "license = \"AGPL-3.0-only\""
    ].join("\n");
    const license = "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n";

    try {
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "requirements.txt"), requirements, "utf8");
      writeFileSync(path.join(localSourceDir, "pyproject.toml"), pyproject, "utf8");
      writeFileSync(path.join(localSourceDir, "LICENSE"), license, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "requirements.txt") {
          return { ok: true as const, value: requirements };
        }

        if (relativePath === "local-risk/pyproject.toml") {
          return { ok: true as const, value: pyproject };
        }

        if (relativePath === "local-risk/LICENSE") {
          return { ok: true as const, value: license };
        }

        return err(
          createError({
            code: "GIT_REF_FILE_NOT_FOUND",
            category: "invalid_input",
            message: "The requested baseline file does not exist in the git ref.",
            details: {
              relativePath
            }
          })
        );
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toContain("requirements.txt");
      expect(requestedBaselinePaths).toContain("local-risk/pyproject.toml");
      expect(requestedBaselinePaths).toContain("local-risk/LICENSE");

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline Cargo workspace member manifests", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-diff-"));
    const memberRoot = path.join(projectRoot, "crates", "group-a", "plugins", "app");
    const manifest = [
      "[workspace]",
      "members = [\"crates/*/plugins/*\"]"
    ].join("\n");
    const memberManifest = [
      "[package]",
      "name = \"fixture-rust-diff-app\"",
      "version = \"0.1.0\"",
      "",
      "[dependencies]",
      "risk-crate = \"1\""
    ].join("\n");
    const lockfile = [
      "[[package]]",
      "name = \"risk-crate\"",
      "version = \"1.0.0\""
    ].join("\n");

    try {
      mkdirSync(memberRoot, { recursive: true });
      writeFileSync(path.join(projectRoot, "Cargo.toml"), manifest, "utf8");
      writeFileSync(path.join(memberRoot, "Cargo.toml"), memberManifest, "utf8");
      writeFileSync(path.join(projectRoot, "Cargo.lock"), lockfile, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "Cargo.lock") {
          return { ok: true as const, value: lockfile };
        }

        if (relativePath === "Cargo.toml") {
          return { ok: true as const, value: manifest };
        }

        if (relativePath === "crates/group-a/plugins/app/Cargo.toml") {
          return { ok: true as const, value: memberManifest };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual([
        "Cargo.lock",
        "Cargo.toml",
        "crates/group-a/plugins/app/Cargo.toml"
      ]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline go.sum for Go module versions", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-diff-"));
    const goMod = [
      "module example.com/fixture-go-diff",
      "",
      "go 1.22",
      "",
      "require github.com/acme/risk v1.0.0"
    ].join("\n");
    const goSum = [
      "github.com/acme/risk v1.0.0 h1:abc",
      "github.com/acme/transitive v0.2.0 h1:def"
    ].join("\n");

    try {
      writeFileSync(path.join(projectRoot, "go.mod"), goMod, "utf8");
      writeFileSync(path.join(projectRoot, "go.sum"), goSum, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "go.mod") {
          return { ok: true as const, value: goMod };
        }

        if (relativePath === "go.sum") {
          return { ok: true as const, value: goSum };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["go.mod", "go.sum"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(2);
      expect(payload.baselineFindingCount).toBe(2);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline go.work module go.mod and go.sum files", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-work-diff-"));
    const appDir = path.join(projectRoot, "app");
    const goWork = [
      "go 1.22",
      "",
      "use ./app"
    ].join("\n");
    const goMod = [
      "module example.com/app",
      "",
      "go 1.22",
      "",
      "require github.com/acme/risk v1.0.0"
    ].join("\n");
    const goSum = [
      "github.com/acme/risk v1.0.0 h1:abc",
      "github.com/acme/transitive v0.2.0 h1:def"
    ].join("\n");

    try {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "go.work"), goWork, "utf8");
      writeFileSync(path.join(appDir, "go.mod"), goMod, "utf8");
      writeFileSync(path.join(appDir, "go.sum"), goSum, "utf8");

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "go.work") {
          return { ok: true as const, value: goWork };
        }

        if (relativePath === "app/go.mod") {
          return { ok: true as const, value: goMod };
        }

        if (relativePath === "app/go.sum") {
          return { ok: true as const, value: goSum };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["go.work", "app/go.mod", "app/go.sum"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(2);
      expect(payload.baselineFindingCount).toBe(2);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline Directory.Packages.props for centrally managed .NET projects", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-central-dotnet-diff-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );
    const projectFile = [
      "<Project Sdk=\"Microsoft.NET.Sdk\">",
      "  <ItemGroup>",
      "    <PackageReference Include=\"Risk.Package\" />",
      "  </ItemGroup>",
      "</Project>"
    ].join("\n");
    const centralPackages = [
      "<Project>",
      "  <PropertyGroup>",
      "    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>",
      "  </PropertyGroup>",
      "  <ItemGroup>",
      "    <PackageVersion Include=\"Risk.Package\" Version=\"1.0.0\" />",
      "  </ItemGroup>",
      "</Project>"
    ].join("\n");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "Fixture.App.csproj"), projectFile, "utf8");
      writeFileSync(path.join(projectRoot, "Directory.Packages.props"), centralPackages, "utf8");
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "Fixture.App.csproj") {
          return { ok: true as const, value: projectFile };
        }

        if (relativePath === "Directory.Packages.props") {
          return { ok: true as const, value: centralPackages };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["Fixture.App.csproj", "Directory.Packages.props"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a .NET NuGet packages.lock.json project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-project-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "packages.lock.json"),
        JSON.stringify({
          version: 1,
          dependencies: {
            net8: {
              "Risk.Package": {
                type: "Direct",
                requested: "[1.0.0, )",
                resolved: "1.0.0"
              }
            }
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Lockfile: packages.lock.json (nuget-lock)");
      expect(output).toContain("- [high] Risk.Package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a restored .NET NuGet project.assets.json project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-assets-project-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(path.join(projectRoot, "obj"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "obj", "project.assets.json"),
        JSON.stringify({
          version: 3,
          targets: {
            net8: {
              "Risk.Package/1.0.0": {
                type: "package"
              }
            }
          },
          projectFileDependencyGroups: {
            net8: [
              "Risk.Package >= 1.0.0"
            ]
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("nuget-assets");
      expect(output).toContain("- [high] Risk.Package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a .NET csproj PackageReference project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-csproj-project-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Fixture.App.csproj"),
        [
          "<Project Sdk=\"Microsoft.NET.Sdk\">",
          "  <ItemGroup>",
          "    <PackageReference Include=\"Risk.Package\" Version=\"1.0.0\" />",
          "  </ItemGroup>",
          "</Project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Fixture.App.csproj (dotnet-project)");
      expect(output).toContain("- [high] Risk.Package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a centrally managed .NET PackageReference project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-central-csproj-project-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Directory.Packages.props"),
        [
          "<Project>",
          "  <PropertyGroup>",
          "    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>",
          "  </PropertyGroup>",
          "  <ItemGroup>",
          "    <PackageVersion Include=\"Risk.Package\" Version=\"1.0.0\" />",
          "  </ItemGroup>",
          "</Project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Fixture.App.csproj"),
        [
          "<Project Sdk=\"Microsoft.NET.Sdk\">",
          "  <ItemGroup>",
          "    <PackageReference Include=\"Risk.Package\" />",
          "  </ItemGroup>",
          "</Project>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Fixture.App.csproj (dotnet-project)");
      expect(output).toContain("- [high] Risk.Package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a .NET NuGet packages.config project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-packages-config-project-"));
    const packageDir = path.join(
      projectRoot,
      ".nuget",
      "packages",
      "risk.package",
      "1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "packages.config"),
        [
          "<packages>",
          "  <package id=\"Risk.Package\" version=\"1.0.0\" targetFramework=\"net48\" />",
          "</packages>"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Risk.Package.nuspec"),
        [
          "<package>",
          "  <metadata>",
          "    <license type=\"expression\">AGPL-3.0-only</license>",
          "  </metadata>",
          "</package>"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("packages.config (nuget-packages-config)");
      expect(output).toContain("- [high] Risk.Package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("nuspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Dart pubspec.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-pubspec-lock-project-"));
    const packageDir = path.join(
      projectRoot,
      ".pub-cache",
      "hosted",
      "pub.dev",
      "risk_package-1.0.0"
    );

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "pubspec.lock"),
        [
          "packages:",
          "  risk_package:",
          "    dependency: \"direct main\"",
          "    description:",
          "      name: risk_package",
          "      url: \"https://pub.dev\"",
          "    source: hosted",
          "    version: \"1.0.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "pubspec.yaml"),
        [
          "name: risk_package",
          "version: 1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "SPDX-License-Identifier: AGPL-3.0-only\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("pubspec.lock (pubspec-lock)");
      expect(output).toContain("- [high] risk_package@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Swift Package.resolved project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-swift-package-project-"));
    const packageDir = path.join(projectRoot, ".build", "checkouts", "risk-swift");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Package.resolved"),
        JSON.stringify({
          pins: [
            {
              identity: "risk-swift",
              kind: "remoteSourceControl",
              location: "https://github.com/acme/risk-swift.git",
              state: {
                revision: "0123456789abcdef",
                version: "1.0.0"
              }
            }
          ],
          version: 2
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "SPDX-License-Identifier: AGPL-3.0-only\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Package.resolved (swift-package-resolved)");
      expect(output).toContain("- [high] risk-swift@1.0.0");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Carthage Cartfile.resolved project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-carthage-project-"));
    const packageDir = path.join(projectRoot, "Carthage", "Checkouts", "RiskKit");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Cartfile.resolved"),
        'github "Acme/RiskKit" "1.2.3"',
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Cartfile.resolved (cartfile-resolved)");
      expect(output).toContain("- [high] Acme/RiskKit@1.2.3");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("file license match: AGPL-3.0-only from LICENSE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a CocoaPods Podfile.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cocoapods-project-"));
    const packageDir = path.join(projectRoot, "Pods", "RiskPod");
    const podspecDir = path.join(projectRoot, "Pods", "Local Podspecs");

    try {
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(podspecDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Podfile.lock"),
        [
          "PODS:",
          "  - RiskPod (1.0.0)",
          "",
          "DEPENDENCIES:",
          "  - RiskPod (~> 1.0)"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(podspecDir, "RiskPod.podspec.json"),
        JSON.stringify({
          name: "RiskPod",
          version: "1.0.0",
          license: {
            type: "AGPL-3.0-only"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "LICENSE"),
        "SPDX-License-Identifier: AGPL-3.0-only\n",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Podfile.lock (podfile-lock)");
      expect(output).toContain("- [high] RiskPod@1.0.0");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("podspec license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for an Elixir Mix mix.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-mix-lock-project-"));
    const packageDir = path.join(projectRoot, "deps", "risk_hex");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "mix.lock"),
        '%{"risk_hex": {:hex, :risk_hex, "1.0.0", "checksum", [:mix], [], "hexpm", "checksum"}}',
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "mix.exs"),
        [
          "defmodule RiskHex.MixProject do",
          "  use Mix.Project",
          "  def project do",
          "    [app: :risk_hex, version: \"1.0.0\", package: [licenses: [\"AGPL-3.0-only\"]]]",
          "  end",
          "end"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("mix.lock (mix-lock)");
      expect(output).toContain("- [high] risk_hex@1.0.0");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("mix.exs license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for an Erlang Rebar3 rebar.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-rebar-lock-project-"));
    const packageDir = path.join(projectRoot, "deps", "risk_hex");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "rebar.lock"),
        [
          '{"1.2.3",',
          "[",
          ' {<<"risk_hex">>,{pkg,<<"risk_hex">>,<<"1.0.0">>},0}',
          "]}."
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "rebar.config"),
        [
          "{erl_opts, [debug_info]}.",
          "{licenses, [\"AGPL-3.0-only\"]}."
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("rebar.lock (rebar-lock)");
      expect(output).toContain("- [high] risk_hex@1.0.0");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("rebar.config license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Conan conan.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-conan-lock-project-"));
    const packageDir = path.join(projectRoot, ".conan", "data", "risklib", "1.0.0", "_", "_", "export");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "conan.lock"),
        JSON.stringify({
          version: "0.5",
          requires: ["risklib/1.0.0#recipe-revision%1670000000"]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "conanfile.py"),
        [
          "from conan import ConanFile",
          "",
          "class RiskLibConan(ConanFile):",
          "    name = \"risklib\"",
          "    version = \"1.0.0\"",
          "    license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("conan.lock (conan-lock)");
      expect(output).toContain("- [high] risklib@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("conanfile.py license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Conda environment.yml project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-environment-project-"));
    const packageDir = path.join(projectRoot, ".conda", "pkgs", "risk-conda-1.0.0-py312_0");

    try {
      mkdirSync(path.join(packageDir, "info", "licenses"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "environment.yml"),
        [
          "name: fixture-conda-env",
          "channels:",
          "  - conda-forge",
          "dependencies:",
          "  - conda-forge::risk-conda=1.0.0=py312_0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "info", "index.json"),
        JSON.stringify({
          name: "risk-conda",
          version: "1.0.0",
          license: "AGPL-3.0-only"
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "info", "licenses", "LICENSE"),
        "GNU Affero General Public License version 3",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("environment.yml (conda-environment)");
      expect(output).toContain("- [high] conda:risk-conda@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("path: fixture-conda-env -> conda:risk-conda@1.0.0");
      expect(output).toContain("info/index.json license: AGPL-3.0-only");
      expect(output).toContain("file: info/licenses/LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Conda conda-lock.yml project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-lock-project-"));
    const packageDir = path.join(projectRoot, ".conda", "pkgs", "risk-conda-1.0.0-py312_0");

    try {
      mkdirSync(path.join(packageDir, "info", "licenses"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "conda-lock.yml"),
        [
          "version: 1",
          "metadata:",
          "  sources:",
          "    - environment.yml",
          "package:",
          "  - name: risk-conda",
          "    version: '1.0.0'",
          "    manager: conda",
          "    platform: linux-64",
          "    dependencies: {}",
          "    url: https://conda.anaconda.org/conda-forge/linux-64/risk-conda-1.0.0-py312_0.tar.bz2",
          "    category: main"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "info", "index.json"),
        JSON.stringify({
          name: "risk-conda",
          version: "1.0.0",
          license: "AGPL-3.0-only"
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "info", "licenses", "LICENSE"),
        "GNU Affero General Public License version 3",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("conda-lock.yml (conda-lock)");
      expect(output).toContain("- [high] conda:risk-conda@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("info/index.json license: AGPL-3.0-only");
      expect(output).toContain("file: info/licenses/LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a vcpkg manifest project with installed status", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-vcpkg-project-"));
    const shareDir = path.join(projectRoot, "vcpkg_installed", "x64-windows", "share", "risklib");

    try {
      mkdirSync(path.join(projectRoot, "vcpkg_installed", "vcpkg"), { recursive: true });
      mkdirSync(shareDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "vcpkg.json"),
        JSON.stringify({
          name: "fixture-cpp",
          dependencies: ["risklib"]
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "vcpkg_installed", "vcpkg", "status"),
        [
          "Package: risklib",
          "Version: 1.0.0",
          "Architecture: x64-windows",
          "Status: install ok installed"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(shareDir, "copyright"),
        "SPDX-License-Identifier: AGPL-3.0-only",
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("vcpkg.json (vcpkg-json)");
      expect(output).toContain("- [high] risklib@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("x64-windows/share/risklib/copyright (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Terraform .terraform.lock.hcl project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-terraform-lock-project-"));
    const providerDir = path.join(
      projectRoot,
      ".terraform",
      "providers",
      "registry.terraform.io",
      "acme",
      "risk",
      "1.0.0",
      "windows_amd64"
    );

    try {
      mkdirSync(providerDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".terraform.lock.hcl"),
        [
          'provider "registry.terraform.io/acme/risk" {',
          '  version = "1.0.0"',
          "}"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(providerDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain(".terraform.lock.hcl (terraform-lock)");
      expect(output).toContain("- [high] registry.terraform.io/acme/risk@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("file: windows_amd64/LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Helm Chart.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-helm-lock-project-"));
    const chartDir = path.join(projectRoot, "charts", "risk-chart");

    try {
      mkdirSync(chartDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Chart.lock"),
        [
          "dependencies:",
          "  - name: risk-chart",
          "    repository: https://charts.acme.example",
          "    version: 1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(chartDir, "Chart.yaml"),
        [
          "apiVersion: v2",
          "name: risk-chart",
          "version: 1.0.0",
          "annotations:",
          "  artifacthub.io/license: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Chart.lock (helm-chart-lock)");
      expect(output).toContain("- [high] https://charts.acme.example/risk-chart@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("Chart.yaml license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Nix flake.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-nix-flake-project-"));
    const inputDir = path.join(projectRoot, "vendor", "risk-flake");

    try {
      mkdirSync(inputDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "flake.lock"),
        JSON.stringify({
          root: "root",
          nodes: {
            root: {
              inputs: {
                risk: "risk"
              }
            },
            risk: {
              locked: {
                type: "path",
                path: "./vendor/risk-flake",
                narHash: "sha256-risk"
              }
            }
          }
        }),
        "utf8"
      );
      writeFileSync(path.join(inputDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("flake.lock (nix-flake-lock)");
      expect(output).toContain("- [high] path:./vendor/risk-flake@sha256-risk");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("file: LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Unity packages-lock.json project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-unity-packages-lock-project-"));
    const packageDir = path.join(
      projectRoot,
      "Library",
      "PackageCache",
      "com.acme.risk@1.0.0"
    );

    try {
      mkdirSync(path.join(projectRoot, "Packages"), { recursive: true });
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Packages", "packages-lock.json"),
        JSON.stringify({
          dependencies: {
            "com.acme.risk": {
              version: "1.0.0",
              depth: 0,
              source: "registry",
              dependencies: {},
              url: "https://packages.acme.example"
            },
            "com.unity.modules.ai": {
              version: "1.0.0",
              depth: 0,
              source: "builtin",
              dependencies: {}
            }
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "com.acme.risk",
          version: "1.0.0",
          license: "AGPL-3.0-only"
        }),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain(`Packages${path.sep}packages-lock.json (unity-packages-lock)`);
      expect(output).toContain("- [high] com.acme.risk@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("package.json license: AGPL-3.0-only");
      expect(output).not.toContain("com.unity.modules.ai");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for an R renv.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-renv-lock-project-"));
    const packageDir = path.join(projectRoot, "renv", "library", "R-4.4", "x86_64", "RiskR");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "renv.lock"),
        JSON.stringify({
          R: {
            Version: "4.4.1"
          },
          Packages: {
            RiskR: {
              Package: "RiskR",
              Version: "1.0.0",
              Source: "Repository",
              Repository: "CRAN"
            }
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "DESCRIPTION"),
        [
          "Package: FixtureR",
          "Version: 0.0.0",
          "Imports: RiskR"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "DESCRIPTION"),
        [
          "Package: RiskR",
          "Version: 1.0.0",
          "License: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("renv.lock (renv-lock)");
      expect(output).toContain("- [high] RiskR@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("DESCRIPTION license: AGPL-3.0-only");
      expect(output).toContain("file: LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Julia Manifest.toml project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-julia-manifest-project-"));
    const packageDir = path.join(projectRoot, ".julia", "packages", "RiskJulia", "abc123");

    try {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Manifest.toml"),
        [
          "julia_version = \"1.10.4\"",
          "manifest_format = \"2.0\"",
          "",
          "[[deps.RiskJulia]]",
          "deps = []",
          "git-tree-sha1 = \"abc123\"",
          "uuid = \"11111111-1111-1111-1111-111111111111\"",
          "version = \"1.0.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Project.toml"),
        [
          "name = \"FixtureJulia\"",
          "uuid = \"00000000-0000-0000-0000-000000000000\"",
          "",
          "[deps]",
          "RiskJulia = \"11111111-1111-1111-1111-111111111111\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(packageDir, "Project.toml"),
        [
          "name = \"RiskJulia\"",
          "uuid = \"11111111-1111-1111-1111-111111111111\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), "GNU Affero General Public License version 3", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Manifest.toml (julia-manifest)");
      expect(output).toContain("- [high] RiskJulia@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("Project.toml license: AGPL-3.0-only");
      expect(output).toContain("file: LICENSE (license)");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Haskell Stack stack.yaml.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-stack-lock-project-"));

    try {
      const packageDbDir = path.join(
        projectRoot,
        ".stack-work",
        "install",
        "x86_64-windows",
        "snapshot",
        "9.6.6",
        "pkgdb"
      );
      mkdirSync(packageDbDir, { recursive: true });
      writeFileSync(
        path.join(packageDbDir, "risk-haskell-1.2.3-abc.conf"),
        [
          "name: risk-haskell",
          "version: 1.2.3",
          "license: AGPL-3.0-only"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(projectRoot, "stack.yaml"), "resolver: lts-22.0\n", "utf8");
      writeFileSync(
        path.join(projectRoot, "stack.yaml.lock"),
        [
          "packages:",
          "- completed:",
          "    hackage: risk-haskell-1.2.3@sha256:abc,1234",
          "  original:",
          "    hackage: risk-haskell-1.2.3"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("stack.yaml.lock (stack-lock)");
      expect(output).toContain("- [high] risk-haskell@1.2.3");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("ghc-pkg license: AGPL-3.0-only");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Perl Carton cpanfile.snapshot project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cpanfile-snapshot-project-"));

    try {
      const appRiskArchive = path.join(
        projectRoot,
        "local",
        "cache",
        "authors",
        "id",
        "A",
        "AC",
        "ACME",
        "App-Risk-1.0.tar.gz"
      );
      const requirementsArchive = path.join(
        projectRoot,
        "local",
        "cache",
        "authors",
        "id",
        "R",
        "RJ",
        "RJBS",
        "CPAN-Meta-Requirements-2.143.tar.gz"
      );
      mkdirSync(path.dirname(appRiskArchive), { recursive: true });
      mkdirSync(path.dirname(requirementsArchive), { recursive: true });
      writeFileSync(
        appRiskArchive,
        createTarGz({
          "App-Risk-1.0/META.json": JSON.stringify({
            name: "App-Risk",
            version: "1.0",
            license: ["agpl_3"]
          })
        })
      );
      writeFileSync(
        requirementsArchive,
        createTarGz({
          "CPAN-Meta-Requirements-2.143/META.json": JSON.stringify({
            name: "CPAN-Meta-Requirements",
            version: "2.143",
            license: ["mit"]
          })
        })
      );
      writeFileSync(path.join(projectRoot, "cpanfile"), "requires 'App::Risk';\n", "utf8");
      writeFileSync(
        path.join(projectRoot, "cpanfile.snapshot"),
        [
          "# carton snapshot format: version 1.0",
          "DISTRIBUTIONS",
          "  CPAN-Meta-Requirements-2.143",
          "    pathname: R/RJ/RJBS/CPAN-Meta-Requirements-2.143.tar.gz",
          "    provides:",
          "      CPAN::Meta::Requirements 2.143",
          "    requirements:",
          "      perl 5.010000",
          "  App-Risk-1.0",
          "    pathname: A/AC/ACME/App-Risk-1.0.tar.gz",
          "    provides:",
          "      App::Risk 1.0",
          "    requirements:",
          "      CPAN::Meta::Requirements 2.143"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("cpanfile.snapshot (cpanfile-snapshot)");
      expect(output).toContain("- [high] App-Risk@1.0");
      expect(output).toContain("- [low] CPAN-Meta-Requirements@2.143");
      expect(output).toContain("path: ohrisk-cpanfile-snapshot-project");
      expect(output).toContain("App-Risk@1.0 -> CPAN-Meta-Requirements@2.143");
      expect(output).toContain("CPAN META license: AGPL-3.0-only");
      expect(output).toContain("CPAN META license: MIT");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints unknown findings for a LuaRocks luarocks.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-luarocks-lock-project-"));

    try {
      writeFileSync(
        path.join(projectRoot, "luarocks.lock"),
        [
          "return {",
          "  dependencies = {",
          '    ["lua-cjson"] = "2.1.0-1"',
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      const output = stdout.join("");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("luarocks.lock (luarocks-lock)");
      expect(output).toContain("- [unknown] lua-cjson@2.1.0-1");
      expect(output).toContain("dependency: unknown direct");
      expect(output).toContain("source: unavailable");
      expect(output).toContain("LuaRocks package rockspec was not found");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a Ruby Bundler Gemfile.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-gemfile-project-"));
    const bundleRoot = path.join(projectRoot, "vendor", "bundle", "ruby", "3.3.0");
    const packageDir = path.join(bundleRoot, "gems", "risk-gem-1.0.0");

    try {
      mkdirSync(packageDir, { recursive: true });
      mkdirSync(path.join(bundleRoot, "specifications"), { recursive: true });
      writeFileSync(
        path.join(projectRoot, "Gemfile.lock"),
        [
          "GEM",
          "  remote: https://rubygems.org/",
          "  specs:",
          "    dev-risk-gem (2.0.0)",
          "    risk-gem (1.0.0)",
          "",
          "PLATFORMS",
          "  ruby",
          "",
          "DEPENDENCIES",
          "  dev-risk-gem",
          "  risk-gem",
          "",
          "BUNDLED WITH",
          "   2.5.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "Gemfile"),
        [
          "source 'https://rubygems.org'",
          "",
          "gem 'risk-gem'",
          "",
          "gem 'dev-risk-gem', group: :development"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(bundleRoot, "specifications", "risk-gem-1.0.0.gemspec"),
        [
          "Gem::Specification.new do |s|",
          "  s.name = \"risk-gem\"",
          "  s.version = \"1.0.0\"",
          "  s.license = \"AGPL-3.0-only\"",
          "end"
        ].join("\n"),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Lockfile: Gemfile.lock (gemfile-lock)");
      expect(output).toContain("- [high] risk-gem@1.0.0");
      expect(output).toContain("dependency: production direct");
      expect(output).toContain("gemspec license: AGPL-3.0-only");
      expect(output).not.toContain("dev-risk-gem@2.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints actionable findings for a PHP Composer composer.lock project", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-composer-project-"));
    const safeDir = path.join(projectRoot, "vendor", "acme", "safe");
    const riskDir = path.join(projectRoot, "vendor", "acme", "risk");
    const devDir = path.join(projectRoot, "vendor", "acme", "dev-tool");

    try {
      mkdirSync(safeDir, { recursive: true });
      mkdirSync(riskDir, { recursive: true });
      mkdirSync(devDir, { recursive: true });
      writeFileSync(
        path.join(projectRoot, "composer.json"),
        JSON.stringify({
          name: "acme/app",
          require: {
            "acme/safe": "^1.0"
          },
          "require-dev": {
            "acme/dev-tool": "^3.0"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectRoot, "composer.lock"),
        JSON.stringify({
          packages: [
            {
              name: "acme/safe",
              version: "1.0.0",
              require: {
                php: ">=8.2",
                "acme/risk": "^2.0"
              }
            },
            {
              name: "acme/risk",
              version: "2.0.0"
            }
          ],
          "packages-dev": [
            {
              name: "acme/dev-tool",
              version: "3.0.0"
            }
          ]
        }),
        "utf8"
      );
      writeFileSync(path.join(safeDir, "composer.json"), JSON.stringify({ license: "MIT" }), "utf8");
      writeFileSync(
        path.join(riskDir, "composer.json"),
        JSON.stringify({ license: "AGPL-3.0-only" }),
        "utf8"
      );
      writeFileSync(
        path.join(devDir, "composer.json"),
        JSON.stringify({ license: "GPL-3.0-only" }),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Ohrisk scan");
      expect(output).toContain("Lockfile: composer.lock (composer-lock)");
      expect(output).toContain("- [high] acme/risk@2.0.0");
      expect(output).toContain("path: acme/app -> acme/safe@1.0.0 -> acme/risk@2.0.0");
      expect(output).toContain("composer.json license: AGPL-3.0-only");
      expect(output).not.toContain("acme/dev-tool@3.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("diff reads baseline composer.json for Composer root dependency classification", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-composer-diff-"));
    const riskDir = path.join(projectRoot, "vendor", "acme", "risk");
    const composerJson = JSON.stringify({
      name: "acme/app",
      require: {
        "acme/risk": "^1.0"
      }
    });
    const composerLock = JSON.stringify({
      packages: [
        {
          name: "acme/risk",
          version: "1.0.0"
        }
      ]
    });

    try {
      mkdirSync(riskDir, { recursive: true });
      writeFileSync(path.join(projectRoot, "composer.json"), composerJson, "utf8");
      writeFileSync(path.join(projectRoot, "composer.lock"), composerLock, "utf8");
      writeFileSync(
        path.join(riskDir, "composer.json"),
        JSON.stringify({ license: "AGPL-3.0-only" }),
        "utf8"
      );

      const requestedBaselinePaths: string[] = [];
      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        requestedBaselinePaths.push(relativePath);
        if (relativePath === "composer.lock") {
          return { ok: true as const, value: composerLock };
        }

        if (relativePath === "composer.json") {
          return { ok: true as const, value: composerJson };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(requestedBaselinePaths).toEqual(["composer.lock", "composer.json"]);

      const payload = JSON.parse(stdout.join("\n")) as {
        currentFindingCount: number;
        baselineFindingCount: number;
        newFindingCount: number;
      };
      expect(payload.currentFindingCount).toBe(1);
      expect(payload.baselineFindingCount).toBe(1);
      expect(payload.newFindingCount).toBe(0);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not apply local waivers to git ref diff findings", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-diff-waiver-project-"));
    const baselineLockfile = [
      "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
      "# bun lockfile v1",
      "",
      "{",
      '  "lockfileVersion": 1,',
      '  "workspaces": {',
      '    "": {',
      '      "name": "fixture-bun-project",',
      '      "dependencies": {',
      '        "dual-license": "2.0.0",',
      "      },",
      "    },",
      "  },",
      '  "packages": {',
      '    "dual-license": [',
      '      "dual-license@2.0.0",',
      '      "file:./.registry/dual-license",',
      "      {},",
      '      "sha512-dual",',
      "    ],",
      "  },",
      "}"
    ].join("\n");

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for scan output only."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

      const exitCode = await main(["diff", "main", "--prod", "--json", "--fail-on", "high"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        newRisks: {
          high: number;
        };
        findings: Array<{
          packageId: string;
        }>;
      };

      expect(payload.newRisks.high).toBe(1);
      expect(payload.findings.map((finding) => finding.packageId)).toContain("agpl-child@0.1.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints only new or changed findings for a Yarn v1 git ref diff", async () => {
    const baselineLockfile = [
      "# yarn lockfile v1",
      "",
      "agpl-child@0.1.0:",
      "  version \"0.1.0\"",
      "  resolved \"file:../bun-project/.registry/agpl-child\"",
      "",
      "\"dual-license@file:../bun-project/.registry/dual-license\":",
      "  version \"2.0.0\"",
      "  resolved \"file:../bun-project/.registry/dual-license\"",
      "",
      "\"permissive-parent@file:../bun-project/.registry/permissive-parent\":",
      "  version \"1.0.0\"",
      "  resolved \"file:../bun-project/.registry/permissive-parent\"",
      "  dependencies:",
      "    agpl-child \"0.1.0\"",
      ""
    ].join("\n");
    const baselinePackageJson = JSON.stringify({
      name: "fixture-yarn-project",
      version: "0.0.0",
      dependencies: {
        "permissive-parent": "file:../bun-project/.registry/permissive-parent",
        "dual-license": "file:../bun-project/.registry/dual-license"
      }
    });
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "yarn-project"));
    io.readRefFile = ({ relativePath }) => {
      if (relativePath === "yarn.lock") {
        return { ok: true as const, value: baselineLockfile };
      }

      if (relativePath === "package.json") {
        return { ok: true as const, value: baselinePackageJson };
      }

      throw new Error(`Unexpected baseline path: ${relativePath}`);
    };

    const exitCode = await main(["diff", "main", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk diff");
    expect(output).toContain("Baseline: main");
    expect(output).toContain("Findings: 5 current, 3 baseline, 2 new or changed");
    expect(output).toContain("New or changed risks: 0 high, 1 review, 1 unknown, 0 low");
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] agpl-child@0.1.0");
  });

  test("keeps unchanged Yarn workspace findings out of git ref diff output", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-workspace-diff-"));
    const dependencyRange = "file:./.registry/permissive-parent";
    const rootPackageJson = JSON.stringify({
      name: "fixture-yarn-workspace-diff",
      private: true,
      workspaces: ["apps/*"]
    });
    const workspacePackageJson = JSON.stringify({
      name: "workspace-web",
      dependencies: {
        "permissive-parent": dependencyRange
      }
    });
    const yarnLockfile = [
      "# yarn lockfile v1",
      "",
      "agpl-child@0.1.0:",
      "  version \"0.1.0\"",
      "  resolved \"file:./.registry/agpl-child\"",
      "",
      `"permissive-parent@${dependencyRange}":`,
      "  version \"1.0.0\"",
      "  resolved \"file:./.registry/permissive-parent\"",
      "  dependencies:",
      "    agpl-child \"0.1.0\"",
      ""
    ].join("\n");

    try {
      mkdirSync(path.join(projectRoot, "apps", "web"), { recursive: true });
      cpSync(
        path.join(fixturesDir, "bun-project", ".registry"),
        path.join(projectRoot, ".registry"),
        { recursive: true }
      );
      writeFileSync(path.join(projectRoot, "package.json"), rootPackageJson, "utf8");
      writeFileSync(
        path.join(projectRoot, "apps", "web", "package.json"),
        workspacePackageJson,
        "utf8"
      );
      writeFileSync(path.join(projectRoot, "yarn.lock"), yarnLockfile, "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        if (relativePath === "yarn.lock") {
          return { ok: true as const, value: yarnLockfile };
        }

        if (relativePath === "package.json") {
          return { ok: true as const, value: rootPackageJson };
        }

        if (relativePath === "apps/web/package.json") {
          return { ok: true as const, value: workspacePackageJson };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Findings: 2 current, 2 baseline, 0 new or changed");
      expect(output).toContain("New or changed risks: 0 high, 0 review, 0 unknown, 0 low");
      expect(output).not.toContain("- [high] agpl-child@0.1.0");
      expect(output).not.toContain("- [low] permissive-parent@1.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("treats missing baseline Yarn workspace manifests as newly added workspaces", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-workspace-added-diff-"));
    const dependencyRange = "file:./.registry/permissive-parent";
    const rootPackageJson = JSON.stringify({
      name: "fixture-yarn-workspace-added-diff",
      private: true,
      workspaces: ["apps/*"]
    });
    const workspacePackageJson = JSON.stringify({
      name: "workspace-web",
      dependencies: {
        "permissive-parent": dependencyRange
      }
    });
    const baselineRootPackageJson = JSON.stringify({
      name: "fixture-yarn-workspace-added-diff",
      private: true,
      workspaces: ["apps/*"]
    });
    const yarnLockfile = [
      "# yarn lockfile v1",
      "",
      "agpl-child@0.1.0:",
      "  version \"0.1.0\"",
      "  resolved \"file:./.registry/agpl-child\"",
      "",
      `"permissive-parent@${dependencyRange}":`,
      "  version \"1.0.0\"",
      "  resolved \"file:./.registry/permissive-parent\"",
      "  dependencies:",
      "    agpl-child \"0.1.0\"",
      ""
    ].join("\n");

    try {
      mkdirSync(path.join(projectRoot, "apps", "web"), { recursive: true });
      cpSync(
        path.join(fixturesDir, "bun-project", ".registry"),
        path.join(projectRoot, ".registry"),
        { recursive: true }
      );
      writeFileSync(path.join(projectRoot, "package.json"), rootPackageJson, "utf8");
      writeFileSync(
        path.join(projectRoot, "apps", "web", "package.json"),
        workspacePackageJson,
        "utf8"
      );
      writeFileSync(path.join(projectRoot, "yarn.lock"), yarnLockfile, "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        if (relativePath === "yarn.lock") {
          return { ok: true as const, value: yarnLockfile };
        }

        if (relativePath === "package.json") {
          return { ok: true as const, value: baselineRootPackageJson };
        }

        if (relativePath === "apps/web/package.json") {
          return {
            ok: false as const,
            error: {
              code: "GIT_REF_FILE_NOT_FOUND",
              category: "invalid_input",
              message: "The requested baseline file does not exist in the git ref.",
              details: {
                relativePath
              }
            }
          };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const output = stdout.join("\n");
      expect(output).toContain("Findings: 2 current, 0 baseline, 2 new or changed");
      expect(output).toContain("New or changed risks: 1 high, 0 review, 0 unknown, 1 low");
      expect(output).toContain("- [high] agpl-child@0.1.0");
      expect(output).toContain("- [low] permissive-parent@1.0.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not swallow non-missing baseline Yarn workspace manifest errors", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-workspace-error-diff-"));
    const dependencyRange = "file:./.registry/permissive-parent";
    const rootPackageJson = JSON.stringify({
      name: "fixture-yarn-workspace-error-diff",
      private: true,
      workspaces: ["apps/*"]
    });
    const workspacePackageJson = JSON.stringify({
      name: "workspace-web",
      dependencies: {
        "permissive-parent": dependencyRange
      }
    });
    const yarnLockfile = [
      "# yarn lockfile v1",
      "",
      "agpl-child@0.1.0:",
      "  version \"0.1.0\"",
      "  resolved \"file:./.registry/agpl-child\"",
      "",
      `"permissive-parent@${dependencyRange}":`,
      "  version \"1.0.0\"",
      "  resolved \"file:./.registry/permissive-parent\"",
      "  dependencies:",
      "    agpl-child \"0.1.0\"",
      ""
    ].join("\n");

    try {
      mkdirSync(path.join(projectRoot, "apps", "web"), { recursive: true });
      cpSync(
        path.join(fixturesDir, "bun-project", ".registry"),
        path.join(projectRoot, ".registry"),
        { recursive: true }
      );
      writeFileSync(path.join(projectRoot, "package.json"), rootPackageJson, "utf8");
      writeFileSync(
        path.join(projectRoot, "apps", "web", "package.json"),
        workspacePackageJson,
        "utf8"
      );
      writeFileSync(path.join(projectRoot, "yarn.lock"), yarnLockfile, "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = ({ relativePath }) => {
        if (relativePath === "yarn.lock") {
          return { ok: true as const, value: yarnLockfile };
        }

        if (relativePath === "package.json") {
          return { ok: true as const, value: rootPackageJson };
        }

        if (relativePath === "apps/web/package.json") {
          return {
            ok: false as const,
            error: {
              code: "GIT_REF_PATH_OUTSIDE_PROJECT",
              category: "invalid_input",
              message: "Baseline file paths must stay inside the current project root.",
              details: {
                relativePath
              }
            }
          };
        }

        throw new Error(`Unexpected baseline path: ${relativePath}`);
      };

      const exitCode = await main(["diff", "main", "--prod"], io);

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("\n")).toContain("GIT_REF_PATH_OUTSIDE_PROJECT");
      expect(stderr.join("\n")).toContain("apps/web/package.json");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints JSON diff output", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      baselineRef: string;
      baselineFindingCount: number;
      currentFindingCount: number;
      newFindingCount: number;
      newRisks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
      nextAction: string;
      findings: Array<{
        id: string;
        fingerprint: string;
        packageId: string;
        severity: string;
      }>;
    };

    expect(payload.status).toBe("risk_diff_evaluated");
    expect(payload.baselineRef).toBe("main");
    expect(payload.baselineFindingCount).toBe(3);
    expect(payload.currentFindingCount).toBe(5);
    expect(payload.newFindingCount).toBe(2);
    expect(payload.newRisks).toEqual({
      high: 0,
      review: 1,
      unknown: 1,
      low: 0
    });
    expect(payload.nextAction).toBe(
      "Collect evidence for new or changed unknown license findings before merging."
    );
    expect(payload.findings.map((finding) => finding.packageId)).toEqual([
      "missing-license@4.0.0",
      "gpl-package@5.0.0"
    ]);
    expect(payload.findings[0]?.id).toBe(
      "missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0"
    );
    expect(payload.findings[0]?.fingerprint).toContain(
      "::unknown::collect-evidence::Package metadata does not declare a license expression."
    );
  });

  test("prints Markdown diff output", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--markdown"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("# Ohrisk diff");
    expect(output).toContain("- Baseline: `main`");
    expect(output).toContain("- New or changed risks: `0 high`, `1 review`, `1 unknown`, `0 low`");
    expect(output).toContain(
      "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |"
    );
    expect(output).toContain(
      "| `missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0` | `missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0::unknown::collect-evidence::Package metadata does not declare a license expression."
    );
    expect(output).toContain(
      "| `gpl-package@5.0.0::production::direct::fixture-bun-project>gpl-package@5.0.0` | `gpl-package@5.0.0::production::direct::fixture-bun-project>gpl-package@5.0.0::review::review::License expression should be reviewed before shipping under saas."
    );
    expect(output).toContain("Collect evidence for new or changed unknown license findings before merging.");
  });

  test("prints diff threshold outcome", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--fail-on", "unknown"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain(
      "Threshold: failed on unknown (1 finding at or above threshold)"
    );
  });

  test("returns non-zero from diff when new findings meet the fail threshold", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--json", "--fail-on", "unknown"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      failOn: string;
      failed: boolean;
      failingFindingCount: number;
      newRisks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
    };

    expect(payload.newRisks).toEqual({
      high: 0,
      review: 1,
      unknown: 1,
      low: 0
    });
    expect(payload.failOn).toBe("unknown");
    expect(payload.failed).toBe(true);
    expect(payload.failingFindingCount).toBe(1);
  });

  test("explains license risk without scanning a project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "AGPL-3.0-only", "--profile", "saas"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Ohrisk explain");
    expect(stdout.join("\n")).toContain("Expression: AGPL-3.0-only");
    expect(stdout.join("\n")).toContain("Severity: high");
    expect(stdout.join("\n")).toContain("Recommendation: replace");
    expect(stdout.join("\n")).toContain(
      "Action: Replace this package or escalate before shipping."
    );
    expect(stdout.join("\n")).toContain("not a legal safe or unsafe verdict");
  });

  test("prints JSON explain output", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "MIT", "OR", "Apache-2.0", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      expression: string;
      profile: string;
      license: {
        expression: string;
        choices: string[];
      };
      finding: {
        severity: string;
        recommendation: string;
        action: string;
      };
    };

    expect(payload.status).toBe("license_explained");
    expect(payload.expression).toBe("MIT OR Apache-2.0");
    expect(payload.profile).toBe("saas");
    expect(payload.license.expression).toBe("MIT OR Apache-2.0");
    expect(payload.license.choices).toEqual(["MIT", "Apache-2.0"]);
    expect(payload.finding.severity).toBe("low");
    expect(payload.finding.recommendation).toBe("allow");
    expect(payload.finding.action).toBe("No action needed for this profile.");
  });

  test.each(["NOASSERTION", "NONE"])(
    "explains %s as missing license evidence",
    async (expression) => {
      const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
      const exitCode = await main(["explain", expression, "--json"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        expression: string;
        license: {
          choices: string[];
          signals: string[];
          confidence: string;
        };
        finding: {
          severity: string;
          recommendation: string;
          reason: string;
        };
      };

      expect(payload.expression).toBe(expression);
      expect(payload.license.choices).toEqual([]);
      expect(payload.license.signals).toEqual(["missing"]);
      expect(payload.license.confidence).toBe("low");
      expect(payload.finding.severity).toBe("unknown");
      expect(payload.finding.recommendation).toBe("collect-evidence");
      expect(payload.finding.reason).toBe("Package metadata does not declare a license expression.");
    }
  );

  test("explains source-available aliases without scanning a project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "BUSL", "--profile", "saas"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Expression: BUSL");
    expect(output).toContain("Severity: high");
    expect(output).toContain("Recommendation: replace");
    expect(output).toContain("Normalized: BUSL-1.1");
    expect(output).toContain("commercial-restriction");
  });

  test("explains restricted OR expressions without overriding the low-risk branch", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "MIT", "OR", "BUSL-1.1", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      expression: string;
      license: {
        expression: string;
        choices: string[];
        signals: string[];
      };
      finding: {
        severity: string;
        recommendation: string;
      };
    };

    expect(payload.expression).toBe("MIT OR BUSL-1.1");
    expect(payload.license.expression).toBe("MIT OR BUSL-1.1");
    expect(payload.license.choices).toEqual(["MIT", "BUSL-1.1"]);
    expect(payload.license.signals).toContain("commercial-restriction");
    expect(payload.finding.severity).toBe("low");
    expect(payload.finding.recommendation).toBe("allow");
  });

  test("returns user-input failure for unsupported projects", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["scan"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("NO_SUPPORTED_LOCKFILE");
  });
});
