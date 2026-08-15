import path from "node:path";

import type { CliCommand } from "./command";
import {
  defaultArtifactCacheDirectory,
  openArtifactCacheForManagement,
  type ArtifactCacheStatus
} from "../evidence/cache";
import { exitCodeForError, formatError } from "../shared/errors";

type CacheCommandIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env?: Record<string, string | undefined>;
};

export function runCacheCommand(
  command: Extract<CliCommand, { kind: "cache" }>,
  io: CacheCommandIO
): number {
  const env = io.env ?? process.env;
  const configuredCacheDir = command.cacheDir ?? env.OHRISK_CACHE_DIR;
  const cacheDir = configuredCacheDir
    ? path.resolve(io.cwd, configuredCacheDir)
    : defaultArtifactCacheDirectory(env);
  const cache = openArtifactCacheForManagement(cacheDir);
  const location = configuredCacheDir
    ? path.relative(io.cwd, cacheDir) || "."
    : cacheDir;

  if (command.action === "status") {
    const status = cache.status();
    if (!status.ok) {
      io.stderr(formatError(status.error));
      return exitCodeForError(status.error);
    }
    io.stdout(command.json
      ? renderCacheJson("status", configuredCacheDir !== undefined, status.value)
      : renderCacheStatus(status.value, location));
    return 0;
  }

  if (command.action === "prune") {
    const pruned = cache.prune({
      ...(command.maxSizeBytes !== undefined
        ? { maxSizeBytes: command.maxSizeBytes }
        : {}),
      ...(command.maxAgeMs !== undefined ? { maxAgeMs: command.maxAgeMs } : {})
    });
    if (!pruned.ok) {
      io.stderr(formatError(pruned.error));
      return exitCodeForError(pruned.error);
    }
    io.stdout(command.json
      ? renderCacheJson("prune", configuredCacheDir !== undefined, pruned.value)
      : [
          "Artifact cache pruned",
          `Location: ${location}`,
          `Entries removed: ${pruned.value.removedEntryCount}`,
          `Objects removed: ${pruned.value.removedObjectCount}`,
          `Bytes removed: ${formatByteCount(pruned.value.removedBytes)}`,
          `Remaining entries: ${pruned.value.after.entryCount}`,
          `Remaining size: ${formatByteCount(pruned.value.after.totalBytes)}`
        ].join("\n"));
    return 0;
  }

  const cleared = cache.clear();
  if (!cleared.ok) {
    io.stderr(formatError(cleared.error));
    return exitCodeForError(cleared.error);
  }
  io.stdout(command.json
    ? renderCacheJson("clear", configuredCacheDir !== undefined, cleared.value)
    : [
        "Artifact cache cleared",
        `Location: ${location}`,
        `Entries removed: ${cleared.value.removedEntryCount}`,
        `Objects removed: ${cleared.value.removedObjectCount}`,
        `Bytes removed: ${formatByteCount(cleared.value.removedBytes)}`
      ].join("\n"));
  return 0;
}

function renderCacheJson(
  action: "status" | "prune" | "clear",
  configured: boolean,
  result: unknown
): string {
  return `${JSON.stringify({
    action,
    cacheLocation: configured ? "configured" : "default",
    result
  }, null, 2)}\n`;
}

function renderCacheStatus(status: ArtifactCacheStatus, location: string): string {
  return [
    "Artifact cache status",
    `Location: ${location}`,
    `Entries: ${status.entryCount}`,
    `Objects: ${status.objectCount}`,
    `Size: ${formatByteCount(status.totalBytes)}`,
    `Orphan objects: ${status.orphanObjectCount}`,
    `Orphan bytes: ${formatByteCount(status.orphanBytes)}`,
    `Stale entries: ${status.staleEntryCount}`,
    `Corrupt entries: ${status.corruptEntryCount}`,
    `Oldest access: ${formatCacheTimestamp(status.oldestAccessedAt)}`,
    `Newest access: ${formatCacheTimestamp(status.newestAccessedAt)}`
  ].join("\n");
}

function formatByteCount(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2);
  return `${formatted} ${units[unitIndex]}`;
}

function formatCacheTimestamp(value: number | undefined): string {
  return value === undefined ? "none" : new Date(value).toISOString();
}
