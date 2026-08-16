import type { CacheAction, HelpTarget } from "./command";
import type { UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import {
  DEFAULT_REPORT_LANGUAGE,
  type ReportLanguage
} from "../report/language";
import type { RepositorySubmoduleMode } from "../repository/github-repository";

export type OptionSpecCommand = "scan" | "ci" | "diff" | "explain";

export type CliDefaults = {
  profile: UsageProfile;
  prodOnly: boolean;
  json: boolean;
  sarif: boolean;
  markdown: boolean;
  html: boolean;
  reportLanguage: ReportLanguage;
  cyclonedx: boolean;
  noWaivers: boolean;
  submoduleMode: RepositorySubmoduleMode;
  allLockfiles: boolean;
  offline: boolean;
  openReport: boolean;
  failOn: RiskSeverity;
  strictWaivers: boolean;
  allowPartialEvidence: boolean;
};

export const CLI_DEFAULTS: CliDefaults = {
  profile: "saas",
  prodOnly: false,
  json: false,
  sarif: false,
  markdown: false,
  html: false,
  reportLanguage: DEFAULT_REPORT_LANGUAGE,
  cyclonedx: false,
  noWaivers: false,
  submoduleMode: "ignore",
  allLockfiles: false,
  offline: false,
  openReport: false,
  failOn: "high",
  strictWaivers: false,
  allowPartialEvidence: false
};

export const ACTION_INPUT_DEFAULTS = {
  version: "bundled",
  "node-version": "24",
  "setup-node": "true",
  command: "ci",
  "baseline-ref": "",
  profile: CLI_DEFAULTS.profile,
  prod: "true",
  "fail-on": "",
  lockfile: "",
  archive: "",
  all: "false",
  policy: "",
  format: "text",
  output: "",
  "no-waivers": "false",
  "strict-waivers": "false",
  "allow-partial-evidence": "false",
  offline: "false",
  "cache-dir": "",
  jobs: "",
  timeout: "",
  "registry-url": "",
  "registry-token-env": "",
  "allow-hosts": ""
} as const;

export type CommandRuleStage = "input" | "scope" | "output";

export type CommandOptionRule = {
  id: string;
  stage: CommandRuleStage;
  commands: readonly OptionSpecCommand[];
  option: string;
  kind: "conflicts" | "requires-all";
  relatedOptions: readonly string[];
  message: string;
};

export const COMMAND_OPTION_RULES: readonly CommandOptionRule[] = [
  {
    id: "all-lockfile-conflict",
    stage: "input",
    commands: ["scan", "ci", "diff"],
    option: "--all",
    kind: "conflicts",
    relatedOptions: ["--lockfile"],
    message: "--all cannot be combined with --lockfile."
  },
  {
    id: "archive-lockfile-conflict",
    stage: "input",
    commands: ["scan", "ci"],
    option: "--archive",
    kind: "conflicts",
    relatedOptions: ["--lockfile"],
    message: "--archive cannot be combined with --lockfile."
  },
  {
    id: "archive-workspace-conflict",
    stage: "input",
    commands: ["scan", "ci"],
    option: "--archive",
    kind: "conflicts",
    relatedOptions: ["--workspace-root"],
    message: "--archive cannot be combined with --workspace-root."
  },
  {
    id: "repository-archive-conflict",
    stage: "input",
    commands: ["scan"],
    option: "--repo",
    kind: "conflicts",
    relatedOptions: ["--archive"],
    message: "Remote repository input cannot be combined with --archive."
  },
  {
    id: "repository-workspace-conflict",
    stage: "scope",
    commands: ["scan"],
    option: "--repo",
    kind: "conflicts",
    relatedOptions: ["--workspace-root"],
    message: "Remote repository input cannot be combined with --workspace-root."
  },
  {
    id: "repository-offline-conflict",
    stage: "scope",
    commands: ["scan"],
    option: "--repo",
    kind: "conflicts",
    relatedOptions: ["--offline"],
    message: "Remote repository input cannot be combined with --offline."
  },
  {
    id: "submodules-repository-requirement",
    stage: "scope",
    commands: ["scan"],
    option: "--submodules",
    kind: "requires-all",
    relatedOptions: ["--repo"],
    message: "--submodules requires a public GitHub repository input."
  },
  {
    id: "waiver-mode-conflict",
    stage: "scope",
    commands: ["ci"],
    option: "--no-waivers",
    kind: "conflicts",
    relatedOptions: ["--strict-waivers"],
    message: "--no-waivers cannot be combined with --strict-waivers."
  },
  {
    id: "open-html-output-requirement",
    stage: "output",
    commands: ["scan", "ci"],
    option: "--open",
    kind: "requires-all",
    relatedOptions: ["--html", "--output"],
    message: "--open requires --html and --output."
  },
  {
    id: "language-html-requirement",
    stage: "output",
    commands: ["scan", "ci"],
    option: "--language",
    kind: "requires-all",
    relatedOptions: ["--html"],
    message: "--language currently requires --html."
  }
];

const OUTPUT_FORMAT_OPTIONS = {
  scan: ["--json", "--sarif", "--markdown", "--html", "--cyclonedx"],
  ci: ["--json", "--sarif", "--markdown", "--html", "--cyclonedx"],
  diff: ["--json", "--markdown"],
  explain: ["--json"]
} as const satisfies Record<OptionSpecCommand, readonly string[]>;

export function outputFormatOptionsFor(kind: OptionSpecCommand): string[] {
  return [...OUTPUT_FORMAT_OPTIONS[kind]];
}

export function findViolatedCommandOptionRule(input: {
  command: OptionSpecCommand;
  stage: CommandRuleStage;
  presentOptions: ReadonlySet<string>;
}): CommandOptionRule | undefined {
  return COMMAND_OPTION_RULES.find((rule) => {
    if (
      rule.stage !== input.stage
      || !rule.commands.includes(input.command)
      || !input.presentOptions.has(rule.option)
    ) {
      return false;
    }

    return rule.kind === "conflicts"
      ? rule.relatedOptions.some((option) => input.presentOptions.has(option))
      : rule.relatedOptions.some((option) => !input.presentOptions.has(option));
  });
}

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
