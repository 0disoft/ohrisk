/**
 * Immutable normalized inventory of a materialized repository tree.
 *
 * Produced once by the remote intake validation walk and consumed by project
 * discovery so the same logical file set is not re-enumerated from the
 * filesystem. The inventory only holds path, entry kind, and bounded size
 * metadata; file contents are never copied.
 */

import path from "node:path";

export type RepositoryTreeEntryKind = "file" | "directory";

export type RepositoryTreeEntry = {
  name: string;
  kind: RepositoryTreeEntryKind;
};

export type RepositoryTreeInventory = {
  rootDir: string;
  directories: ReadonlyMap<string, readonly RepositoryTreeEntry[]>;
  entryCount: number;
};

export function listDirectoryEntries(
  dir: string,
  inventory: RepositoryTreeInventory
): RepositoryTreeEntry[] {
  const entries = inventory.directories.get(dir);
  return entries ? [...entries] : [];
}

export function entryIsFile(entries: readonly RepositoryTreeEntry[], name: string): boolean {
  return entries.some((entry) => entry.name === name && entry.kind === "file");
}

export function entryIsDirectory(
  entries: readonly RepositoryTreeEntry[],
  name: string
): boolean {
  return entries.some((entry) => entry.name === name && entry.kind === "directory");
}

export function entryExists(entries: readonly RepositoryTreeEntry[], name: string): boolean {
  return entries.some((entry) => entry.name === name);
}

export function fileExistsInInventory(
  inventory: RepositoryTreeInventory,
  absolutePath: string
): boolean {
  const relative = path.relative(inventory.rootDir, absolutePath);
  const segments = relative.split(path.sep).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) {
    return false;
  }

  let currentDir = inventory.rootDir;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const entries = inventory.directories.get(currentDir);
    if (!entries?.some((entry) => entry.name === segment && entry.kind === "directory")) {
      return false;
    }
    currentDir = path.join(currentDir, segment);
  }

  const finalName = segments[segments.length - 1];
  return inventory.directories.get(currentDir)
    ?.some((entry) => entry.name === finalName && entry.kind === "file") ?? false;
}
