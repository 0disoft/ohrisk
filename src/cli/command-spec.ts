import type { CacheAction, HelpTarget } from "./command";

export type OptionSpecCommand = "scan" | "ci" | "diff" | "explain";

export const COMMAND_USAGE = {
  scan: "ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
  ci: "ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--allow-partial-evidence] [--output <file>] [--open]",
  diff: "ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
  explain: "ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
  cache: "ohrisk cache status|prune|clear [--cache-dir <path>] [--json]",
  help: "ohrisk help [command]",
  version: "ohrisk version"
} as const satisfies Record<HelpTarget, string>;

export const COMMAND_DESCRIPTIONS = {
  scan: "Find the current project and prepare a license-risk scan.",
  ci: "Run a scan and exit non-zero when findings meet the fail threshold.",
  diff: "Compare current findings against a baseline git ref.",
  explain: "Explain how a license expression is classified for a profile.",
  cache: "Inspect, prune, or clear the persistent artifact cache.",
  help: "Print this help text.",
  version: "Print the Ohrisk package version."
} as const satisfies Record<HelpTarget, string>;

export const COMMAND_DETAIL_USAGE = {
  ...COMMAND_USAGE,
  explain: "ohrisk explain <license-expression> [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--json] [--output <file>]",
  cache: [
    "ohrisk cache status [--cache-dir <path>] [--json]",
    "ohrisk cache prune [--cache-dir <path>] [--max-size <size>] [--max-age <duration>] [--json]",
    "ohrisk cache clear [--cache-dir <path>] [--json]"
  ],
  version: ["ohrisk version", "ohrisk --version", "ohrisk -v"]
} as const satisfies Record<HelpTarget, string | readonly string[]>;

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
