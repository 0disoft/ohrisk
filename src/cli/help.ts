import type { HelpTarget } from "./args";

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
    "  ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
    "  ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--allow-partial-evidence] [--output <file>] [--open]",
    "  ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "  ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
    "  ohrisk cache status|prune|clear [--cache-dir <path>] [--json]",
    "  ohrisk help [command]",
    "  ohrisk version",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "  ci      Run a scan and exit non-zero when findings meet the fail threshold.",
    "  diff    Compare current findings against a baseline git ref.",
    "  explain Explain how a license expression is classified for a profile.",
    "  cache   Inspect, prune, or clear the persistent artifact cache.",
    "  help    Print this help text.",
    "  version Print the Ohrisk package version.",
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
    "  ohrisk scan [repository-url|--repo <url>] [--submodules ignore|reject] [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--output <file>] [--open]",
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
    "  ohrisk ci [--archive <path>] [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--sarif|--markdown|--html|--cyclonedx] [--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de] [--fail-on high|unknown|review|low] [--strict-waivers] [--allow-partial-evidence] [--output <file>] [--open]",
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
    "  ohrisk diff <baseline-ref> [--lockfile <path>|--all] [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--prod] [--offline] [--cache-dir <path>] [--jobs <1..64>] [--timeout <duration>] [--registry-url <url>] [--registry-token-env <name>] [--allow-host <hostname>] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
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
    "  ohrisk cache status [--cache-dir <path>] [--json]",
    "  ohrisk cache prune [--cache-dir <path>] [--max-size <size>] [--max-age <duration>] [--json]",
    "  ohrisk cache clear [--cache-dir <path>] [--json]",
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
    "  ohrisk explain <license-expression> [--policy <path>] [--workspace-root <path>] [--profile saas|distributed-app] [--json] [--output <file>]",
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
    "  ohrisk help [command]",
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
    "  ohrisk version",
    "  ohrisk --version",
    "  ohrisk -v",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}
