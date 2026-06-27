import { createError, type OhriskError } from "../shared/errors";
import { isUsageProfile, USAGE_PROFILES, type UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import { err, isErr, ok, type Result } from "../shared/result";

const FAIL_ON_SEVERITIES: RiskSeverity[] = ["high", "unknown", "review", "low"];
const SCAN_OUTPUT_FORMAT_OPTIONS = ["--json", "--sarif", "--markdown", "--html", "--cyclonedx"];
const DIFF_OUTPUT_FORMAT_OPTIONS = ["--json", "--markdown"];
const SUPPORTED_COMMANDS = ["scan", "ci", "diff", "explain", "help", "version"] as const;
export type HelpTarget = typeof SUPPORTED_COMMANDS[number];

export type CliCommand =
  | { kind: "help"; target?: HelpTarget }
  | { kind: "version" }
  | {
      kind: "scan";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      outputPath?: string;
    }
  | {
      kind: "ci";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      markdown: boolean;
      html: boolean;
      cyclonedx: boolean;
      noWaivers: boolean;
      lockfilePath?: string;
      outputPath?: string;
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
      outputPath?: string;
      failOn?: RiskSeverity;
    }
  | {
      kind: "explain";
      expression: string;
      profile: UsageProfile;
      json: boolean;
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

  if (command !== "scan" && command !== "ci" && command !== "diff" && command !== "explain") {
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
  let cyclonedx = false;
  let noWaivers = false;
  let lockfilePath: string | undefined;
  let outputPath: string | undefined;
  let failOn: RiskSeverity = "high";
  let strictWaivers = false;

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
      ...(outputPath ? { outputPath } : {}),
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
    ...(outputPath ? { outputPath } : {})
  });
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
    "--json",
    "--sarif",
    "--markdown",
    "--html",
    "--cyclonedx",
    "--no-waivers",
    "--lockfile",
    "--output",
    "--help",
    "-h"
  ];
  return kind === "ci" ? [...common, "--fail-on", "--strict-waivers"] : common;
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
                supportedOptions: ["--profile", "--json", "--output", "--help", "-h"]
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
    ...(outputPath ? { outputPath } : {})
  });
}

function parseDiffArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = "saas";
  let prodOnly = false;
  let json = false;
  let markdown = false;
  let lockfilePath: string | undefined;
  let outputPath: string | undefined;
  let failOn: RiskSeverity | undefined;
  let baselineRef: string | undefined;

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

  return ok({
    kind: "diff",
    baselineRef,
    profile,
    prodOnly,
    json,
    markdown,
    ...(lockfilePath ? { lockfilePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(failOn ? { failOn } : {})
  });
}
