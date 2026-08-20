import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertStandaloneExecutableHeader,
  nativeStandaloneTarget,
  parseStandaloneBuildArgs,
  renderSha256Sums,
  resolveStandaloneOutputDirectory,
  STANDALONE_CHECKSUM_FILENAME,
  STANDALONE_RELEASE_DIRECTORY,
  STANDALONE_TARGETS,
  type StandaloneTarget,
  type StandaloneTargetId
} from "../scripts/standalone";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("standalone release targets", () => {
  test("defines deterministic assets for six supported OS and architecture pairs", () => {
    expect(STANDALONE_TARGETS.map((target) => target.id)).toEqual([
      "linux-x64",
      "linux-arm64",
      "macos-x64",
      "macos-arm64",
      "windows-x64",
      "windows-arm64"
    ]);
    expect(STANDALONE_TARGETS.map((target) => target.assetName)).toEqual([
      "ohrisk-linux-x64",
      "ohrisk-linux-arm64",
      "ohrisk-macos-x64",
      "ohrisk-macos-arm64",
      "ohrisk-windows-x64.exe",
      "ohrisk-windows-arm64.exe"
    ]);
    expect(new Set(STANDALONE_TARGETS.map((target) => target.bunTarget)).size)
      .toBe(STANDALONE_TARGETS.length);
    expect(target("linux-x64").bunTarget).toBe("bun-linux-x64-baseline");
    expect(target("macos-x64").bunTarget).toBe("bun-darwin-x64-baseline");
    expect(target("windows-x64").bunTarget).toBe("bun-windows-x64-baseline");
  });

  test("selects all, explicit, or native targets without duplicate output", () => {
    const all = parseStandaloneBuildArgs([], repoRoot);
    expect(all.targets.map((candidate) => candidate.id)).toEqual(
      STANDALONE_TARGETS.map((candidate) => candidate.id)
    );
    expect(all.outdir).toBe(
      path.join(repoRoot, STANDALONE_RELEASE_DIRECTORY)
    );

    const selected = parseStandaloneBuildArgs([
      "--target",
      "windows-arm64",
      "--target=linux-x64",
      "--outdir",
      "build/standalone-test"
    ], repoRoot);
    expect(selected.targets.map((candidate) => candidate.id)).toEqual([
      "linux-x64",
      "windows-arm64"
    ]);
    expect(selected.outdir).toBe(path.join(repoRoot, "build/standalone-test"));

    const native = parseStandaloneBuildArgs(["--native"], repoRoot);
    expect(native.targets.map((candidate) => candidate.id)).toEqual([
      nativeStandaloneTarget().id
    ]);
  });

  test("rejects unsafe or ambiguous build selection", () => {
    expect(() =>
      parseStandaloneBuildArgs(["--target", "plan9-x64"], repoRoot)
    ).toThrow("Unknown standalone target");
    expect(() =>
      parseStandaloneBuildArgs([
        "--target",
        "linux-x64",
        "--target",
        "linux-x64"
      ], repoRoot)
    ).toThrow("must not be repeated");
    expect(() =>
      parseStandaloneBuildArgs([
        "--native",
        "--target",
        nativeStandaloneTarget().id
      ], repoRoot)
    ).toThrow("--native cannot be combined");
    expect(() =>
      resolveStandaloneOutputDirectory(repoRoot, "../outside")
    ).toThrow("must stay below");
    expect(() =>
      resolveStandaloneOutputDirectory(repoRoot, repoRoot)
    ).toThrow("must be repository-relative");
  });
});

describe("standalone executable validation", () => {
  test("accepts matching ELF, Mach-O, and PE architecture headers", () => {
    assertStandaloneExecutableHeader(
      elfExecutable(0x3e),
      target("linux-x64")
    );
    assertStandaloneExecutableHeader(
      elfExecutable(0xb7),
      target("linux-arm64")
    );
    assertStandaloneExecutableHeader(
      machOExecutable(0x01000007),
      target("macos-x64")
    );
    assertStandaloneExecutableHeader(
      machOExecutable(0x0100000c),
      target("macos-arm64")
    );
    assertStandaloneExecutableHeader(
      peExecutable(0x8664),
      target("windows-x64")
    );
    assertStandaloneExecutableHeader(
      peExecutable(0xaa64),
      target("windows-arm64")
    );
  });

  test("rejects a valid executable for the wrong architecture", () => {
    expect(() =>
      assertStandaloneExecutableHeader(
        elfExecutable(0xb7),
        target("linux-x64")
      )
    ).toThrow("expected 0x3e");
    expect(() =>
      assertStandaloneExecutableHeader(
        machOExecutable(0x0100000c),
        target("macos-x64")
      )
    ).toThrow("expected 0x1000007");
    expect(() =>
      assertStandaloneExecutableHeader(
        peExecutable(0xaa64),
        target("windows-x64")
      )
    ).toThrow("expected 0x8664");
  });

  test("renders sorted checksum manifests and rejects ambiguous names", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(renderSha256Sums([
      { assetName: "ohrisk-windows-x64.exe", sha256: b },
      { assetName: "ohrisk-linux-x64", sha256: a }
    ])).toBe(
      `${a}  ohrisk-linux-x64\n${b}  ohrisk-windows-x64.exe\n`
    );
    expect(() =>
      renderSha256Sums([
        { assetName: "ohrisk-linux-x64", sha256: a },
        { assetName: "ohrisk-linux-x64", sha256: b }
      ])
    ).toThrow("Duplicate standalone asset name");
    expect(() =>
      renderSha256Sums([
        { assetName: "../ohrisk", sha256: a }
      ])
    ).toThrow("Invalid standalone asset name");
  });
});

