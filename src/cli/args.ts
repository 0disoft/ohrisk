import { createError, type OhriskError } from "../shared/errors";
import { isUsageProfile, USAGE_PROFILES, type UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import {
  DEFAULT_REPORT_LANGUAGE,
  isReportLanguage,
  supportedReportLanguages,
  type ReportLanguage
} from "../report/language";
import {
  parseGitHubRepositoryUrl,
  type GitHubRepository,
  type RepositorySubmoduleMode
} from "../repository/github-repository";
import { err, isErr, ok, type Result } from "../shared/result";
import { SUPPORTED_COMMANDS, type CliCommand } from "./command";
import {
  cachePruneOnlyOptionError,
  invalidOptionValue,
  multipleRepositoryInputs,
  outputFormatConflict,
  readRequiredOptionValue,
  unexpectedTopLevelArgs
} from "./argument-errors";
import {
  CLI_DEFAULTS,
  CLI_FAIL_ON_SEVERITIES,
  findViolatedCommandOptionRule,
  outputFormatOptionsFor,
  supportedCacheOptions,
  supportedOptionsFor,
  type CommandOptionRule,
  type OptionSpecCommand
} from "./command-spec";
import {
  isSafeRepositoryRelativePath,
  normalizeHostnameOption,
  normalizeRegistryUrl,
  parseBoundedPositiveInteger,
  parseByteSize,
  parseCacheAgeMilliseconds,
  parseDurationMilliseconds
} from "./option-values";

const BASELINE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function parseArgs(argv: string[]): Result<CliCommand, OhriskError> {
  if (argv.length === 0) {
    return ok({ kind: "help" });
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    return argv.length === 1
      ? ok({ kind: "help" })
      : unexpectedTopLevelArgs(argv[0], argv.slice(1));
  }

  if (argv[0] === "help") {
    return parseTopLevelHelpArgs(argv.slice(1));
  }

  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    if (argv[0] === "version" && isHelpFlag(argv[1]) && argv.length === 2) {
      return ok({ kind: "help", target: "version" });
    }

    return argv.length === 1
      ? ok({ kind: "version" })
      : unexpectedTopLevelArgs(argv[0], argv.slice(1));
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (
    command !== "scan"
    && command !== "ci"
    && command !== "diff"
    && command !== "explain"
    && command !== "cache"
  ) {
    return err(
      createError({
        code: "UNSUPPORTED_COMMAND",
        category: "invalid_input",
        message: `Unsupported command "${command}".`,
        details: {
          supportedCommands: [...SUPPORTED_COMMANDS]
        }
      })
    );
  }

  if (command === "cache") {
    return parseCacheArgs(rest);
  }

  if (command === "explain") {
    return parseExplainArgs(rest);
  }

  if (command === "diff") {
    return parseDiffArgs(rest);
  }

  return command === "ci" ? parseCiArgs(rest) : parseScanArgs(rest);
}

function parseTopLevelHelpArgs(argv: string[]): Result<CliCommand, OhriskError> {
  if (argv.length === 0) {
    return ok({ kind: "help" });
  }

  if (argv.length > 1) {
    return unexpectedTopLevelArgs("help", argv);
  }

  const command = argv[0];
  if (isHelpFlag(command)) {
    return ok({ kind: "help", target: "help" });
  }

  if (isSupportedCommand(command)) {
    return ok({ kind: "help", target: command });
  }

  return err(
    createError({
      code: "UNSUPPORTED_COMMAND",
      category: "invalid_input",
      message: `Unsupported help target "${command}".`,
      details: {
        supportedCommands: [...SUPPORTED_COMMANDS]
      }
    })
  );
}

function isSupportedCommand(value: string | undefined): value is typeof SUPPORTED_COMMANDS[number] {
  return typeof value === "string" && (SUPPORTED_COMMANDS as readonly string[]).includes(value);
}

function parseCacheArgs(argv: string[]): Result<CliCommand, OhriskError> {
  if (argv.length === 0 || isHelpFlag(argv[0])) {
    return argv.length <= 1
      ? ok({ kind: "help", target: "cache" })
      : unexpectedTopLevelArgs(argv[0], argv.slice(1));
  }

  const action = argv[0];
  if (action !== "status" && action !== "prune" && action !== "clear") {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: `Unsupported cache action "${action}".`,
        details: {
          supportedActions: ["status", "prune", "clear"]
        }
      })
    );
  }

  let json = CLI_DEFAULTS.json;
  let cacheDir: string | undefined;
  let maxSizeBytes: number | undefined;
  let maxAgeMs: number | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--cache-dir": {
        const value = readRequiredOptionValue(argv, index, "--cache-dir");
        if (isErr(value)) {
          return value;
        }
        cacheDir = value.value;
        index += 1;
        break;
      }
      case "--max-size": {
        if (action !== "prune") {
          return cachePruneOnlyOptionError(arg, action);
        }
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        const parsed = parseByteSize(value.value);
        if (parsed === undefined) {
          return invalidOptionValue(arg, value.value, "a non-negative byte size such as 512MiB or 2GB");
        }
        maxSizeBytes = parsed;
        index += 1;
        break;
      }
      case "--max-age": {
        if (action !== "prune") {
          return cachePruneOnlyOptionError(arg, action);
        }
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        const parsed = parseCacheAgeMilliseconds(value.value);
        if (parsed === undefined) {
          return invalidOptionValue(arg, value.value, "a non-negative duration such as 24h or 7d");
        }
        maxAgeMs = parsed;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        return ok({ kind: "help", target: "cache" });
      default:
        return err(
          createError({
            code: "INVALID_ARGUMENT",
            category: "invalid_input",
            message: arg.startsWith("-")
              ? `Unknown cache option "${arg}".`
              : "cache accepts exactly one action.",
            details: arg.startsWith("-")
              ? {
                  supportedOptions: supportedCacheOptions(action)
                }
              : { action, extraArgument: arg }
          })
        );
    }
  }

  return ok({
    kind: "cache",
    action,
    json,
    ...(cacheDir ? { cacheDir } : {}),
    ...(maxSizeBytes !== undefined ? { maxSizeBytes } : {}),
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {})
  });
}

