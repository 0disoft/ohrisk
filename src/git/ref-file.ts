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
  try {
    const gitRoot = execFileSync("git", ["-C", input.projectRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    const refPath = path
      .join(path.relative(gitRoot, input.projectRoot), input.relativePath)
      .replace(/\\/g, "/");

    return ok(
      execFileSync("git", [
        "-C",
        gitRoot,
        "show",
        "--end-of-options",
        `${input.ref}:${refPath}`
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
  } catch (cause) {
    return err(
      createError({
        code: "GIT_REF_READ_FAILED",
        category: "unsupported_input",
        message: "Failed to read the baseline lockfile from the requested git ref.",
        details: {
          ref: input.ref,
          relativePath: input.relativePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
};
