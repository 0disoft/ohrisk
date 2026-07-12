import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const GIT_FILE_LIST_MAX_BYTES = 16 * 1024 * 1024;
const GIT_FILE_LIST_MAX_ENTRIES = 100_000;

export type GitRefFileReader = (input: {
  projectRoot: string;
  ref: string;
  relativePath: string;
}) => Result<string, OhriskError>;

export type GitRefFileLister = (input: {
  projectRoot: string;
  ref: string;
}) => Result<string[], OhriskError>;

export const readGitRefFile: GitRefFileReader = (input) => {
  const context = resolveGitProjectContext(input.projectRoot, input.ref);
  if (!context.ok) {
    return context;
  }

  const refPath = toGitObjectPath({
    gitRoot: context.value.gitRoot,
    projectRoot: context.value.projectRoot,
    relativePath: input.relativePath
  });

  if (!refPath.ok) {
    return refPath;
  }

  try {
    return ok(
      execFileSync("git", [
        "-C",
        context.value.gitRoot,
        "show",
        "--end-of-options",
        `${input.ref}:${refPath.value}`
      ], {
        encoding: "utf8",
        maxBuffer: GIT_FILE_LIST_MAX_BYTES,
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
  } catch (cause) {
    return err(gitShowError({ input, cause }));
  }
};

export const listGitRefFiles: GitRefFileLister = (input) => {
  const context = resolveGitProjectContext(input.projectRoot, input.ref);
  if (!context.ok) {
    return context;
  }

  const projectRelativePath = path.relative(
    context.value.gitRoot,
    context.value.projectRoot
  );
  if (isOutsideRelativePath(projectRelativePath)) {
    return err(projectRootOutsideGitError(input.projectRoot));
  }

  const normalizedProjectPath = normalizeGitPath(projectRelativePath);
  const pathspec = normalizedProjectPath === "" ? "." : normalizedProjectPath;

  try {
    const output = execFileSync("git", [
      "-C",
      context.value.gitRoot,
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      "--full-tree",
      "--end-of-options",
      input.ref,
      "--",
      pathspec
    ], {
      encoding: "buffer",
      maxBuffer: GIT_FILE_LIST_MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const prefix = normalizedProjectPath === "" ? "" : `${normalizedProjectPath}/`;
    const files = output
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry !== "")
      .map((entry) => prefix !== "" && entry.startsWith(prefix)
        ? entry.slice(prefix.length)
        : entry)
      .filter((entry) => entry !== "" && normalizeGitRelativePath(entry) !== undefined);

    if (files.length > GIT_FILE_LIST_MAX_ENTRIES) {
      return err(createError({
        code: "GIT_REF_LIST_FAILED",
        category: "unsupported_input",
        message: "The baseline git ref contains too many files for safe project discovery.",
        details: {
          ref: input.ref,
          fileCount: files.length,
          maxFileCount: GIT_FILE_LIST_MAX_ENTRIES
        }
      }));
    }

    return ok([...new Set(files)].sort());
  } catch (cause) {
    return err(createError({
      code: "GIT_REF_LIST_FAILED",
      category: "unsupported_input",
      message: "Failed to list project files from the requested git ref.",
      details: {
        ref: input.ref,
        cause: readProcessErrorText(cause)
      }
    }));
  }
};

function resolveGitProjectContext(
  projectRoot: string,
  ref: string
): Result<{ gitRoot: string; projectRoot: string }, OhriskError> {
  const resolvedProjectRoot = realpathSync(path.resolve(projectRoot));
  let gitRoot: string;

  try {
    const gitRootRelativePath = execFileSync("git", [
      "-C",
      resolvedProjectRoot,
      "rev-parse",
      "--show-cdup"
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    gitRoot = realpathSync(path.resolve(resolvedProjectRoot, gitRootRelativePath || "."));
  } catch (cause) {
    return err(readFailedError({
      input: { ref, relativePath: "." },
      cause
    }));
  }

  if (isOutsideRelativePath(path.relative(gitRoot, resolvedProjectRoot))) {
    return err(projectRootOutsideGitError(resolvedProjectRoot));
  }

  return ok({ gitRoot, projectRoot: resolvedProjectRoot });
}

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

function projectRootOutsideGitError(projectRoot: string): OhriskError {
  return createError({
    code: "GIT_REF_PATH_OUTSIDE_PROJECT",
    category: "invalid_input",
    message: "The selected project root must stay inside the current git worktree.",
    details: {
      projectRoot
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
    normalizeGitPath(path.join(projectRelativePath, lockfileRelativePath))
  );
}

function normalizeGitRelativePath(value: string): string | undefined {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeGitPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized === "." ? "" : normalized;
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
