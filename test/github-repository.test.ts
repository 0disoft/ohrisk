import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkoutArguments,
  checkoutPathspec,
  cloneArguments,
  parseGitHubRepositoryUrl,
  removeMaterializedSymbolicLinks,
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
      "--pathspec-from-file=checkout-pathspec",
      "--pathspec-file-nul",
      "HEAD"
    ]));
    expect(checkoutPathspec([".claude/skills", "fixtures/aux.hcl"]).toString("utf8")).toBe([
      ":(top,glob)**",
      ":(top,exclude,literal).claude/skills",
      ":(top,exclude,literal)fixtures/aux.hcl",
      ""
    ].join("\0"));
  });

  test("accepts a bounded portable regular-file tree", () => {
    const validated = validateGitTree(treeBuffer([
      treeEntry("100644", "blob", 42, "package.json"),
      treeEntry("100755", "blob", 128, "scripts/check.ts")
    ]));
    expect(validated).toEqual({
      ok: true,
      value: {
        submodules: { total: 0, paths: [], pathsTruncated: false },
        symbolicLinks: { total: 0, paths: [], pathsTruncated: false },
        nonPortablePaths: { total: 0, paths: [], pathsTruncated: false },
        checkoutExcludedPaths: [],
        materializedSymbolicLinkPaths: [],
        checkoutBytes: 170,
        checkoutEntryCount: 2
      }
    });
  });

  test("ignores submodule gitlinks only when requested and reports bounded paths", () => {
    const validated = validateGitTree(treeBuffer([
      treeEntry("160000", "commit", "-", "framework"),
      treeEntry("160000", "commit", "-", "tf-psa-crypto"),
      treeEntry("100644", "blob", 42, "package.json")
    ]), { submodules: "ignore" });

    expect(validated).toEqual({
      ok: true,
      value: {
        submodules: {
          total: 2,
          paths: ["framework", "tf-psa-crypto"],
          pathsTruncated: false
        },
        symbolicLinks: { total: 0, paths: [], pathsTruncated: false },
        nonPortablePaths: { total: 0, paths: [], pathsTruncated: false },
        checkoutExcludedPaths: ["framework", "tf-psa-crypto"],
        materializedSymbolicLinkPaths: [],
        checkoutBytes: 42,
        checkoutEntryCount: 1
      }
    });

    const many = validateGitTree(treeBuffer(
      Array.from({ length: 101 }, (_, index) =>
        treeEntry("160000", "commit", "-", `modules/module-${index}`)
      )
    ), { submodules: "ignore" });
    expect(many.ok).toBe(true);
    if (!many.ok) throw new Error(many.error.message);
    expect(many.value.submodules).toMatchObject({
      total: 101,
      pathsTruncated: true
    });
    expect(many.value.submodules.paths).toHaveLength(100);
  });

  test("skips symbolic links without following targets and bounds reported paths", () => {
    const validated = validateGitTree(treeBuffer([
      treeEntry("120000", "blob", 17, ".claude/skills"),
      treeEntry("120000", "blob", 14, "linked-lockfile"),
      treeEntry("100644", "blob", 42, "pnpm-lock.yaml")
    ]));
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.error.message);
    expect(validated.value.symbolicLinks).toEqual({
      total: 2,
      paths: [".claude/skills", "linked-lockfile"],
      pathsTruncated: false
    });
    expect(validated.value.materializedSymbolicLinkPaths).toEqual([
      ".claude/skills",
      "linked-lockfile"
    ]);
    expect(validated.value.checkoutExcludedPaths).toEqual([
      ".claude/skills",
      "linked-lockfile"
    ]);
    expect(validated.value.checkoutBytes).toBe(42);
    expect(validated.value.checkoutEntryCount).toBe(1);

    const many = validateGitTree(treeBuffer(
      Array.from({ length: 101 }, (_, index) =>
        treeEntry("120000", "blob", 8, `links/link-${index}`)
      )
    ));
    expect(many.ok).toBe(true);
    if (!many.ok) throw new Error(many.error.message);
    expect(many.value.symbolicLinks).toMatchObject({ total: 101, pathsTruncated: true });
    expect(many.value.symbolicLinks.paths).toHaveLength(100);
    expect(many.value.materializedSymbolicLinkPaths).toHaveLength(101);
  });

  test("removes materialized symbolic-link entries without touching regular inputs", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-symbolic-links-"));
    try {
      const linkedPath = path.join(repositoryRoot, ".claude", "skills");
      mkdirSync(path.dirname(linkedPath), { recursive: true });
      writeFileSync(linkedPath, "../.agents/skills", "utf8");
      writeFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'", "utf8");

      const removed = removeMaterializedSymbolicLinks(repositoryRoot, [".claude/skills"]);
      expect(removed).toEqual({ ok: true, value: undefined });
      expect(existsSync(linkedPath)).toBe(false);
      expect(existsSync(path.join(repositoryRoot, "pnpm-lock.yaml"))).toBe(true);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("rejects unsafe symbolic-link cleanup paths and non-file materializations", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-symbolic-links-"));
    try {
      expect(removeMaterializedSymbolicLinks(repositoryRoot, ["../outside"]).ok).toBe(false);
      mkdirSync(path.join(repositoryRoot, "linked-directory"));
      const directory = removeMaterializedSymbolicLinks(repositoryRoot, ["linked-directory"]);
      expect(directory.ok).toBe(false);
      if (directory.ok) throw new Error("Expected directory materialization to fail.");
      expect(directory.error.details?.reason).toBe("symbolic_link_materialized_as_special_entry");
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("skips non-portable regular paths while keeping portable dependency inputs", () => {
    const validated = validateGitTree(treeBuffer([
      treeEntry("100644", "blob", 1, "posthog/clickhouse/hcl/golden/local-multi/aux.hcl"),
      treeEntry("100644", "blob", 1, "Docs/readme.md"),
      treeEntry("100644", "blob", 1, "docs/guide.md"),
      treeEntry("100644", "blob", 42, "pnpm-lock.yaml")
    ]));
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error(validated.error.message);
    expect(validated.value.nonPortablePaths).toEqual({
      total: 2,
      paths: [
        "posthog/clickhouse/hcl/golden/local-multi/aux.hcl",
        "docs/guide.md"
      ],
      pathsTruncated: false
    });
    expect(validated.value.checkoutExcludedPaths).toEqual([
      "posthog/clickhouse/hcl/golden/local-multi/aux.hcl",
      "docs/guide.md"
    ]);
    expect(validated.value.checkoutBytes).toBe(43);
    expect(validated.value.checkoutEntryCount).toBe(2);
  });

  test("rejects strict-mode submodules and structurally unsafe names", () => {
    const cases = [
      [treeEntry("160000", "commit", 0, "vendor/module")],
      [treeEntry("100644", "blob", 1, ".git/config")],
      [treeEntry("100644", "blob", 1, "dir/../outside")]
    ];

    for (const entries of cases) {
      const validated = validateGitTree(treeBuffer(entries));
      expect(validated.ok).toBe(false);
      if (validated.ok) throw new Error("Expected unsafe repository tree to fail.");
      expect(validated.error.code).toBe("REPOSITORY_TREE_INVALID");
    }

    const submodule = validateGitTree(treeBuffer([
      treeEntry("160000", "commit", "-", "vendor/module")
    ]));
    expect(submodule.ok).toBe(false);
    if (submodule.ok) throw new Error("Expected strict submodule mode to fail.");
    expect(submodule.error.details).toMatchObject({
      reason: "submodule",
      path: "vendor/module"
    });
  });

  test("rejects oversized files and malformed non-NUL-terminated tree output", () => {
    const oversized = validateGitTree(treeBuffer([
      treeEntry("100644", "blob", (100 * 1024 * 1024) + 1, "large.bin")
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

  test("accepts 625 MiB declared trees and rejects totals above 640 MiB", () => {
    const withinLimit = validateGitTree(treeBuffer([
      ...Array.from({ length: 6 }, (_, index) =>
        treeEntry("100644", "blob", 100 * 1024 * 1024, `large/file-${index}.bin`)
      ),
      treeEntry("100644", "blob", 25 * 1024 * 1024, "large/remainder.bin")
    ]));
    expect(withinLimit.ok).toBe(true);

    const overLimit = validateGitTree(treeBuffer([
      ...Array.from({ length: 6 }, (_, index) =>
        treeEntry("100644", "blob", 100 * 1024 * 1024, `large/file-${index}.bin`)
      ),
      treeEntry("100644", "blob", (40 * 1024 * 1024) + 1, "large/overflow.bin")
    ]));
    expect(overLimit.ok).toBe(false);
    if (overLimit.ok) throw new Error("Expected the declared tree total to fail.");
    expect(overLimit.error.code).toBe("REPOSITORY_LIMIT_EXCEEDED");
    expect(overLimit.error.details?.reason).toBe("total_file_size");
    expect(overLimit.error.details?.limit).toBe(640 * 1024 * 1024);
  });
});

function treeEntry(mode: string, type: string, size: number | "-", filePath: string): string {
  return `${mode} ${type} ${OBJECT_ID} ${size}\t${filePath}`;
}

function treeBuffer(entries: string[]): Buffer {
  return Buffer.from(`${entries.join("\0")}\0`, "utf8");
}