describe("standalone release wiring", () => {
  test("keeps CI, tag publishing, and docs aligned", () => {
    const ci = readFileSync(
      path.join(repoRoot, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    const publish = readFileSync(
      path.join(repoRoot, ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );
    const docsIndex = readFileSync(
      path.join(repoRoot, "docs", "README.md"),
      "utf8"
    );
    const standaloneDocs = readFileSync(
      path.join(repoRoot, "docs", "standalone-executables.md"),
      "utf8"
    );
    const entrypoint = readFileSync(
      path.join(repoRoot, "scripts", "standalone-entrypoint.ts"),
      "utf8"
    );
    const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

    expect(ci).toContain("name: Cross-build all standalone release executables");
    expect(ci.match(/bun scripts\/build-standalone\.ts/g)).toHaveLength(1);
    expect(ci).not.toContain("build-standalone.ts --native");

    expect(publish).toContain("name: Cross-build standalone executables");
    expect(publish).toContain("run: bun scripts/build-standalone.ts");
    expect(publish).toContain("name: Smoke standalone release");
    expect(publish).toContain("RUNNER_OS/$RUNNER_ARCH");
    expect(publish).toContain("gh release download \"$GITHUB_REF_NAME\"");
    expect(publish).toContain("- standalone-smoke");
    for (const candidate of STANDALONE_TARGETS) {
      expect(publish).toContain(candidate.assetName);
    }
    expect(publish).toContain("gh release create \"$GITHUB_REF_NAME\"");
    expect(publish).toContain("--draft");
    expect(publish).toContain("gh release upload \"$GITHUB_REF_NAME\"");
    expect(publish).toContain(STANDALONE_CHECKSUM_FILENAME);
    expect(publish).toContain("--draft=false");
    expect(publish.indexOf("name: Cross-build standalone executables"))
      .toBeLessThan(publish.indexOf("name: Smoke standalone release"));
    expect(publish.indexOf("name: Smoke standalone release"))
      .toBeLessThan(publish.indexOf("name: Publish to npm"));

    expect(docsIndex).toContain(
      "[Standalone Executables](standalone-executables.md)"
    );
    expect(standaloneDocs).toContain("six release assets");
    expect(standaloneDocs).toContain(STANDALONE_CHECKSUM_FILENAME);
    expect(standaloneDocs).toContain("not code-signed or notarized");
    expect(entrypoint).toContain("__ohrisk_standalone_bootstrap__");
    expect(entrypoint).toContain("await import(\"../src/cli/main\")");
    expect(gitignore).toContain("/release/standalone/");
  });
});

function target(id: StandaloneTargetId): StandaloneTarget {
  const selected = STANDALONE_TARGETS.find((candidate) => candidate.id === id);
  if (!selected) {
    throw new Error(`Missing test target ${id}.`);
  }
  return selected;
}

function elfExecutable(machine: number): Buffer {
  const executable = Buffer.alloc(64);
  executable.set([0x7f, 0x45, 0x4c, 0x46, 0x02], 0);
  executable.writeUInt16LE(machine, 18);
  return executable;
}

function machOExecutable(machine: number): Buffer {
  const executable = Buffer.alloc(32);
  executable.writeUInt32LE(0xfeedfacf, 0);
  executable.writeUInt32LE(machine, 4);
  return executable;
}

function peExecutable(machine: number): Buffer {
  const executable = Buffer.alloc(160);
  executable.set([0x4d, 0x5a], 0);
  executable.writeUInt32LE(0x80, 0x3c);
  executable.writeUInt32LE(0x00004550, 0x80);
  executable.writeUInt16LE(machine, 0x84);
  return executable;
}
