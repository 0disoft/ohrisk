import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type GitRefFileReader = (input: {
  projectRoot: string;
  ref: string;
  relativePath: string;
}) => Result<string, OhriskError>;

export const readGitRefFile: GitRefFileReader = (input) => {
  let gitRoot: string;

  try {
    gitRoot = execFileSync("git", ["-C", input.projectRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (cause) {
    return err(readFailedError({ input, cause }));
  }

  const refPath = toGitObjectPath({
    gitRoot,
    projectRoot: input.projectRoot,
    relativePath: input.relativePath
  });

  if (!refPath.ok) {
    return refPath;
  }

  try {
    return ok(
      execFileSync("git", [
        "-C",
        gitRoot,
        "show",
        "--end-of-options",
        `${input.ref}:${refPath.value}`
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
  } catch (cause) {
    return err(gitShowError({ input, cause }));
  }
};

function gitShowError(input: {
  input: {
    ref: string;
    relativePath: string;
  };
  cause: unknown;
}): OhriskError {
  const cause = readProcessErrorText(input.cause);

  if (cause.includes("does not exist in")) {
    return createError({
      code: "GIT_REF_FILE_NOT_FOUND",
      category: "invalid_input",
      message: "The requested baseline file does not exist in the git ref.",
      details: {
        ref: input.input.ref,
        relativePath: input.input.relativePath,
        cause
      }
    });
  }

  return readFailedError(input);
}

function readFailedError(input: {
  input: {
    ref: string;
    relativePath: string;
  };
  cause: unknown;
}): OhriskError {
  return createError({
    code: "GIT_REF_READ_FAILED",
    category: "unsupported_input",
    message: "Failed to read the baseline file from the requested git ref.",
    details: {
      ref: input.input.ref,
      relativePath: input.input.relativePath,
      cause: readProcessErrorText(input.cause)
    }
  });
}

function readProcessErrorText(cause: unknown): string {
  if (isObjectRecord(cause)) {
    const stderr = cause.stderr;
    if (typeof stderr === "string" && stderr.trim() !== "") {
      return stderr.trim();
    }

    if (stderr instanceof Buffer && stderr.toString("utf8").trim() !== "") {
      return stderr.toString("utf8").trim();
    }
  }

  return cause instanceof Error ? cause.message : String(cause);
}

function toGitObjectPath(input: {
  gitRoot: string;
  projectRoot: string;
  relativePath: string;
}): Result<string, OhriskError> {
  const projectRelativePath = path.relative(input.gitRoot, input.projectRoot);
  const lockfileRelativePath = path.normalize(input.relativePath);

  if (
    isOutsideRelativePath(projectRelativePath) ||
    isOutsideRelativePath(lockfileRelativePath) ||
    path.isAbsolute(input.relativePath)
  ) {
    return err(
      createError({
        code: "GIT_REF_PATH_OUTSIDE_PROJECT",
        category: "invalid_input",
        message: "Baseline file paths must stay inside the current project root.",
        details: {
          relativePath: input.relativePath
        }
      })
    );
  }

  return ok(
    path.join(projectRelativePath, lockfileRelativePath).replace(/\\/g, "/")
  );
}

function isOutsideRelativePath(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
