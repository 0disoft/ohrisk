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
});
