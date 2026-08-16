import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { CliCommand } from "./command";
import { supportedOptionsFor } from "./command-spec";

export function unexpectedTopLevelArgs(
  command: string | undefined,
  extraArgs: string[]
): Result<CliCommand, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: `${command ?? "command"} does not accept those extra arguments.`,
    details: { extraArgs }
  }));
}

export function cachePruneOnlyOptionError(
  option: string,
  action: "status" | "clear"
): Result<CliCommand, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: `${option} is supported only by cache prune.`,
    details: { option, action }
  }));
}

export function multipleRepositoryInputs(
  kind: "scan" | "ci"
): Result<CliCommand, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "Specify one repository URL, either positionally or with --repo.",
    details: { supportedOptions: supportedOptionsFor(kind) }
  }));
}

export function invalidOptionValue(
  option: string,
  value: string,
  expected: string
): Result<CliCommand, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: `${option} must be ${expected}.`,
    details: { option, value, expected }
  }));
}

export function readRequiredOptionValue(
  argv: string[],
  index: number,
  option: string,
  details?: Record<string, unknown>
): Result<string, OhriskError> {
  const value = argv[index + 1];
  return !value || value.startsWith("-")
    ? missingOptionValue(option, details)
    : ok(value);
}

export function outputFormatConflict(
  option: string,
  supportedOutputOptions: string[]
): Result<CliCommand, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: `${option} cannot be combined with another output format option.`,
    details: { supportedOutputOptions }
  }));
}

function missingOptionValue(
  option: string,
  details?: Record<string, unknown>
): Result<never, OhriskError> {
  return err(createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: `${option} requires a value.`,
    ...(details ? { details } : {})
  }));
}
