import { describe, expect, test } from "bun:test";
import path from "node:path";
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
});
