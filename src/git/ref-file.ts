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
    const refPath = toGitObjectPath({
      gitRoot,
      projectRoot: input.projectRoot,
      relativePath: input.relativePath
    });

    if (!refPath.ok) {
      return refPath;
    }

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
