import type { CacheAction } from "./command";

export type OptionSpecCommand = "scan" | "ci" | "diff" | "explain";

const SCAN_AND_CI_OPTIONS = [
  "--profile",
  "--prod",
  "--all",
  "--policy",
  "--config",
  "--offline",
  "--cache-dir",
  "--jobs",
  "--timeout",
  "--registry-url",
  "--registry-token-env",
  "--allow-host",
  "--json",
  "--sarif",
  "--markdown",
  "--html",
  "--language",
  "--cyclonedx",
  "--no-waivers",
  "--lockfile",
  "--archive",
  "--workspace-root",
  "--output",
  "--open",
  "--help",
  "-h"
] as const;

const COMMAND_OPTIONS = {
  scan: [...SCAN_AND_CI_OPTIONS, "--repo", "--submodules"],
  ci: [
    ...SCAN_AND_CI_OPTIONS,
    "--fail-on",
    "--strict-waivers",
    "--allow-partial-evidence"
  ],
  diff: [
    "--profile",
    "--prod",
    "--lockfile",
    "--all",
    "--policy",
    "--config",
    "--offline",
    "--cache-dir",
    "--jobs",
    "--timeout",
    "--registry-url",
    "--registry-token-env",
    "--allow-host",
    "--workspace-root",
    "--json",
    "--markdown",
    "--output",
    "--fail-on",
    "--help",
    "-h"
  ],
  explain: [
    "--profile",
    "--policy",
    "--workspace-root",
    "--json",
    "--output",
    "--help",
    "-h"
  ]
} as const satisfies Record<OptionSpecCommand, readonly string[]>;

const CACHE_OPTIONS = {
  status: ["--cache-dir", "--json", "--help", "-h"],
  prune: ["--cache-dir", "--json", "--max-size", "--max-age", "--help", "-h"],
  clear: ["--cache-dir", "--json", "--help", "-h"]
} as const satisfies Record<CacheAction, readonly string[]>;

export function supportedOptionsFor(kind: OptionSpecCommand): string[] {
  return [...COMMAND_OPTIONS[kind]];
}

export function supportedCacheOptions(action: CacheAction): string[] {
  return [...CACHE_OPTIONS[action]];
}
