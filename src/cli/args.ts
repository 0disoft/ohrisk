import { createError, type OhriskError } from "../shared/errors";
import { isUsageProfile, USAGE_PROFILES, type UsageProfile } from "../policy/profiles";
import type { RiskSeverity } from "../policy/types";
import { err, ok, type Result } from "../shared/result";

const FAIL_ON_SEVERITIES: RiskSeverity[] = ["high", "unknown", "review", "low"];

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "scan";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
    }
  | {
      kind: "ci";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      sarif: boolean;
      failOn: RiskSeverity;
    }
  | {
      kind: "explain";
      expression: string;
      profile: UsageProfile;
      json: boolean;
    };

export function parseArgs(argv: string[]): Result<CliCommand, OhriskError> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return ok({ kind: "help" });
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    return ok({ kind: "version" });
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command !== "scan" && command !== "ci" && command !== "explain") {
    return err(
      createError({
        code: "UNSUPPORTED_COMMAND",
        category: "invalid_input",
        message: `Unsupported command "${command}".`,
        details: {
          supportedCommands: ["scan", "ci", "explain"]
        }
      })
    );
  }

  if (command === "explain") {
    return parseExplainArgs(rest);
  }

  return command === "ci" ? parseCiArgs(rest) : parseScanArgs(rest);
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
  let failOn: RiskSeverity = "high";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--profile": {
        const value = argv[index + 1];
        if (!value) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--profile requires a value.",
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        if (!isUsageProfile(value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported profile "${value}".`,
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        profile = value;
        index += 1;
        break;
      }
      case "--prod":
        prodOnly = true;
        break;
      case "--json":
        if (sarif) {
          return outputFormatConflict("--json");
        }

        json = true;
        break;
      case "--sarif":
        if (json) {
          return outputFormatConflict("--sarif");
        }

        sarif = true;
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

        const value = argv[index + 1];
        if (!value) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--fail-on requires a value.",
              details: {
                supportedSeverities: FAIL_ON_SEVERITIES
              }
            })
          );
        }

        if (!isFailOnSeverity(value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported fail-on severity "${value}".`,
              details: {
                supportedSeverities: FAIL_ON_SEVERITIES
              }
            })
          );
        }

        failOn = value;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        return ok({ kind: "help" });
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

  if (kind === "ci") {
    return ok({
      kind,
      profile,
      prodOnly,
      json,
      sarif,
      failOn
    });
  }

  return ok({
    kind,
    profile,
    prodOnly,
    json,
    sarif
  });
}

function isFailOnSeverity(value: string): value is RiskSeverity {
  return (FAIL_ON_SEVERITIES as string[]).includes(value);
}

function supportedOptionsFor(kind: "scan" | "ci"): string[] {
  const common = ["--profile", "--prod", "--json", "--sarif"];
  return kind === "ci" ? [...common, "--fail-on"] : common;
}

function outputFormatConflict(option: string): Result<CliCommand, OhriskError> {
  return err(
    createError({
      code: "INVALID_ARGUMENT",
      category: "invalid_input",
      message: `${option} cannot be combined with another output format option.`,
      details: {
        supportedOutputOptions: ["--json", "--sarif"]
      }
    })
  );
}

function parseExplainArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = "saas";
  let json = false;
  const expressionParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--profile": {
        const value = argv[index + 1];
        if (!value) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: "--profile requires a value.",
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        if (!isUsageProfile(value)) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unsupported profile "${value}".`,
              details: {
                supportedProfiles: [...USAGE_PROFILES]
              }
            })
          );
        }

        profile = value;
        index += 1;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return ok({ kind: "help" });
      default:
        if (arg.startsWith("-")) {
          return err(
            createError({
              code: "INVALID_ARGUMENT",
              category: "invalid_input",
              message: `Unknown explain option "${arg}".`,
              details: {
                supportedOptions: ["--profile", "--json"]
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
    json
  });
}
