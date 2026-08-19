import type { CacheAction, HelpTarget } from "./command";
import { USAGE_PROFILES, type UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import {
  DEFAULT_REPORT_LANGUAGE,
  type ReportLanguage
} from "../report/language";
import type { RepositorySubmoduleMode } from "../repository/github-repository";

export type OptionSpecCommand = "init" | "scan" | "ci" | "diff" | "explain";

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

export const CLI_FAIL_ON_SEVERITIES: readonly RiskSeverity[] = [
  "high",
  "unknown",
  "review",
  "low"
];

export const ACTION_COMMANDS = ["scan", "ci", "diff"] as const;

export const ACTION_REPORT_FORMATS = [
  "text",
  "json",
  "sarif",
  "markdown",
  "html",
  "cyclonedx"
] as const;

export const ACTION_DIFF_REPORT_FORMATS = ["text", "json", "markdown"] as const;

export const ACTION_BOOLEAN_INPUTS = [
  "setup-node",
  "prod",
  "all",
  "no-waivers",
  "strict-waivers",
  "allow-partial-evidence",
  "offline"
] as const satisfies readonly (keyof typeof ACTION_INPUT_DEFAULTS)[];

export const ACTION_PROFILE_VALUES = USAGE_PROFILES;

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
  init: [],
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
  init: "ohrisk init [--profile saas|distributed-app] [--fail-on high|unknown|review|low] [--no-workflow] [--waivers]",
  scan: "ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
  ci: "ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--allow-partial-evidence] [--output <file>] [--open]",
  diff: "ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
  explain: "ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
  cache: "ohrisk cache status|prune|clear [--cache-dir <path>] [--json]",
  help: "ohrisk help [command]",
  version: "ohrisk version"
} as const satisfies Record<HelpTarget, string>;

