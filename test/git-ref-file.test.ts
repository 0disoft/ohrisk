import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readGitRefFile } from "../src/git/ref-file";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("readGitRefFile", () => {
  test("reads a baseline file for a project below the git root", () => {
    const result = readGitRefFile({
      projectRoot: path.join(fixturesDir, "bun-project"),
      ref: "HEAD",
      relativePath: "bun.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toContain('"name": "fixture-bun-project"');
  });

  test("does not treat option-like refs as git show options", () => {
    const result = readGitRefFile({
      projectRoot: path.join(fixturesDir, "bun-project"),
      ref: "--format=%H",
      relativePath: "bun.lock"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected option-like ref to fail instead of returning git show output.");
    }

    expect(result.error.code).toBe("GIT_REF_READ_FAILED");
    expect(result.error.message).toBe("Failed to read the baseline file from the requested git ref.");
  });

  test("reports missing files in a baseline ref distinctly", () => {
    const result = readGitRefFile({
      projectRoot: path.join(fixturesDir, "bun-project"),
      ref: "HEAD",
      relativePath: "missing.lock"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected a missing baseline file to fail.");
    }

    expect(result.error.code).toBe("GIT_REF_FILE_NOT_FOUND");
  });

  test("rejects baseline paths that escape the project root", () => {
    const result = readGitRefFile({
      projectRoot: path.join(fixturesDir, "bun-project"),
      ref: "HEAD",
      relativePath: "../baseline-bun.lock"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an escaping baseline path to fail.");
    }

    expect(result.error.code).toBe("GIT_REF_PATH_OUTSIDE_PROJECT");
  });

  test("rejects absolute baseline paths", () => {
    const result = readGitRefFile({
      projectRoot: path.join(fixturesDir, "bun-project"),
      ref: "HEAD",
      relativePath: path.join(fixturesDir, "baseline-bun.lock")
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an absolute baseline path to fail.");
    }

    expect(result.error.code).toBe("GIT_REF_PATH_OUTSIDE_PROJECT");
  });
});
