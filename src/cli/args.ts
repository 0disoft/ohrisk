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
    }
  | {
      kind: "ci";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
      failOn: RiskSeverity;
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

  if (command !== "scan" && command !== "ci") {
    return err(
      createError({
        code: "UNSUPPORTED_COMMAND",
        category: "invalid_input",
        message: `Unsupported command "${command}".`,
        details: {
          supportedCommands: ["scan", "ci"]
        }
      })
    );
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
        json = true;
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
      failOn
    });
  }

  return ok({
    kind,
    profile,
    prodOnly,
    json
  });
}

function isFailOnSeverity(value: string): value is RiskSeverity {
  return (FAIL_ON_SEVERITIES as string[]).includes(value);
}

function supportedOptionsFor(kind: "scan" | "ci"): string[] {
  const common = ["--profile", "--prod", "--json"];
  return kind === "ci" ? [...common, "--fail-on"] : common;
}
