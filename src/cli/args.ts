import { isIP } from "node:net";

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
  type GitHubRepository
} from "../repository/github-repository";
import { err, isErr, ok, type Result } from "../shared/result";

const FAIL_ON_SEVERITIES: RiskSeverity[] = ["high", "unknown", "review", "low"];
const SCAN_OUTPUT_FORMAT_OPTIONS = ["--json", "--sarif", "--markdown", "--html", "--cyclonedx"];
const DIFF_OUTPUT_FORMAT_OPTIONS = ["--json", "--markdown"];
const BASELINE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SUPPORTED_COMMANDS = ["scan", "ci", "diff", "explain", "cache", "help", "version"] as const;
export type HelpTarget = typeof SUPPORTED_COMMANDS[number];

export type CliCommand =
  | { kind: "help"; target?: HelpTarget }
  | { kind: "version" }
  | {
      kind: "cache";
      action: "status" | "prune" | "clear";
      json: boolean;
      cacheDir?: string;
      maxSizeBytes?: number;
      maxAgeMs?: number;
    }
  | {
      kind: "scan";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      reportLanguage?: ReportLanguage;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      archivePath?: string;
      repository?: GitHubRepository;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      openReport?: boolean;
    }
  | {
      kind: "ci";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      reportLanguage?: ReportLanguage;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      archivePath?: string;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      openReport?: boolean;
      failOn: RiskSeverity;
      strictWaivers: boolean;
    }
  | {
      kind: "diff";
      baselineRef: string;
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      markdown: boolean;
      lockfilePath?: string;
      allLockfiles?: boolean;
      policyPath?: string;
      offline?: boolean;
      cacheDir?: string;
      jobs?: number;
      timeoutMs?: number;
      registryUrl?: string;
      registryTokenEnv?: string;
      allowedHosts?: string[];
      workspaceRootPath?: string;
      outputPath?: string;
      failOn?: RiskSeverity;
    }
  | {
      kind: "explain";
      expression: string;
      profile: UsageProfile;
      json: boolean;
      policyPath?: string;
      workspaceRootPath?: string;
      outputPath?: string;
    };

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

function unexpectedTopLevelArgs(
  command: string | undefined,
  extraArgs: string[]
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${command ?? "command"} does not accept those extra arguments.`,
      details: {
        extraArgs
      }
    })
  );
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

  let json = false;
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
                  supportedOptions: [
                    "--cache-dir",
                    "--json",
                    ...(action === "prune" ? ["--max-size", "--max-age"] : []),
                    "--help",
                    "-h"
                  ]
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

function cachePruneOnlyOptionError(
  option: string,
  action: "status" | "clear"
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${option} is supported only by cache prune.`,
      details: { option, action }
    })
  );
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
  let profile: UsageProfile = "saas";
  let prodOnly = false;
  let json = false;
  let sarif = false;
  let markdown = false;
  let html = false;
  let reportLanguage: ReportLanguage = DEFAULT_REPORT_LANGUAGE;
  let reportLanguageSet = false;
  let cyclonedx = false;
  let noWaivers = false;
  let lockfilePath: string | undefined;
  let archivePath: string | undefined;
  let repository: GitHubRepository | undefined;
  let allLockfiles = false;
  let policyPath: string | undefined;
  let offline = false;
  let cacheDir: string | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  let registryUrl: string | undefined;
  let registryTokenEnv: string | undefined;
  const allowedHosts: string[] = [];
  let workspaceRootPath: string | undefined;
  let outputPath: string | undefined;
  let openReport = false;
  let failOn: RiskSeverity = "high";
  let strictWaivers = false;

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
          return outputFormatConflict("--json", SCAN_OUTPUT_FORMAT_OPTIONS);
        }

        json = true;
        break;
      case "--sarif":
        if (json || markdown || html || cyclonedx) {
          return outputFormatConflict("--sarif", SCAN_OUTPUT_FORMAT_OPTIONS);
        }

        sarif = true;
        break;
      case "--markdown":
        if (json || sarif || html || cyclonedx) {
          return outputFormatConflict("--markdown", SCAN_OUTPUT_FORMAT_OPTIONS);
        }

        markdown = true;
        break;
      case "--html":
        if (json || sarif || markdown || cyclonedx) {
          return outputFormatConflict("--html", SCAN_OUTPUT_FORMAT_OPTIONS);
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
          return outputFormatConflict("--cyclonedx", SCAN_OUTPUT_FORMAT_OPTIONS);
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
          supportedSeverities: FAIL_ON_SEVERITIES
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
                supportedSeverities: FAIL_ON_SEVERITIES
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

  if (allLockfiles && lockfilePath) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--all cannot be combined with --lockfile.",
        details: { supportedOptions: supportedOptionsFor(kind) }
      })
    );
  }

  if (archivePath && lockfilePath) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--archive cannot be combined with --lockfile.",
        details: { supportedOptions: supportedOptionsFor(kind) }
      })
    );
  }

  if (archivePath && workspaceRootPath) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--archive cannot be combined with --workspace-root.",
        details: { supportedOptions: supportedOptionsFor(kind) }
      })
    );
  }

  if (repository && archivePath) {
    return repositoryConflict("--archive", kind);
  }

  if (repository && lockfilePath) {
    return repositoryConflict("--lockfile", kind);
  }

  if (repository && workspaceRootPath) {
    return repositoryConflict("--workspace-root", kind);
  }

  if (repository && offline) {
    return repositoryConflict("--offline", kind);
  }

  if (kind === "ci" && noWaivers && strictWaivers) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--no-waivers cannot be combined with --strict-waivers.",
        details: {
          supportedOptions: supportedOptionsFor(kind)
        }
      })
    );
  }

  if (repository && html && !outputPath) {
    outputPath = `${repository.name}-ohrisk.html`;
  }

  if (openReport && (!html || !outputPath)) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--open requires --html and --output.",
        details: {
          supportedOptions: supportedOptionsFor(kind)
        }
      })
    );
  }

  if (reportLanguageSet && !html) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--language currently requires --html.",
        details: {
          supportedOptions: supportedOptionsFor(kind)
        }
      })
    );
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
      strictWaivers
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

