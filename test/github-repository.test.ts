import { describe, expect, test } from "bun:test";

import {
  checkoutArguments,
  cloneArguments,
  parseGitHubRepositoryUrl,
  treeArguments,
  validateGitTree
} from "../src/repository/github-repository";

const OBJECT_ID = "0123456789abcdef0123456789abcdef01234567";

describe("GitHub repository input", () => {
  test("accepts and canonicalizes public GitHub HTTPS repository URLs", () => {
    for (const value of [
      "https://github.com/0disoft/laqu",
      "https://github.com/0disoft/laqu.git",
      "https://GITHUB.com/0disoft/laqu.git/"
    ]) {
      const parsed = parseGitHubRepositoryUrl(value);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.error.message);
      expect(parsed.value).toEqual({
        url: "https://github.com/0disoft/laqu.git",
        owner: "0disoft",
        name: "laqu"
      });
    }
  });

  test("rejects alternate protocols, hosts, credentials, ports, and URL decorations", () => {
    for (const value of [
      "http://github.com/0disoft/laqu.git",
      "ssh://git@github.com/0disoft/laqu.git",
      "https://gitlab.com/0disoft/laqu.git",
      "https://user:secret@github.com/0disoft/laqu.git",
      "https://github.com:443/0disoft/laqu.git",
      "https://github.com/0disoft/laqu.git?ref=main",
      "https://github.com/0disoft/laqu.git#main",
      "https://github.com/0disoft/laqu/extra",
      "file:///tmp/repository"
    ]) {
      const parsed = parseGitHubRepositoryUrl(value);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error(`Expected ${value} to be rejected.`);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(JSON.stringify(parsed.error.details)).not.toContain("secret");
    }
  });

  test("builds shallow non-interactive Git commands without submodules", () => {
    const clone = cloneArguments("https://github.com/0disoft/laqu.git", "temporary-repository");
    expect(clone).toContain("protocol.allow=never");
    expect(clone).toContain("protocol.https.allow=always");
    expect(clone).toContain("credential.helper=");
    expect(clone).toContain("core.longpaths=true");
    expect(clone).toContain("core.symlinks=false");
    expect(clone).toContain("--depth");
    expect(clone).toContain("--single-branch");
    expect(clone).toContain("--no-checkout");
    expect(clone).toContain("--no-recurse-submodules");
    expect(clone).not.toContain("--recurse-submodules");

    expect(treeArguments("temporary-repository")).toContain("ls-tree");
    expect(checkoutArguments("temporary-repository")).toEqual(expect.arrayContaining([
      "checkout",
      "--force",
      "--detach",
      "HEAD"
    ]));
  });

  test("accepts a bounded portable regular-file tree", () => {
    const validated = validateGitTree(treeBuffer([
      treeEntry("100644", "blob", 42, "package.json"),
      treeEntry("100755", "blob", 128, "scripts/check.ts")
    ]));
    expect(validated).toEqual({ ok: true, value: undefined });
  });

  test("rejects symlinks, submodules, unsafe names, and compatibility collisions", () => {
    const cases = [
      [treeEntry("120000", "blob", 6, "linked")],
      [treeEntry("160000", "commit", 0, "vendor/module")],
      [treeEntry("100644", "blob", 1, "NUL.txt")],
      [treeEntry("100644", "blob", 1, "dir/name. ")],
      [
        treeEntry("100644", "blob", 1, "Docs/readme.md"),
        treeEntry("100644", "blob", 1, "docs/guide.md")
      ],
      [
        treeEntry("100644", "blob", 1, "café.txt"),
        treeEntry("100644", "blob", 1, "cafe\u0301.txt")
      ]
    ];

    for (const entries of cases) {
      const validated = validateGitTree(treeBuffer(entries));
      expect(validated.ok).toBe(false);
      if (validated.ok) throw new Error("Expected unsafe repository tree to fail.");
      expect(validated.error.code).toBe("REPOSITORY_TREE_INVALID");
    }
  });

  test("rejects oversized files and malformed non-NUL-terminated tree output", () => {
    const oversized = validateGitTree(treeBuffer([
      treeEntry("100644", "blob", (50 * 1024 * 1024) + 1, "large.bin")
    ]));
    expect(oversized.ok).toBe(false);
    if (oversized.ok) throw new Error("Expected oversized tree to fail.");
    expect(oversized.error.code).toBe("REPOSITORY_LIMIT_EXCEEDED");

    const malformed = validateGitTree(Buffer.from(
      treeEntry("100644", "blob", 1, "package.json"),
      "utf8"
    ));
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("Expected malformed tree output to fail.");
    expect(malformed.error.details?.reason).toBe("malformed_tree_output");
  });
});

function treeEntry(mode: string, type: string, size: number, filePath: string): string {
  return `${mode} ${type} ${OBJECT_ID} ${size}\t${filePath}`;
}

function treeBuffer(entries: string[]): Buffer {
  return Buffer.from(`${entries.join("\0")}\0`, "utf8");
}
