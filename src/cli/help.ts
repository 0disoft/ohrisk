import type { HelpTarget } from "./command";
import {
  COMMAND_DESCRIPTIONS,
  COMMAND_DETAIL_USAGE,
  COMMAND_USAGE
} from "./command-spec";

export function renderHelp(target?: HelpTarget): string {
  switch (target) {
    case "scan": return renderScanHelp();
    case "ci": return renderCiHelp();
    case "diff": return renderDiffHelp();
    case "explain": return renderExplainHelp();
    case "cache": return renderCacheHelp();
    case "help": return renderHelpCommandHelp();
    case "version": return renderVersionHelp();
    case undefined: return renderTopLevelHelp();
  }
}

function renderTopLevelHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    ...Object.values(COMMAND_USAGE).map((usage) => `  ${usage}`),
    "",
    "Commands:",
    ...Object.entries(COMMAND_DESCRIPTIONS).map(
      ([command, description]) => `  ${command.padEnd(8, " ")}${description}`
    ),
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --repo <url>           Scan public GitHub; auto-select one nested dependency project.",
    "  --submodules <mode>    Ignore with an incomplete-coverage warning (default), or reject.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Render HTML; remote scans save it in the current directory.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --fail-on <severity>   CI threshold. Defaults to high for ci.",
    "  --allow-partial-evidence  Let ci pass when evidence or repository coverage is partial.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --help, -h             Print this help text.",
    "  --version, -v          Print the Ohrisk package version."
  ].join("\n");
}

function renderScanHelp(): string {
  return [
    "Ohrisk scan",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.scan}`,
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --repo <url>           Scan public GitHub; auto-select one nested dependency project.",
    "  --submodules <mode>    Ignore with an incomplete-coverage warning (default), or reject.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Render HTML; remote scans default to <repository>-ohrisk.html.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderCiHelp(): string {
  return [
    "Ohrisk ci",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.ci}`,
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --archive <path>       Scan a ZIP, TAR, TAR.GZ, or TGZ without extracting it to disk.",
    "  --all                  Discover and merge every supported lockfile in the project root.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --html                 Print a browser-friendly HTML report.",
    "  --language <en|ko|es|fr|zh|hi|ja|id|tr|ru|de> Set the HTML report language. Defaults to en.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --fail-on <severity>   CI threshold. Defaults to high.",
    "  --allow-partial-evidence  Let ci pass when evidence or repository coverage is partial.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --open                 Open the written HTML report after scan completion.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderDiffHelp(): string {
  return [
    "Ohrisk diff",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.diff}`,
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --all                  Compare every supported lockfile in both revisions.",
    "  --policy <path>        Use a workspace-contained policy file instead of .ohrisk.yml.",
    "  --workspace-root <path> Trust local file: package evidence inside this workspace root.",
    "  --prod                 Exclude development-only dependencies.",
    "  --offline             Disable network requests and use local or cached evidence only.",
    "  --cache-dir <path>    Use a persistent artifact cache directory.",
    "  --jobs <1..64>        Set evidence collection concurrency. Defaults to 8.",
    "  --timeout <duration>  Set the per-request timeout from 100ms to 10m.",
    "  --registry-url <url>  Use an HTTPS npm-compatible registry base URL.",
    "  --registry-token-env <name> Read a registry bearer token from this environment variable.",
    "  --allow-host <hostname> Add an artifact hostname to the allowlist; repeatable.",
    "  --json                 Print machine-readable output.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --fail-on <severity>   Optional diff threshold.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderCacheHelp(): string {
  return [
    "Ohrisk cache",
    "",
    "Usage:",
    ...COMMAND_DETAIL_USAGE.cache.map((usage) => `  ${usage}`),
    "",
    "Actions:",
    "  status                Show entry, object, size, freshness, and corruption counts.",
    "  prune                 Remove expired, old, orphaned, or least-recently-used entries.",
    "  clear                 Remove all Ohrisk cache entries and objects.",
    "",
    "Options:",
    "  --cache-dir <path>    Manage this cache directory instead of the default cache.",
    "  --max-size <size>     Keep cache objects within a size such as 512MiB or 2GB.",
    "  --max-age <duration>  Remove entries unused for a duration such as 24h or 7d.",
    "  --json                Print machine-readable output without an absolute cache path.",
    "  --help, -h            Print this help text."
  ].join("\n");
}

function renderExplainHelp(): string {
  return [
    "Ohrisk explain",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.explain}`,
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --policy <path>        Apply license rules from a workspace-contained policy file.",
    "  --workspace-root <path> Set the boundary for local policy inheritance.",
    "  --json                 Print machine-readable output.",
    "  --output <file>        Write report output to a project-relative file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderHelpCommandHelp(): string {
  return [
    "Ohrisk help",
    "",
    "Usage:",
    `  ${COMMAND_DETAIL_USAGE.help}`,
    "",
    "Commands:",
    "  scan",
    "  ci",
    "  diff",
    "  explain",
    "  cache",
    "  help",
    "  version",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderVersionHelp(): string {
  return [
    "Ohrisk version",
    "",
    "Usage:",
    ...COMMAND_DETAIL_USAGE.version.map((usage) => `  ${usage}`),
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}
