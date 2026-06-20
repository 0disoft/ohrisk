import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { discoverProject } from "../src/project/discover";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("discoverProject", () => {
  test("finds a bun.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "bun-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "bun-project"));
    expect(result.value.lockfile.kind).toBe("bun");
    expect(path.basename(result.value.lockfile.path)).toBe("bun.lock");
  });

  test("finds a package-lock.json project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "package-lock-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "package-lock-project"));
    expect(result.value.lockfile.kind).toBe("package-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("package-lock.json");
  });

  test("finds an npm-shrinkwrap.json project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-npm-shrinkwrap-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "fixture-npm-shrinkwrap-project" }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "npm-shrinkwrap.json"),
        JSON.stringify({
          name: "fixture-npm-shrinkwrap-project",
          lockfileVersion: 3,
          packages: {
            "": {
              name: "fixture-npm-shrinkwrap-project"
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("npm-shrinkwrap");
      expect(path.basename(result.value.lockfile.path)).toBe("npm-shrinkwrap.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a pnpm-lock.yaml project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "pnpm-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "pnpm-project"));
    expect(result.value.lockfile.kind).toBe("pnpm-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("pnpm-lock.yaml");
  });

  test("finds a Yarn v1 yarn.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "yarn-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "yarn-project"));
    expect(result.value.lockfile.kind).toBe("yarn-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("yarn.lock");
  });

  test("finds a Deno deno.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "deno-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "deno-project"));
    expect(result.value.lockfile.kind).toBe("deno-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("deno.lock");
  });

  test("walks up from a nested directory", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "bun-project", "packages", "app") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "bun-project"));
  });

  test("rejects projects without a supported lockfile", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "no-lockfile") });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
  });

  test("rejects projects with multiple lockfiles", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "multiple-lockfiles") });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("MULTIPLE_LOCKFILES");
  });

  test("uses an explicit lockfile path when a project has multiple lockfiles", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "package-lock.json"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "multiple-lockfiles"));
    expect(result.value.lockfile.kind).toBe("package-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("package-lock.json");
  });

  test("rejects unsupported explicit lockfile paths", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "Cargo.lock"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("UNSUPPORTED_LOCKFILE");
  });

  test("rejects missing explicit lockfile paths", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "pnpm-lock.yaml"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("LOCKFILE_NOT_FOUND");
  });

  test("rejects explicit lockfile paths that are directories", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-lockfile-directory-"));
    mkdirSync(path.join(projectDir, "package-lock.json"));

    const result = discoverProject({
      cwd: projectDir,
      lockfilePath: "package-lock.json"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("LOCKFILE_NOT_FILE");
    expect(result.error.details).toMatchObject({
      lockfilePath: path.join(projectDir, "package-lock.json")
    });
  });

  test("ignores known lockfile names that are directories during project discovery", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-lockfile-directory-discovery-"));
    writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "directory-lockfile" }));
    mkdirSync(path.join(projectDir, "bun.lock"));

    const result = discoverProject({ cwd: projectDir });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
    expect(result.error.details).toMatchObject({
      rootDir: projectDir
    });
  });
});
