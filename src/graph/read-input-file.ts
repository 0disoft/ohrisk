import type { Result } from "../shared/result";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";

export const LOCKFILE_MAX_BYTES = 50 * 1024 * 1024;
export const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;

export type InputFileReadError = TextFileReadError;

export function readInputTextFile(input: {
  filePath: string;
  maxBytes: number;
}): Result<string, InputFileReadError> {
  return readTextFileWithLimit(input);
}

export function inputFileReadErrorCategory(
  error: InputFileReadError
): "filesystem" | "unsupported_input" {
  return textFileReadErrorCategory(error);
}

export function inputFileReadErrorDetails(error: InputFileReadError): Record<string, unknown> {
  return textFileReadErrorDetails(error);
}