function multipleRepositoryInputs(
  kind: "scan" | "ci"
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: "Specify one repository URL, either positionally or with --repo.",
      details: { supportedOptions: supportedOptionsFor(kind) }
    })
  );
}

function repositoryConflict(
  option: string,
  kind: "scan" | "ci"
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `Remote repository input cannot be combined with ${option}.`,
      details: { supportedOptions: supportedOptionsFor(kind) }
    })
  );
}

function invalidOptionValue(
  option: string,
  value: string,
  expected: string
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${option} must be ${expected}.`,
      details: { option, value, expected }
    })
  );
}

function parseBoundedPositiveInteger(value: string, max: number): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : undefined;
}

function parseDurationMilliseconds(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m)?$/.exec(value.trim().toLowerCase());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function parseCacheAgeMilliseconds(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim().toLowerCase());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "d"
    ? 86_400_000
    : unit === "h"
      ? 3_600_000
      : unit === "m"
        ? 60_000
        : unit === "s"
          ? 1_000
          : 1;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function parseByteSize(value: string): number | undefined {
  const match = /^(\d+)(b|kb|mb|gb|tb|kib|mib|gib|tib)?$/i.exec(value.trim());
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "b";
  const multipliers: Readonly<Record<string, number>> = {
    b: 1,
    kb: 1_000,
    mb: 1_000_000,
    gb: 1_000_000_000,
    tb: 1_000_000_000_000,
    kib: 1_024,
    mib: 1_048_576,
    gib: 1_073_741_824,
    tib: 1_099_511_627_776
  };
  const bytes = amount * (multipliers[unit] ?? 0);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function normalizeRegistryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || !isAllowedRegistryHostname(host)
    ) {
      return undefined;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normalizeHostnameOption(value: string): string | undefined {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host.includes("/") || host.includes("@")) {
    return undefined;
  }
  try {
    const url = new URL(`https://${host}`);
    return url.hostname === host && isAllowedRegistryHostname(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedRegistryHostname(host: string): boolean {
  return isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost");
}

function isFailOnSeverity(value: string): value is RiskSeverity {
  return (FAIL_ON_SEVERITIES as string[]).includes(value);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

function supportedOptionsFor(kind: "scan" | "ci"): string[] {
  const common = [
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
  ];
  return kind === "ci"
    ? [...common, "--fail-on", "--strict-waivers"]
    : [...common, "--repo"];
}

function readRequiredOptionValue(
  argv: string[],
  index: number,
  option: string,
  details?: Record<string, unknown>
): Result<string, OhriskError> {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    return missingOptionValue(option, details);
  }

  return ok(value);
}

function missingOptionValue(
  option: string,
  details?: Record<string, unknown>
): Result<never, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${option} requires a value.`,
      ...(details ? { details } : {})
    })
  );
}

function outputFormatConflict(
  option: string,
  supportedOutputOptions: string[]
): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${option} cannot be combined with another output format option.`,
      details: {
        supportedOutputOptions
      }
    })
  );
}

function parseExplainArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = "saas";
  let json = false;
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
                supportedOptions: [
                  "--profile",
                  "--policy",
                  "--workspace-root",
                  "--json",
                  "--output",
                  "--help",
                  "-h"
                ]
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
  let profile: UsageProfile = "saas";
  let prodOnly = false;
  let json = false;
  let markdown = false;
  let lockfilePath: string | undefined;
  let allLockfiles = false;
  let policyPath: string | undefined;
  let offline = false;
  let cacheDir: string | undefined;
  let jobs: number | undefined;
  let timeoutMs: number | undefined;
  let registryUrl: string | undefined;
  let registryTokenEnv: string | undefined;
  const allowedHosts: string[] = [];
  let workspaceRootPath: string | undefined;
  let outputPath: string | undefined;
  let failOn: RiskSeverity | undefined;
  let baselineRef: string | undefined;

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
          return outputFormatConflict("--json", DIFF_OUTPUT_FORMAT_OPTIONS);
        }

        json = true;
        break;
      case "--markdown":
        if (json) {
          return outputFormatConflict("--markdown", DIFF_OUTPUT_FORMAT_OPTIONS);
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
          supportedSeverities: FAIL_ON_SEVERITIES
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
                supportedSeverities: FAIL_ON_SEVERITIES
              }
            })
          );
        }

        failOn = value.value;
        index += 1;
        break;
      }
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
                supportedOptions: [
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
                ]
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

  if (allLockfiles && lockfilePath) {
    return err(
      createError({
        code: "INVALID_ARGUMENT",
        category: "invalid_input",
        message: "--all cannot be combined with --lockfile.",
        details: {
          conflictingOptions: ["--all", "--lockfile"]
        }
      })
    );
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
    ...(failOn ? { failOn } : {})
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
