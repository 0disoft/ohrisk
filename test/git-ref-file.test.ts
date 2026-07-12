import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listGitRefFiles, readGitRefFile } from "../src/git/ref-file";

let repositoryRoot = "";
let projectRoot = "";

beforeEach(() => {
  repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-git-ref-"));
  projectRoot = path.join(repositoryRoot, "apps", "api");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(repositoryRoot, "README.md"), "fixture repository\n", "utf8");
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "fixture-api", version: "1.0.0" }, null, 2),
    "utf8"
  );
  writeFileSync(
    path.join(projectRoot, "package-lock.json"),
    JSON.stringify({
      name: "fixture-api",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture-api", version: "1.0.0" }
      }
    }, null, 2),
    "utf8"
  );
  mkdirSync(path.join(projectRoot, "nested"), { recursive: true });
  writeFileSync(path.join(projectRoot, "nested", "manifest.txt"), "nested file\n", "utf8");

  execFileSync("git", ["init", "--quiet", repositoryRoot]);
  execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "tests@example.com"]);
  execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Ohrisk Tests"]);
  execFileSync("git", ["-C", repositoryRoot, "add", "."]);
  execFileSync("git", ["-C", repositoryRoot, "commit", "--quiet", "-m", "fixture"]);
});

afterEach(() => {
  rmSync(repositoryRoot, { force: true, recursive: true });
});

describe("git ref project files", () => {
  test("reads a baseline file for a project below the git root", () => {
    const result = readGitRefFile({
      projectRoot,
      ref: "HEAD",
      relativePath: "package-lock.json"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toContain('"name": "fixture-api"');
  });

  test("lists files relative to the selected project root", () => {
    const result = listGitRefFiles({ projectRoot, ref: "HEAD" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toEqual([
      "nested/manifest.txt",
      "package-lock.json",
      "package.json"
    ]);
  });

  test("does not treat option-like refs as git options", () => {
    const readResult = readGitRefFile({
      projectRoot,
      ref: "--format=%H",
      relativePath: "package-lock.json"
    });
    const listResult = listGitRefFiles({
      projectRoot,
      ref: "--format=%H"
    });

    expect(readResult.ok).toBe(false);
    if (readResult.ok) {
      throw new Error("Expected option-like ref to fail instead of returning git show output.");
    }
    expect(readResult.error.code).toBe("GIT_REF_READ_FAILED");

    expect(listResult.ok).toBe(false);
    if (listResult.ok) {
      throw new Error("Expected option-like ref to fail instead of returning a file list.");
    }
    expect(listResult.error.code).toBe("GIT_REF_LIST_FAILED");
  });

  test("reports missing files in a baseline ref distinctly", () => {
    const result = readGitRefFile({
      projectRoot,
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
      projectRoot,
      ref: "HEAD",
      relativePath: "../package-lock.json"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an escaping baseline path to fail.");
    }

    expect(result.error.code).toBe("GIT_REF_PATH_OUTSIDE_PROJECT");
  });

  test("rejects absolute baseline paths", () => {
    const result = readGitRefFile({
      projectRoot,
      ref: "HEAD",
      relativePath: path.join(projectRoot, "package-lock.json")
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an absolute baseline path to fail.");
    }

    expect(result.error.code).toBe("GIT_REF_PATH_OUTSIDE_PROJECT");
  });
});
