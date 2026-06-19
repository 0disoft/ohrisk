import { closeSync, openSync, readSync, statSync } from "node:fs";

import { err, ok, type Result } from "../shared/result";

export const LOCKFILE_MAX_BYTES = 50 * 1024 * 1024;
export const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;

const INPUT_FILE_READ_CHUNK_BYTES = 64 * 1024;

export type InputFileReadError =
  | {
      kind: "too_large";
      maxBytes: number;
      observedBytes: number;
    }
  | {
      kind: "filesystem";
      cause: string;
    };

export function readInputTextFile(input: {
  filePath: string;
  maxBytes: number;
}): Result<string, InputFileReadError> {
  try {
    const stats = statSync(input.filePath);
    if (stats.size > input.maxBytes) {
      return err({
        kind: "too_large",
        maxBytes: input.maxBytes,
        observedBytes: stats.size
      });
    }

    return readTextFileWithLimit(input);
  } catch (cause) {
    return err({
      kind: "filesystem",
      cause: cause instanceof Error ? cause.message : String(cause)
    });
  }
}

export function inputFileReadErrorCategory(
  error: InputFileReadError
): "filesystem" | "unsupported_input" {
  return error.kind === "too_large" ? "unsupported_input" : "filesystem";
}

export function inputFileReadErrorDetails(error: InputFileReadError): Record<string, unknown> {
  return error.kind === "too_large"
    ? {
        maxBytes: error.maxBytes,
        observedBytes: error.observedBytes
      }
    : {
        cause: error.cause
      };
}

function readTextFileWithLimit(input: {
  filePath: string;
  maxBytes: number;
}): Result<string, InputFileReadError> {
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(input.filePath, "r");

    while (true) {
      const readSize = Math.min(
        INPUT_FILE_READ_CHUNK_BYTES,
        Math.max(1, input.maxBytes + 1 - observedBytes)
      );
      const chunk = Buffer.alloc(readSize);
      const bytesRead = readSync(fileDescriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        return ok(Buffer.concat(chunks, observedBytes).toString("utf8"));
      }

      observedBytes += bytesRead;
      if (observedBytes > input.maxBytes) {
        return err({
          kind: "too_large",
          maxBytes: input.maxBytes,
          observedBytes
        });
      }

      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the primary read or size result.
      }
    }
  }
}