function parseScanArgs(argv: string[]): Result<CliCommand, OhriskError> {
  return parseScanLikeArgs(argv, "scan");
}

function parseCiArgs(argv: string[]): Result<CliCommand, OhriskError> {
  return parseScanLikeArgs(argv, "ci");
}

function parseScanLikeArgs(
  argv: string[],
  kind: "scan" | "ci"
): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = CLI_DEFAULTS.profile;
  let prodOnly = CLI_DEFAULTS.prodOnly;
  let json = CLI_DEFAULTS.json;
  let sarif = CLI_DEFAULTS.sarif;
  let markdown = CLI_DEFAULTS.markdown;
  let html = CLI_DEFAULTS.html;
  let reportLanguage: ReportLanguage = CLI_DEFAULTS.reportLanguage;
  let reportLanguageSet = false;
  let cyclonedx = CLI_DEFAULTS.cyclonedx;
  let noWaivers = CLI_DEFAULTS.noWaivers;
  let lockfilePath: string | undefined;
  let archivePath: string | undefined;
  let repository: GitHubRepository | undefined;
  let submoduleMode: RepositorySubmoduleMode = CLI_DEFAULTS.submoduleMode;
  let submoduleModeSet = false;
  let allLockfiles = CLI_DEFAULTS.allLockfiles;
  let policyPath: string | undefined;
  let offline = CLI_DEFAULTS.offline;
  let cacheDir: string | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  let registryUrl: string | undefined;
  let registryTokenEnv: string | undefined;
  const allowedHosts: string[] = [];
  let workspaceRootPath: string | undefined;
  let outputPath: string | undefined;
  let openReport = CLI_DEFAULTS.openReport;
  let failOn: RiskSeverity = CLI_DEFAULTS.failOn;
  let strictWaivers = CLI_DEFAULTS.strictWaivers;
  let allowPartialEvidence = CLI_DEFAULTS.allowPartialEvidence;
  const outputFormatOptions = outputFormatOptionsFor(kind);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--all":
        allLockfiles = true;
        break;
      case "--policy":
      case "--config": {
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        policyPath = value.value;
        index += 1;
        break;
      }
      case "--offline":
        offline = true;
        break;
      case "--cache-dir": {
        const value = readRequiredOptionValue(argv, index, "--cache-dir");
        if (isErr(value)) {
          return value;
        }
        cacheDir = value.value;
        index += 1;
        break;
      }
      case "--jobs": {
        const value = readRequiredOptionValue(argv, index, "--jobs");
        if (isErr(value)) {
          return value;
        }
        const parsed = parseBoundedPositiveInteger(value.value, 64);
        if (parsed === undefined) {
          return invalidOptionValue("--jobs", value.value, "an integer from 1 to 64");
        }
        jobs = parsed;
        index += 1;
        break;
      }
      case "--timeout": {
        const value = readRequiredOptionValue(argv, index, "--timeout");
        if (isErr(value)) {
          return value;
        }
        const parsed = parseDurationMilliseconds(value.value);
        if (parsed === undefined || parsed < 100 || parsed > 600_000) {
          return invalidOptionValue("--timeout", value.value, "100ms to 10m");
        }
        timeoutMs = parsed;
        index += 1;
        break;
      }
      case "--registry-url": {
        const value = readRequiredOptionValue(argv, index, "--registry-url");
        if (isErr(value)) {
          return value;
        }
        const normalized = normalizeRegistryUrl(value.value);
        if (!normalized) {
          return invalidOptionValue(
            "--registry-url",
            value.value,
            "an HTTPS URL without credentials, query, or fragment"
          );
        }
        registryUrl = normalized;
        index += 1;
        break;
      }
      case "--registry-token-env": {
        const value = readRequiredOptionValue(argv, index, "--registry-token-env");
        if (isErr(value)) {
          return value;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.value)) {
          return invalidOptionValue(
            "--registry-token-env",
            value.value,
            "an environment variable name"
          );
        }
        registryTokenEnv = value.value;
        index += 1;
        break;
      }
      case "--allow-host": {
        const value = readRequiredOptionValue(argv, index, "--allow-host");
        if (isErr(value)) {
          return value;
        }
        const host = normalizeHostnameOption(value.value);
        if (!host) {
          return invalidOptionValue(
            "--allow-host",
            value.value,
            "a hostname without a scheme, port, or path"
          );
        }
        allowedHosts.push(host);
        index += 1;
        break;
      }
      case "--profile": {
        const value = readRequiredOptionValue(argv, index, "--profile", {
          supportedProfiles: [...USAGE_PROFILES]
        });
        if (isErr(value)) {
          return value;
        }

        if (!isUsageProfile(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported profile "${value.value}".`,
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        profile = value.value;
        index += 1;
        break;
      }
      case "--prod":
        prodOnly = true;
        break;
      case "--no-waivers":
        noWaivers = true;
        break;
      case "--lockfile": {
        const value = readRequiredOptionValue(argv, index, "--lockfile");
        if (isErr(value)) {
          return value;
        }

        lockfilePath = value.value;
        index += 1;
        break;
      }
      case "--archive": {
        const value = readRequiredOptionValue(argv, index, "--archive");
        if (isErr(value)) {
          return value;
        }

        archivePath = value.value;
        index += 1;
        break;
      }
      case "--submodules": {
        if (kind !== "scan") {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--submodules is only supported by remote scan commands.",
              details: { supportedOptions: supportedOptionsFor(kind) }
            })
          );
        }
        const value = readRequiredOptionValue(argv, index, "--submodules", {
          supportedModes: ["ignore", "reject"]
        });
        if (isErr(value)) {
          return value;
        }
        if (!isRepositorySubmoduleMode(value.value)) {
          return invalidOptionValue("--submodules", value.value, "ignore or reject");
        }
        submoduleMode = value.value;
        submoduleModeSet = true;
        index += 1;
        break;
      }
      case "--repo": {
        if (kind !== "scan") {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--repo is only supported by the scan command.",
              details: { supportedOptions: supportedOptionsFor(kind) }
            })
          );
        }
        const value = readRequiredOptionValue(argv, index, "--repo");
        if (isErr(value)) {
          return value;
        }
        if (repository) {
          return multipleRepositoryInputs(kind);
        }
        const parsedRepository = parseGitHubRepositoryUrl(value.value);
        if (isErr(parsedRepository)) {
          return parsedRepository;
        }
        repository = parsedRepository.value;
        index += 1;
        break;
      }
      case "--workspace-root": {
        const value = readRequiredOptionValue(argv, index, "--workspace-root");
        if (isErr(value)) {
          return value;
        }

        workspaceRootPath = value.value;
        index += 1;
        break;
      }
      case "--json":
        if (sarif || markdown || html || cyclonedx) {
          return outputFormatConflict("--json", outputFormatOptions);
        }

        json = true;
        break;
      case "--sarif":
        if (json || markdown || html || cyclonedx) {
          return outputFormatConflict("--sarif", outputFormatOptions);
        }

        sarif = true;
        break;
      case "--markdown":
        if (json || sarif || html || cyclonedx) {
          return outputFormatConflict("--markdown", outputFormatOptions);
        }

        markdown = true;
        break;
      case "--html":
        if (json || sarif || markdown || cyclonedx) {
          return outputFormatConflict("--html", outputFormatOptions);
        }

        html = true;
        break;
      case "--language": {
        const value = readRequiredOptionValue(argv, index, "--language", {
          supportedLanguages: supportedReportLanguages()
        });
        if (isErr(value)) {
          return value;
        }

        if (!isReportLanguage(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported report language "${value.value}".`,
              details: {
                supportedLanguages: supportedReportLanguages()
              }
            })
          );
        }

        reportLanguage = value.value;
        reportLanguageSet = true;
        index += 1;
        break;
      }
      case "--cyclonedx":
        if (json || sarif || markdown || html) {
          return outputFormatConflict("--cyclonedx", outputFormatOptions);
        }

        cyclonedx = true;
        break;
      case "--output": {
        const value = readRequiredOptionValue(argv, index, "--output");
        if (isErr(value)) {
          return value;
        }

        outputPath = value.value;
        index += 1;
        break;
      }
      case "--open":
        openReport = true;
        break;
      case "--fail-on": {
        if (kind !== "ci") {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--fail-on is only supported by the ci command.",
              details: {
                supportedOptions: supportedOptionsFor(kind)
              }
            })
          );
        }

        const value = readRequiredOptionValue(argv, index, "--fail-on", {
          supportedSeverities: CLI_FAIL_ON_SEVERITIES
        });
        if (isErr(value)) {
          return value;
        }

        if (!isFailOnSeverity(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported fail-on severity "${value.value}".`,
              details: {
                supportedSeverities: CLI_FAIL_ON_SEVERITIES
              }
            })
          );
        }

        failOn = value.value;
        index += 1;
        break;
      }
      case "--strict-waivers": {
        if (kind !== "ci") {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--strict-waivers is only supported by the ci command.",
              details: {
                supportedOptions: supportedOptionsFor(kind)
              }
            })
          );
        }

        strictWaivers = true;
        break;
      }
      case "--allow-partial-evidence": {
        if (kind !== "ci") {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--allow-partial-evidence is only supported by the ci command.",
              details: { supportedOptions: supportedOptionsFor(kind) }
            })
          );
        }
        allowPartialEvidence = true;
        break;
      }
      case "--help":
      case "-h":
        return ok({ kind: "help", target: kind });
      default:
        if (kind === "scan" && !arg.startsWith("-")) {
          if (repository) {
            return multipleRepositoryInputs(kind);
          }
          const parsedRepository = parseGitHubRepositoryUrl(arg);
          if (isErr(parsedRepository)) {
            return parsedRepository;
          }
          repository = parsedRepository.value;
          break;
        }
        return err(
          createError({
            code: "INVALID_ARGUMENT",
            category: "invalid_input",
            message: `Unknown ${kind} option "${arg}".`,
            details: {
              supportedOptions: supportedOptionsFor(kind)
            }
          })
        );
    }
  }

  const presentOptions = new Set<string>();
  if (allLockfiles) presentOptions.add("--all");
  if (lockfilePath) presentOptions.add("--lockfile");
  if (archivePath) presentOptions.add("--archive");
  if (workspaceRootPath) presentOptions.add("--workspace-root");
  if (repository) presentOptions.add("--repo");
  if (submoduleModeSet) presentOptions.add("--submodules");
  if (offline) presentOptions.add("--offline");
  if (noWaivers) presentOptions.add("--no-waivers");
  if (strictWaivers) presentOptions.add("--strict-waivers");
  if (html) presentOptions.add("--html");
  if (outputPath) presentOptions.add("--output");
  if (openReport) presentOptions.add("--open");
  if (reportLanguageSet) presentOptions.add("--language");

  const inputRule = findViolatedCommandOptionRule({
    command: kind,
    stage: "input",
    presentOptions
  });
  if (inputRule) {
    return commandOptionRuleError(kind, inputRule);
  }

  if (repository && lockfilePath && !isSafeRepositoryRelativePath(lockfilePath)) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "Remote repository --lockfile must be a safe repository-relative path.",
        details: {
          option: "--lockfile",
          supportedOptions: supportedOptionsFor(kind)
        }
      })
    );
  }

  const scopeRule = findViolatedCommandOptionRule({
    command: kind,
    stage: "scope",
    presentOptions
  });
  if (scopeRule) {
    return commandOptionRuleError(kind, scopeRule);
  }

  if (repository && html && !outputPath) {
    outputPath = `${repository.name}-ohrisk.html`;
    presentOptions.add("--output");
  }

  const outputRule = findViolatedCommandOptionRule({
    command: kind,
    stage: "output",
    presentOptions
  });
  if (outputRule) {
    return commandOptionRuleError(kind, outputRule);
  }

  if (kind === "ci") {
    return ok({
      kind,
      profile,
      prodOnly,
      json,
      sarif,
      markdown,
      html,
      cyclonedx,
      noWaivers,
      ...(lockfilePath ? { lockfilePath } : {}),
      ...(archivePath ? { archivePath } : {}),
      ...(allLockfiles ? { allLockfiles: true } : {}),
      ...(policyPath ? { policyPath } : {}),
      ...(offline ? { offline: true } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(jobs !== undefined ? { jobs } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(registryUrl ? { registryUrl } : {}),
      ...(registryTokenEnv ? { registryTokenEnv } : {}),
      ...(allowedHosts.length > 0 ? { allowedHosts: [...new Set(allowedHosts)] } : {}),
      ...(workspaceRootPath ? { workspaceRootPath } : {}),
      ...(outputPath ? { outputPath } : {}),
      ...(openReport ? { openReport } : {}),
      ...(reportLanguage !== DEFAULT_REPORT_LANGUAGE ? { reportLanguage } : {}),
      failOn,
      strictWaivers,
      allowPartialEvidence
    });
  }

  return ok({
    kind,
    profile,
    prodOnly,
    json,
    sarif,
    markdown,
    html,
    cyclonedx,
    noWaivers,
    ...(lockfilePath ? { lockfilePath } : {}),
    ...(archivePath ? { archivePath } : {}),
    ...(repository ? { repository } : {}),
    ...(repository ? { submoduleMode } : {}),
    ...(allLockfiles ? { allLockfiles: true } : {}),
    ...(policyPath ? { policyPath } : {}),
    ...(offline ? { offline: true } : {}),
    ...(cacheDir ? { cacheDir } : {}),
    ...(jobs !== undefined ? { jobs } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(registryUrl ? { registryUrl } : {}),
    ...(registryTokenEnv ? { registryTokenEnv } : {}),
    ...(allowedHosts.length > 0 ? { allowedHosts: [...new Set(allowedHosts)] } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(openReport ? { openReport } : {}),
    ...(reportLanguage !== DEFAULT_REPORT_LANGUAGE ? { reportLanguage } : {})
  });
}

function isFailOnSeverity(value: string): value is RiskSeverity {
  return (CLI_FAIL_ON_SEVERITIES as readonly string[]).includes(value);
}

function isRepositorySubmoduleMode(value: string): value is RepositorySubmoduleMode {
  return value === "ignore" || value === "reject";
}

function commandOptionRuleError(
  kind: OptionSpecCommand,
  rule: CommandOptionRule
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: rule.message,
      details: kind === "diff"
        ? { conflictingOptions: [rule.option, ...rule.relatedOptions] }
        : { supportedOptions: supportedOptionsFor(kind) }
    })
  );
}

function isHelpFlag(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

function parseExplainArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = CLI_DEFAULTS.profile;
  let json = CLI_DEFAULTS.json;
  let policyPath: string | undefined;
  let workspaceRootPath: string | undefined;
  let outputPath: string | undefined;
  const expressionParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--profile": {
        const value = readRequiredOptionValue(argv, index, "--profile", {
          supportedProfiles: [...USAGE_PROFILES]
        });
        if (isErr(value)) {
          return value;
        }

        if (!isUsageProfile(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported profile "${value.value}".`,
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        profile = value.value;
        index += 1;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--policy":
      case "--config": {
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        policyPath = value.value;
        index += 1;
        break;
      }
      case "--workspace-root": {
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        workspaceRootPath = value.value;
        index += 1;
        break;
      }
      case "--output": {
        const value = readRequiredOptionValue(argv, index, "--output");
        if (isErr(value)) {
          return value;
        }

        outputPath = value.value;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        return ok({ kind: "help", target: "explain" });
      default:
        if (arg.startsWith("-")) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unknown explain option "${arg}".`,
              details: {
                supportedOptions: supportedOptionsFor("explain")
              }
            })
          );
        }

        expressionParts.push(arg);
        break;
    }
  }

  const expression = expressionParts.join(" ").trim();
  if (!expression) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "explain requires a license expression.",
        details: {
          example: "ohrisk explain AGPL-3.0-only --profile saas"
        }
      })
    );
  }

  return ok({
    kind: "explain",
    expression,
    profile,
    json,
    ...(policyPath ? { policyPath } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(outputPath ? { outputPath } : {})
  });
}

function parseDiffArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = CLI_DEFAULTS.profile;
  let prodOnly = CLI_DEFAULTS.prodOnly;
  let json = CLI_DEFAULTS.json;
  let markdown = CLI_DEFAULTS.markdown;
  let lockfilePath: string | undefined;
  let allLockfiles = CLI_DEFAULTS.allLockfiles;
  let policyPath: string | undefined;
  let offline = CLI_DEFAULTS.offline;
  let cacheDir: string | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  let registryUrl: string | undefined;
  let registryTokenEnv: string | undefined;
  const allowedHosts: string[] = [];
  let workspaceRootPath: string | undefined;
  let outputPath: string | undefined;
  let failOn: RiskSeverity | undefined;
  let allowPartialEvidence = CLI_DEFAULTS.allowPartialEvidence;
  let baselineRef: string | undefined;
  const outputFormatOptions = outputFormatOptionsFor("diff");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--policy":
      case "--config": {
        const value = readRequiredOptionValue(argv, index, arg);
        if (isErr(value)) {
          return value;
        }
        policyPath = value.value;
        index += 1;
        break;
      }
      case "--offline":
        offline = true;
        break;
      case "--cache-dir": {
        const value = readRequiredOptionValue(argv, index, "--cache-dir");
        if (isErr(value)) {
          return value;
        }
        cacheDir = value.value;
        index += 1;
        break;
      }
      case "--jobs": {
        const value = readRequiredOptionValue(argv, index, "--jobs");
        if (isErr(value)) {
          return value;
        }
        const parsed = parseBoundedPositiveInteger(value.value, 64);
        if (parsed === undefined) {
          return invalidOptionValue("--jobs", value.value, "an integer from 1 to 64");
        }
        jobs = parsed;
        index += 1;
        break;
      }
      case "--timeout": {
        const value = readRequiredOptionValue(argv, index, "--timeout");
        if (isErr(value)) {
          return value;
        }
        const parsed = parseDurationMilliseconds(value.value);
        if (parsed === undefined || parsed < 100 || parsed > 600_000) {
          return invalidOptionValue("--timeout", value.value, "100ms to 10m");
        }
        timeoutMs = parsed;
        index += 1;
        break;
      }
      case "--registry-url": {
        const value = readRequiredOptionValue(argv, index, "--registry-url");
        if (isErr(value)) {
          return value;
        }
        const normalized = normalizeRegistryUrl(value.value);
        if (!normalized) {
          return invalidOptionValue(
            "--registry-url",
            value.value,
            "an HTTPS URL without credentials, query, or fragment"
          );
        }
        registryUrl = normalized;
        index += 1;
        break;
      }
      case "--registry-token-env": {
        const value = readRequiredOptionValue(argv, index, "--registry-token-env");
        if (isErr(value)) {
          return value;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.value)) {
          return invalidOptionValue(
            "--registry-token-env",
            value.value,
            "an environment variable name"
          );
        }
        registryTokenEnv = value.value;
        index += 1;
        break;
      }
      case "--allow-host": {
        const value = readRequiredOptionValue(argv, index, "--allow-host");
        if (isErr(value)) {
          return value;
        }
        const host = normalizeHostnameOption(value.value);
        if (!host) {
          return invalidOptionValue(
            "--allow-host",
            value.value,
            "a hostname without a scheme, port, or path"
          );
        }
        allowedHosts.push(host);
        index += 1;
        break;
      }
      case "--profile": {
        const value = readRequiredOptionValue(argv, index, "--profile", {
          supportedProfiles: [...USAGE_PROFILES]
        });
        if (isErr(value)) {
          return value;
        }

        if (!isUsageProfile(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported profile "${value.value}".`,
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        profile = value.value;
        index += 1;
        break;
      }
      case "--prod":
        prodOnly = true;
        break;
      case "--lockfile": {
        const value = readRequiredOptionValue(argv, index, "--lockfile");
        if (isErr(value)) {
          return value;
        }

        lockfilePath = value.value;
        index += 1;
        break;
      }
      case "--all":
        allLockfiles = true;
        break;
      case "--workspace-root": {
        const value = readRequiredOptionValue(argv, index, "--workspace-root");
        if (isErr(value)) {
          return value;
        }

        workspaceRootPath = value.value;
        index += 1;
        break;
      }
      case "--json":
        if (markdown) {
          return outputFormatConflict("--json", outputFormatOptions);
        }

        json = true;
        break;
      case "--markdown":
        if (json) {
          return outputFormatConflict("--markdown", outputFormatOptions);
        }

        markdown = true;
        break;
      case "--output": {
        const value = readRequiredOptionValue(argv, index, "--output");
        if (isErr(value)) {
          return value;
        }

        outputPath = value.value;
        index += 1;
        break;
      }
      case "--fail-on": {
        const value = readRequiredOptionValue(argv, index, "--fail-on", {
          supportedSeverities: CLI_FAIL_ON_SEVERITIES
        });
        if (isErr(value)) {
          return value;
        }

        if (!isFailOnSeverity(value.value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported fail-on severity "${value.value}".`,
              details: {
                supportedSeverities: CLI_FAIL_ON_SEVERITIES
              }
            })
          );
        }

        failOn = value.value;
        index += 1;
        break;
      }
      case "--allow-partial-evidence":
        allowPartialEvidence = true;
        break;
      case "--help":
      case "-h":
        return ok({ kind: "help", target: "diff" });
      default:
        if (arg.startsWith("-")) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unknown diff option "${arg}".`,
              details: {
                supportedOptions: supportedOptionsFor("diff")
              }
            })
          );
        }

        if (baselineRef !== undefined) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "diff accepts exactly one baseline ref.",
              details: {
                baselineRef,
                extraRef: arg
              }
            })
          );
        }

        baselineRef = arg;
        break;
    }
  }

  const inputRule = findViolatedCommandOptionRule({
    command: "diff",
    stage: "input",
    presentOptions: new Set([
      ...(allLockfiles ? ["--all"] : []),
      ...(lockfilePath ? ["--lockfile"] : [])
    ])
  });
  if (inputRule) {
    return commandOptionRuleError("diff", inputRule);
  }

  if (!baselineRef) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "diff requires a baseline git ref.",
        details: {
          example: "ohrisk diff main --profile saas --prod"
        }
      })
    );
  }

  const validBaselineRef = validateBaselineRef(baselineRef);
  if (isErr(validBaselineRef)) {
    return validBaselineRef;
  }

  return ok({
    kind: "diff",
    baselineRef,
    profile,
    prodOnly,
    json,
    markdown,
    ...(lockfilePath ? { lockfilePath } : {}),
    ...(allLockfiles ? { allLockfiles: true } : {}),
    ...(policyPath ? { policyPath } : {}),
    ...(offline ? { offline: true } : {}),
    ...(cacheDir ? { cacheDir } : {}),
    ...(jobs !== undefined ? { jobs } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(registryUrl ? { registryUrl } : {}),
    ...(registryTokenEnv ? { registryTokenEnv } : {}),
    ...(allowedHosts.length > 0 ? { allowedHosts: [...new Set(allowedHosts)] } : {}),
    ...(workspaceRootPath ? { workspaceRootPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(failOn ? { failOn } : {}),
    allowPartialEvidence
  });
}

function validateBaselineRef(ref: string): Result<string, OhriskError> {
  const parts = ref.split("/");
  const hasInvalidRefShape =
    !BASELINE_REF_PATTERN.test(ref) ||
    ref.includes("..") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    parts.some((part) => part === "" || part.startsWith(".") || part.endsWith(".lock"));

  if (!hasInvalidRefShape) {
    return ok(ref);
  }

  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: "diff baseline refs must be branch, tag, or commit-like names without git rev syntax.",
      details: {
        baselineRef: ref,
        allowedPattern: BASELINE_REF_PATTERN.source,
        rejectedExamples: ["HEAD@{1}", "main:path", "HEAD~1", "feature branch"]
      }
    })
  );
}
