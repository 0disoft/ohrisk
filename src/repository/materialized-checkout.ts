import { lstatSync, readdirSync, type Stats } from "node:fs";
import path from "node:path";

import { err, ok, type Result } from "../shared/result";
import type { RepositoryTreeEntry, RepositoryTreeInventory } from "./tree-inventory";

export type MaterializedCheckoutIssue = {
  reason:
    | "materialized_entry_count"
    | "materialized_file_size"
    | "materialized_total_file_size"
    | "materialized_staging_size"
    | "materialized_symbolic_link"
    | "materialized_special_file";
  actual?: number;
  limit?: number;
};

export type MaterializedCheckoutInspection = {
  stagingBytes: number;
  repositoryBytes: number;
  inventory: RepositoryTreeInventory;
};

type CheckoutFileSystem = {
  readDirectory: (directory: string) => string[];
  readStats: (entryPath: string) => Pick<
    Stats,
    "size" | "isDirectory" | "isFile" | "isSymbolicLink"
  >;
};

const NODE_FILE_SYSTEM: CheckoutFileSystem = {
  readDirectory: (directory) => readdirSync(directory),
  readStats: (entryPath) => lstatSync(entryPath)
};

export function inspectMaterializedCheckout(input: {
  stagingRoot: string;
  repositoryRoot: string;
  maxStagingBytes: number;
  maxRepositoryBytes: number;
  maxFileBytes: number;
  maxRepositoryEntries: number;
  fileSystem?: CheckoutFileSystem;
}): Result<MaterializedCheckoutInspection, MaterializedCheckoutIssue> {
  const fileSystem = input.fileSystem ?? NODE_FILE_SYSTEM;
  const pending = [input.stagingRoot];
  const directories = new Map<string, RepositoryTreeEntry[]>();
  let stagingBytes = 0;
  let repositoryBytes = 0;
  let repositoryEntries = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    const relativeDirectory = repositoryRelativePath(input.repositoryRoot, directory);
    const tracksRepository = relativeDirectory !== undefined && !isGitMetadata(relativeDirectory);
    const inventoryEntries: RepositoryTreeEntry[] = [];

    for (const name of fileSystem.readDirectory(directory)) {
      const entryPath = path.join(directory, name);
      const relativeEntry = repositoryRelativePath(input.repositoryRoot, entryPath);
      const tracksEntry = relativeEntry !== undefined
        && relativeEntry !== ""
        && !isGitMetadata(relativeEntry);
      const stats = fileSystem.readStats(entryPath);

      if (stats.isSymbolicLink()) {
        if (tracksEntry) return err({ reason: "materialized_symbolic_link" });
        continue;
      }

      if (stats.isDirectory()) {
        if (tracksEntry) {
          repositoryEntries += 1;
          if (repositoryEntries > input.maxRepositoryEntries) {
            return err(limitIssue(
              "materialized_entry_count",
              repositoryEntries,
              input.maxRepositoryEntries
            ));
          }
          if (tracksRepository) inventoryEntries.push({ name, kind: "directory" });
        }
        pending.push(entryPath);
        continue;
      }

      if (!stats.isFile()) {
        if (tracksEntry) return err({ reason: "materialized_special_file" });
        continue;
      }

      stagingBytes += stats.size;
      if (stagingBytes > input.maxStagingBytes) {
        return err(limitIssue(
          "materialized_staging_size",
          stagingBytes,
          input.maxStagingBytes
        ));
      }
      if (!tracksEntry) continue;

      repositoryEntries += 1;
      if (repositoryEntries > input.maxRepositoryEntries) {
        return err(limitIssue(
          "materialized_entry_count",
          repositoryEntries,
          input.maxRepositoryEntries
        ));
      }
      if (stats.size > input.maxFileBytes) {
        return err(limitIssue("materialized_file_size", stats.size, input.maxFileBytes));
      }
      repositoryBytes += stats.size;
      if (repositoryBytes > input.maxRepositoryBytes) {
        return err(limitIssue(
          "materialized_total_file_size",
          repositoryBytes,
          input.maxRepositoryBytes
        ));
      }
      if (tracksRepository) inventoryEntries.push({ name, kind: "file" });
    }

    if (tracksRepository) directories.set(directory, inventoryEntries);
  }

  return ok({
    stagingBytes,
    repositoryBytes,
    inventory: {
      rootDir: input.repositoryRoot,
      directories,
      entryCount: repositoryEntries
    }
  });
}

function repositoryRelativePath(repositoryRoot: string, candidate: string): string | undefined {
  const relative = path.relative(repositoryRoot, candidate);
  if (relative === "") return "";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative;
}

function isGitMetadata(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`);
}

function limitIssue(
  reason: MaterializedCheckoutIssue["reason"],
  actual: number,
  limit: number
): MaterializedCheckoutIssue {
  return { reason, actual, limit };
}
