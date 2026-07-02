import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type ReportWriter = (input: {
  cwd: string;
  outputPath: string;
  contents: string;
}) => Result<string, OhriskError>;

export const writeReportFile: ReportWriter = (input) => {
  const resolvedCwd = path.resolve(input.cwd);
  const resolvedPath = path.resolve(resolvedCwd, input.outputPath);

  if (
    !isProjectRelativeOutputPath(input.outputPath) ||
    !isPathInsideOrEqual(resolvedPath, resolvedCwd)
  ) {
    return err(
      createError({
        code: "REPORT_OUTPUT_PATH_OUTSIDE_PROJECT",
        category: "invalid_input",
        message: "Report output paths must be relative paths inside the current project.",
        details: {
          outputPath: input.outputPath,
          projectRoot: resolvedCwd,
          resolvedPath
        }
      })
    );
  }

  try {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const validatedPath = validateResolvedReportPath({
      outputPath: input.outputPath,
      projectRoot: resolvedCwd,
      resolvedPath
    });
    if (!validatedPath.ok) {
      return validatedPath;
    }

    writeFileSync(resolvedPath, `${input.contents}\n`, "utf8");
    return ok(resolvedPath);
  } catch (cause) {
    return err(
      createError({
        code: "REPORT_WRITE_FAILED",
        category: "filesystem",
        message: "Failed to write the requested report file.",
        details: {
          outputPath: input.outputPath,
          resolvedPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
};

function validateResolvedReportPath(input: {
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
}): Result<string, OhriskError> {
  const realProjectRoot = realpathSync(input.projectRoot);
  const realParent = realpathSync(path.dirname(input.resolvedPath));
  const existingOutputIsSymlink = isSymbolicLinkPath(input.resolvedPath);

  if (
    existingOutputIsSymlink ||
    !isPathInsideOrEqual(realParent, realProjectRoot)
  ) {
    return err(
      createError({
        code: "REPORT_OUTPUT_PATH_OUTSIDE_PROJECT",
        category: "invalid_input",
        message: "Report output paths must be relative paths inside the current project.",
        details: {
          outputPath: input.outputPath,
          projectRoot: input.projectRoot,
          resolvedPath: input.resolvedPath,
          realProjectRoot,
          realParent,
          ...(existingOutputIsSymlink ? { reason: "output_symlink_not_supported" } : {})
        }
      })
    );
  }

  return ok(input.resolvedPath);
}

function isSymbolicLinkPath(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function isProjectRelativeOutputPath(outputPath: string): boolean {
  if (
    outputPath.includes("\0") ||
    path.isAbsolute(outputPath) ||
    path.win32.isAbsolute(outputPath) ||
    path.posix.isAbsolute(outputPath) ||
    /^[A-Za-z]:/.test(outputPath)
  ) {
    return false;
  }

  return outputPath
    .split(/[\\/]+/)
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