export const COMMAND_DESCRIPTIONS = {
  init: "Create a project policy and pull-request workflow.",
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

type HelpSurface = "top" | HelpTarget;

type HelpOptionSpec = {
  options: readonly string[];
  syntax: string;
  description: string;
  overrides?: Partial<Record<HelpSurface, string>>;
};

const HELP_OPTION_SPECS = {
  profile: {
    options: ["--profile"],
    syntax: "--profile <profile>",
    description: `Usage profile. Defaults to ${CLI_DEFAULTS.profile}.`
  },
  lockfile: {
    options: ["--lockfile"],
    syntax: "--lockfile <path>",
    description: "Use a specific supported lockfile path."
  },
  archive: {
    options: ["--archive"],
    syntax: "--archive <path>",
    description: "Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk."
  },
  repo: {
    options: ["--repo"],
    syntax: "--repo <url>",
    description: "Scan public GitHub; auto-select one nested dependency project."
  },
  submodules: {
    options: ["--submodules"],
    syntax: "--submodules <mode>",
    description: "Ignore with an incomplete-coverage warning (default), or reject."
  },
  all: {
    options: ["--all"],
    syntax: "--all",
    description: "Discover and merge every supported lockfile in the project root.",
    overrides: { diff: "Compare every supported lockfile in both revisions." }
  },
  policy: {
    options: ["--policy", "--config"],
    syntax: "--policy <path>",
    description: "Use a workspace-contained policy file instead of .ohrisk.yml.",
    overrides: { explain: "Apply license rules from a workspace-contained policy file." }
  },
  workspaceRoot: {
    options: ["--workspace-root"],
    syntax: "--workspace-root <path>",
    description: "Trust local file: package evidence inside this workspace root.",
    overrides: { explain: "Set the boundary for local policy inheritance." }
  },
  prod: {
    options: ["--prod"],
    syntax: "--prod",
    description: "Exclude development-only dependencies."
  },
  noWaivers: {
    options: ["--no-waivers"],
    syntax: "--no-waivers",
    description: "Ignore local .ohrisk-waivers.json files."
  },
  offline: {
    options: ["--offline"],
    syntax: "--offline",
    description: "Disable network requests and use local or cached evidence only."
  },
  cacheDir: {
    options: ["--cache-dir"],
    syntax: "--cache-dir <path>",
    description: "Use a persistent artifact cache directory.",
    overrides: { cache: "Manage this cache directory instead of the default cache." }
  },
  jobs: {
    options: ["--jobs"],
    syntax: "--jobs <1..64>",
    description: "Set evidence collection concurrency. Defaults to 8."
  },
  timeout: {
    options: ["--timeout"],
    syntax: "--timeout <duration>",
    description: "Set the per-request timeout from 100ms to 10m."
  },
  registryUrl: {
    options: ["--registry-url"],
    syntax: "--registry-url <url>",
    description: "Use an HTTPS npm-compatible registry base URL."
  },
  registryTokenEnv: {
    options: ["--registry-token-env"],
    syntax: "--registry-token-env <name>",
    description: "Read a registry bearer token from this environment variable."
  },
  allowHost: {
    options: ["--allow-host"],
    syntax: "--allow-host <hostname>",
    description: "Add an artifact hostname to the allowlist; repeatable."
  },
  json: {
    options: ["--json"],
    syntax: "--json",
    description: "Print machine-readable output.",
    overrides: { cache: "Print machine-readable output without an absolute cache path." }
  },
  sarif: {
    options: ["--sarif"],
    syntax: "--sarif",
    description: "Print SARIF 2.1.0 output for code scanning upload."
  },
  markdown: {
    options: ["--markdown"],
    syntax: "--markdown",
    description: "Print a Markdown report for PRs or release notes."
  },
  html: {
    options: ["--html"],
    syntax: "--html",
    description: "Render HTML; remote scans save it in the current directory.",
    overrides: {
      scan: "Render HTML; remote scans default to <repository>-ohrisk.html.",
      ci: "Print a browser-friendly HTML report."
    }
  },
  language: {
    options: ["--language"],
    syntax: "--language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de>",
    description: `Set the HTML report language. Defaults to ${CLI_DEFAULTS.reportLanguage}.`
  },
  cyclonedx: {
    options: ["--cyclonedx"],
    syntax: "--cyclonedx",
    description: "Print a CycloneDX 1.5 SBOM as JSON."
  },
  output: {
    options: ["--output"],
    syntax: "--output <file>",
    description: "Write report output to a project-relative file instead of stdout."
  },
  open: {
    options: ["--open"],
    syntax: "--open",
    description: "Open the written HTML report after scan completion."
  },
  failOn: {
    options: ["--fail-on"],
    syntax: "--fail-on <severity>",
    description: `CI threshold. Defaults to ${CLI_DEFAULTS.failOn} for ci.`,
    overrides: {
      ci: `CI threshold. Defaults to ${CLI_DEFAULTS.failOn}.`,
      diff: "Optional diff threshold."
    }
  },
  allowPartialEvidence: {
    options: ["--allow-partial-evidence"],
    syntax: "--allow-partial-evidence",
    description: "Let ci pass when evidence or repository coverage is partial."
  },
  strictWaivers: {
    options: ["--strict-waivers"],
    syntax: "--strict-waivers",
    description: "Fail CI when local waivers are expired or unmatched."
  },
  maxSize: {
    options: ["--max-size"],
    syntax: "--max-size <size>",
    description: "Keep cache objects within a size such as 512MiB or 2GB."
  },
  maxAge: {
    options: ["--max-age"],
    syntax: "--max-age <duration>",
    description: "Remove entries unused for a duration such as 24h or 7d."
  },
  noWorkflow: {
    options: ["--no-workflow"],
    syntax: "--no-workflow",
    description: "Create local configuration without a GitHub Actions workflow."
  },
  waiverTemplate: {
    options: ["--waivers"],
    syntax: "--waivers",
    description: "Create an empty .ohrisk-waivers.json decision-record template."
  },
  help: {
    options: ["--help", "-h"],
    syntax: "--help, -h",
    description: "Print this help text."
  },
  version: {
    options: ["--version", "-v"],
    syntax: "--version, -v",
    description: "Print the Ohrisk package version."
  }
} as const satisfies Record<string, HelpOptionSpec>;

type HelpOptionKey = keyof typeof HELP_OPTION_SPECS;

const HELP_OPTION_ORDER = {
  top: [
    "profile", "lockfile", "archive", "repo", "submodules", "all", "policy",
    "workspaceRoot", "prod", "noWaivers", "offline", "cacheDir", "jobs", "timeout",
    "registryUrl", "registryTokenEnv", "allowHost", "json", "sarif", "markdown", "html",
    "language", "cyclonedx", "output", "open", "failOn", "allowPartialEvidence",
    "strictWaivers", "noWorkflow", "waiverTemplate", "help", "version"
  ],
  init: ["profile", "failOn", "noWorkflow", "waiverTemplate", "help"],
  scan: [
    "profile", "lockfile", "archive", "repo", "submodules", "all", "policy",
    "workspaceRoot", "prod", "noWaivers", "offline", "cacheDir", "jobs", "timeout",
    "registryUrl", "registryTokenEnv", "allowHost", "json", "sarif", "markdown", "html",
    "language", "cyclonedx", "output", "open", "help"
  ],
  ci: [
    "profile", "lockfile", "archive", "all", "policy", "workspaceRoot", "prod", "noWaivers",
    "offline", "cacheDir", "jobs", "timeout", "registryUrl", "registryTokenEnv", "allowHost",
    "json", "sarif", "markdown", "html", "language", "cyclonedx", "failOn",
    "allowPartialEvidence", "strictWaivers", "output", "open", "help"
  ],
  diff: [
    "profile", "lockfile", "all", "policy", "workspaceRoot", "prod", "offline", "cacheDir",
    "jobs", "timeout", "registryUrl", "registryTokenEnv", "allowHost", "json", "markdown",
    "failOn", "output", "help"
  ],
  cache: ["cacheDir", "maxSize", "maxAge", "json", "help"],
  explain: ["profile", "policy", "workspaceRoot", "json", "output", "help"],
  help: ["help"],
  version: ["help"]
} as const satisfies Record<HelpSurface, readonly HelpOptionKey[]>;

export const CACHE_ACTION_DESCRIPTIONS = {
  status: "Show entry, object, size, freshness, and corruption counts.",
  prune: "Remove expired, old, orphaned, or least-recently-used entries.",
  clear: "Remove all Ohrisk cache entries and objects."
} as const satisfies Record<CacheAction, string>;

export function helpOptionLinesFor(target: HelpSurface): string[] {
  const width = target === "cache" ? 22 : 23;
  return HELP_OPTION_ORDER[target].map((key) => {
    const spec: HelpOptionSpec = HELP_OPTION_SPECS[key];
    const description = spec.overrides?.[target] ?? spec.description;
    return `  ${spec.syntax.padEnd(width, " ")}${description}`;
  });
}

const SCAN_AND_CI_OPTION_KEYS = [
  "profile", "prod", "all", "policy", "offline", "cacheDir", "jobs", "timeout",
  "registryUrl", "registryTokenEnv", "allowHost", "json", "sarif", "markdown", "html",
  "language", "cyclonedx", "noWaivers", "lockfile", "archive", "workspaceRoot", "output",
  "open", "help"
] as const satisfies readonly HelpOptionKey[];

const COMMAND_OPTION_KEYS = {
  init: ["profile", "failOn", "noWorkflow", "waiverTemplate", "help"],
  scan: [...SCAN_AND_CI_OPTION_KEYS, "repo", "submodules"],
  ci: [
    ...SCAN_AND_CI_OPTION_KEYS,
    "failOn",
    "strictWaivers",
    "allowPartialEvidence"
  ],
  diff: [
    "profile", "prod", "lockfile", "all", "policy", "offline", "cacheDir", "jobs", "timeout",
    "registryUrl", "registryTokenEnv", "allowHost", "workspaceRoot", "json", "markdown", "output",
    "failOn", "help"
  ],
  explain: [
    "profile", "policy", "workspaceRoot", "json", "output", "help"
  ]
} as const satisfies Record<OptionSpecCommand, readonly HelpOptionKey[]>;

const CACHE_OPTION_KEYS = {
  status: ["cacheDir", "json", "help"],
  prune: ["cacheDir", "json", "maxSize", "maxAge", "help"],
  clear: ["cacheDir", "json", "help"]
} as const satisfies Record<CacheAction, readonly HelpOptionKey[]>;

export function supportedOptionsFor(kind: OptionSpecCommand): string[] {
  return COMMAND_OPTION_KEYS[kind].flatMap((key) => [...HELP_OPTION_SPECS[key].options]);
}

export function supportedCacheOptions(action: CacheAction): string[] {
  return CACHE_OPTION_KEYS[action].flatMap((key) => [...HELP_OPTION_SPECS[key].options]);
}

export function documentedOptionsFor(kind: OptionSpecCommand): string[] {
  return HELP_OPTION_ORDER[kind].map((key) => HELP_OPTION_SPECS[key].options[0]);
}
