import { createError, type OhriskError } from "../shared/errors";
import { isUsageProfile, USAGE_PROFILES, type UsageProfile } from "../policy/profiles";
import { err, ok, type Result } from "../shared/result";

export type CliCommand =
  | { kind: "help" }
  | {
      kind: "scan";
      profile: UsageProfile;
      prodOnly: boolean;
      json: boolean;
    };

export function parseArgs(argv: string[]): Result<CliCommand, OhriskError> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return ok({ kind: "help" });
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command !== "scan") {
    return err(
      createError({
        code: "UNSUPPORTED_COMMAND",
        category: "invalid_input",
        message: `Unsupported command "${command}".`,
        details: {
          supportedCommands: ["scan"]
        }
      })
    );
  }

  return parseScanArgs(rest);
}

function parseScanArgs(argv: string[]): Result<CliCommand, OhriskError> {
  let profile: UsageProfile = "saas";
  let prodOnly = false;
  let json = false;

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
      case "--help":
      case "-h":
        return ok({ kind: "help" });
      default:
        return err(
          createError({
            code: "INVALID_ARGUMENT",
            category: "invalid_input",
            message: `Unknown scan option "${arg}".`,
            details: {
              supportedOptions: ["--profile", "--prod", "--json"]
            }
          })
        );
    }
  }

  return ok({
    kind: "scan",
    profile,
    prodOnly,
    json
  });
}
