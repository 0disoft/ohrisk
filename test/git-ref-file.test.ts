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
  });
});
