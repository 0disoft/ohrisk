import { describe, expect, test } from "bun:test";
import path from "node:path";

import { inspectMaterializedCheckout } from "../src/repository/materialized-checkout";

describe("materialized repository checkout inspection", () => {
  test("measures staging storage and builds the repository inventory in one directory pass", () => {
    const stagingRoot = path.resolve("staging");
    const repositoryRoot = path.join(stagingRoot, "repository");
    const directories = new Map<string, string[]>([
      [stagingRoot, ["checkout-pathspec", "repository"]],
      [repositoryRoot, [".git", "package.json", "src"]],
      [path.join(repositoryRoot, ".git"), ["index"]],
      [path.join(repositoryRoot, "src"), ["lock.json"]]
    ]);
    const fileSizes = new Map<string, number>([
      [path.join(stagingRoot, "checkout-pathspec"), 10],
      [path.join(repositoryRoot, ".git", "index"), 30],
      [path.join(repositoryRoot, "package.json"), 20],
      [path.join(repositoryRoot, "src", "lock.json"), 40]
    ]);
    const visitedDirectories: string[] = [];

    const inspected = inspectMaterializedCheckout({
      stagingRoot,
      repositoryRoot,
      maxStagingBytes: 100,
      maxRepositoryBytes: 60,
      maxFileBytes: 40,
      maxRepositoryEntries: 3,
      fileSystem: {
        readDirectory: (directory) => {
          visitedDirectories.push(directory);
          return directories.get(directory) ?? [];
        },
        readStats: (entryPath) => stats(
          fileSizes.get(entryPath),
          directories.has(entryPath)
        )
      }
    });

    expect(inspected.ok).toBe(true);
    if (!inspected.ok) throw new Error(inspected.error.reason);
    expect(inspected.value.stagingBytes).toBe(100);
    expect(inspected.value.repositoryBytes).toBe(60);
    expect(inspected.value.inventory.entryCount).toBe(3);
    expect(inspected.value.inventory.directories.get(repositoryRoot)).toEqual([
      { name: "package.json", kind: "file" },
      { name: "src", kind: "directory" }
    ]);
    expect(inspected.value.inventory.directories.has(path.join(repositoryRoot, ".git"))).toBe(false);
    expect(visitedDirectories).toHaveLength(new Set(visitedDirectories).size);
    expect(new Set(visitedDirectories)).toEqual(new Set(directories.keys()));
  });

  test("keeps repository safety and storage limits fail-closed", () => {
    const stagingRoot = path.resolve("limited-staging");
    const repositoryRoot = path.join(stagingRoot, "repository");
    const base = {
      stagingRoot,
      repositoryRoot,
      maxStagingBytes: 9,
      maxRepositoryBytes: 8,
      maxFileBytes: 8,
      maxRepositoryEntries: 1
    };

    const oversized = inspectMaterializedCheckout({
      ...base,
      fileSystem: fakeFileSystem({
        [stagingRoot]: ["repository"],
        [repositoryRoot]: ["package.json"]
      }, {
        [path.join(repositoryRoot, "package.json")]: 10
      })
    });
    expect(oversized).toEqual({
      ok: false,
      error: { reason: "materialized_staging_size", actual: 10, limit: 9 }
    });

    const symbolicLink = inspectMaterializedCheckout({
      ...base,
      maxStagingBytes: 10,
      fileSystem: {
        ...fakeFileSystem({
          [stagingRoot]: ["repository"],
          [repositoryRoot]: ["linked"]
        }, {}),
        readStats: (entryPath) => entryPath.endsWith("linked")
          ? stats(undefined, false, true)
          : stats(undefined, true)
      }
    });
    expect(symbolicLink).toEqual({
      ok: false,
      error: { reason: "materialized_symbolic_link" }
    });
  });
});

function fakeFileSystem(
  directories: Record<string, string[]>,
  fileSizes: Record<string, number>
) {
  return {
    readDirectory: (directory: string) => directories[directory] ?? [],
    readStats: (entryPath: string) => stats(
      fileSizes[entryPath],
      Object.hasOwn(directories, entryPath)
    )
  };
}

function stats(size: number | undefined, directory: boolean, symbolicLink = false) {
  return {
    size: size ?? 0,
    isDirectory: () => directory,
    isFile: () => size !== undefined,
    isSymbolicLink: () => symbolicLink
  };
}
