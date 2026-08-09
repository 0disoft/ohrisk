import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type ReportWriter = (input: {
  cwd: string;
  outputPath: string;
  contents: string;
}) => Result<string, OhriskError>;

type ValidatedReportPath = {
  resolvedPath: string;
  realParent: string;
  realProjectRoot: string;
};

export const writeReportFile: ReportWriter = (input) => {
  const resolvedCwd = path.resolve(input.cwd);
  const resolvedPath = path.resolve(resolvedCwd, input.outputPath);

  if (
    !isProjectRelativeOutputPath(input.outputPath) ||
    !isPathInsideOrEqual(resolvedPath, resolvedCwd)
  ) {
    return err(
      reportOutputPathOutsideError({
        outputPath: input.outputPath,
        projectRoot: resolvedCwd,
        resolvedPath
      })
    );
  }

  try {
    const parentResult = ensureSafeReportParent({
      outputPath: input.outputPath,
      projectRoot: resolvedCwd,
      resolvedPath
    });
    if (!parentResult.ok) {
      return parentResult;
    }

    const validatedPath = validateResolvedReportPath({
      outputPath: input.outputPath,
      projectRoot: resolvedCwd,
      resolvedPath
    });
    if (!validatedPath.ok) {
      return validatedPath;
    }

    return writeValidatedReportFile({
      contents: input.contents,
      outputPath: input.outputPath,
      projectRoot: resolvedCwd,
      resolvedPath,
      validatedPath: validatedPath.value
    });
  } catch (cause) {
    return err(
      reportWriteFailedError({
        outputPath: input.outputPath,
        resolvedPath,
        cause
      })
    );
  }
};

function ensureSafeReportParent(input: {
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
}): Result<ValidatedReportPath, OhriskError> {
  const realProjectRoot = realpathSync(input.projectRoot);
  const parentPath = path.dirname(input.resolvedPath);
  const relativeParent = path.relative(input.projectRoot, parentPath);

  if (relativeParent === "") {
    return ok({
      resolvedPath: input.resolvedPath,
      realParent: realProjectRoot,
      realProjectRoot
    });
  }

  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
    return err(
      reportOutputPathOutsideError({
        outputPath: input.outputPath,
        projectRoot: input.projectRoot,
        resolvedPath: input.resolvedPath,
        realProjectRoot,
        realParent: parentPath,
        reason: "parent_outside_project"
      })
    );
  }

  let currentPath = input.projectRoot;
  for (const segment of relativeParent.split(path.sep)) {
    if (segment === "" || segment === "." || segment === "..") {
      return err(
        reportOutputPathOutsideError({
          outputPath: input.outputPath,
          projectRoot: input.projectRoot,
          resolvedPath: input.resolvedPath,
          realProjectRoot,
          realParent: parentPath,
          reason: "invalid_parent_segment"
        })
      );
    }

    const candidatePath = path.join(currentPath, segment);
    const stepResult = resolveOrCreateReportComponent({
      candidatePath,
      outputPath: input.outputPath,
      projectRoot: input.projectRoot,
      resolvedPath: input.resolvedPath,
      realProjectRoot
    });
    if (!stepResult.ok) {
      return stepResult;
    }
    currentPath = stepResult.value;
  }

  return ok({
    resolvedPath: input.resolvedPath,
    realParent: currentPath,
    realProjectRoot
  });
}

function resolveOrCreateReportComponent(input: {
  candidatePath: string;
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
  realProjectRoot: string;
}): Result<string, OhriskError> {
  let stats: ReturnType<typeof lstatSync> | undefined;

  try {
    stats = lstatSync(input.candidatePath);
  } catch (cause) {
    if (!isNoSuchEntryError(cause)) {
      return err(
        reportWriteFailedError({
          outputPath: input.outputPath,
          resolvedPath: input.resolvedPath,
          cause
        })
      );
    }

    try {
      mkdirSync(input.candidatePath);
    } catch (mkdirCause) {
      if (!isAlreadyExistsError(mkdirCause)) {
        return err(
          reportWriteFailedError({
            outputPath: input.outputPath,
            resolvedPath: input.resolvedPath,
            cause: mkdirCause
          })
        );
      }
    }

    try {
      stats = lstatSync(input.candidatePath);
    } catch (recheckCause) {
      return err(
        reportWriteFailedError({
          outputPath: input.outputPath,
          resolvedPath: input.resolvedPath,
          cause: recheckCause
        })
      );
    }
  }

  if (stats.isSymbolicLink()) {
    return resolveReportParentSymlink({
      ...input,
      symlinkPath: input.candidatePath
    });
  }

  if (!stats.isDirectory()) {
    return err(
      reportWriteFailedError({
        outputPath: input.outputPath,
        resolvedPath: input.resolvedPath,
        cause: new Error("Report output parent component is not a directory.")
      })
    );
  }

  try {
    return ok(realpathSync(input.candidatePath));
  } catch (cause) {
    return err(
      reportWriteFailedError({
        outputPath: input.outputPath,
        resolvedPath: input.resolvedPath,
        cause
      })
    );
  }
}

function resolveReportParentSymlink(input: {
  candidatePath: string;
  symlinkPath: string;
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
  realProjectRoot: string;
}): Result<string, OhriskError> {
  let realTarget: string;
  try {
    realTarget = realpathSync(input.symlinkPath);
  } catch (cause) {
    return err(
      reportWriteFailedError({
        outputPath: input.outputPath,
        resolvedPath: input.resolvedPath,
        cause
      })
    );
  }

  if (!isPathInsideOrEqual(realTarget, input.realProjectRoot)) {
    return err(
      reportOutputPathOutsideError({
        outputPath: input.outputPath,
        projectRoot: input.projectRoot,
        resolvedPath: input.resolvedPath,
        realProjectRoot: input.realProjectRoot,
        realParent: realTarget,
        reason: "parent_symlink_outside_project"
      })
    );
  }

  try {
    if (!lstatSync(realTarget).isDirectory()) {
      return err(
        reportWriteFailedError({
          outputPath: input.outputPath,
          resolvedPath: input.resolvedPath,
          cause: new Error("Report output parent symlink resolves to a non-directory.")
        })
      );
    }
  } catch (cause) {
    return err(
      reportWriteFailedError({
        outputPath: input.outputPath,
        resolvedPath: input.resolvedPath,
        cause
      })
    );
  }

  return ok(realTarget);
}

function writeValidatedReportFile(input: {
  contents: string;
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
  validatedPath: ValidatedReportPath;
}): Result<string, OhriskError> {
  let tempPath: string | undefined;
  let tempFileDescriptor: number | undefined;

  try {
    tempPath = createReportTempPath(input.validatedPath.realParent, input.resolvedPath);
    tempFileDescriptor = openSync(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    writeFileSync(tempFileDescriptor, `${input.contents}\n`, "utf8");
    fsyncSync(tempFileDescriptor);
    closeSync(tempFileDescriptor);
    tempFileDescriptor = undefined;

    const revalidatedPath = validateResolvedReportPath({
      outputPath: input.outputPath,
      projectRoot: input.projectRoot,
      resolvedPath: input.resolvedPath
    });
    if (!revalidatedPath.ok) {
      return revalidatedPath;
    }

    if (!isSameRealPath(revalidatedPath.value.realParent, input.validatedPath.realParent)) {
      return err(
        createError({
          code: "REPORT_OUTPUT_PATH_OUTSIDE_PROJECT",
          category: "invalid_input",
          message: "Report output paths must be relative paths inside the current project.",
          details: {
            outputPath: input.outputPath,
            projectRoot: input.projectRoot,
            resolvedPath: input.resolvedPath,
            realProjectRoot: revalidatedPath.value.realProjectRoot,
            realParent: revalidatedPath.value.realParent,
            originalRealParent: input.validatedPath.realParent,
            reason: "output_parent_changed_during_write"
          }
        })
      );
    }

    promoteTempReportFile(tempPath, input.resolvedPath);
    tempPath = undefined;
    return ok(input.resolvedPath);
  } catch (cause) {
    return err(
      createError({
        code: "REPORT_WRITE_FAILED",
        category: "filesystem",
        message: "Failed to write the requested report file.",
        details: {
          outputPath: input.outputPath,
          resolvedPath: input.resolvedPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  } finally {
    if (tempFileDescriptor !== undefined) {
      closeReportTempFile(tempFileDescriptor);
    }
    if (tempPath !== undefined) {
      rmSync(tempPath, { force: true });
    }
  }
}

function validateResolvedReportPath(input: {
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
}): Result<ValidatedReportPath, OhriskError> {
  const realProjectRoot = realpathSync(input.projectRoot);
  const realParent = realpathSync(path.dirname(input.resolvedPath));
  const existingOutputIsSymlink = isSymbolicLinkPath(input.resolvedPath);

  if (
    existingOutputIsSymlink ||
    !isPathInsideOrEqual(realParent, realProjectRoot)
  ) {
    return err(
      reportOutputPathOutsideError({
        outputPath: input.outputPath,
        projectRoot: input.projectRoot,
        resolvedPath: input.resolvedPath,
        realProjectRoot,
        realParent,
        ...(existingOutputIsSymlink ? { reason: "output_symlink_not_supported" } : {})
      })
    );
  }

  return ok({
    resolvedPath: input.resolvedPath,
    realParent,
    realProjectRoot
  });
}

function createReportTempPath(realParent: string, resolvedPath: string): string {
  const baseName = path.basename(resolvedPath);
  const suffix = randomBytes(8).toString("hex");
  return path.join(realParent, `.ohrisk-report-${process.pid}-${Date.now()}-${suffix}-${baseName}.tmp`);
}

function promoteTempReportFile(tempPath: string, resolvedPath: string): void {
  try {
    renameSync(tempPath, resolvedPath);
    return;
  } catch (cause) {
    if (!isReplaceBlockedByExistingTarget(cause)) {
      throw cause;
    }
  }

  const existingTarget = lstatSync(resolvedPath);
  if (existingTarget.isSymbolicLink()) {
    throw new Error("Report output path became a symbolic link before replace.");
  }
  if (!existingTarget.isFile()) {
    throw new Error("Report output path exists and is not a regular file.");
  }

  rmSync(resolvedPath, { force: false });
  renameSync(tempPath, resolvedPath);
}

function isReplaceBlockedByExistingTarget(cause: unknown): boolean {
  const code = cause instanceof Error && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  return code === "EEXIST" || code === "EPERM" || code === "ENOTEMPTY";
}

function reportOutputPathOutsideError(input: {
  outputPath: string;
  projectRoot: string;
  resolvedPath: string;
  realProjectRoot?: string;
  realParent?: string;
  reason?: string;
}): OhriskError {
  return createError({
    code: "REPORT_OUTPUT_PATH_OUTSIDE_PROJECT",
    category: "invalid_input",
    message: "Report output paths must be relative paths inside the current project.",
    details: {
      outputPath: input.outputPath,
      projectRoot: input.projectRoot,
      resolvedPath: input.resolvedPath,
      ...(input.realProjectRoot !== undefined ? { realProjectRoot: input.realProjectRoot } : {}),
      ...(input.realParent !== undefined ? { realParent: input.realParent } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {})
    }
  });
}

function reportWriteFailedError(input: {
  outputPath: string;
  resolvedPath: string;
  cause: unknown;
}): OhriskError {
  return createError({
    code: "REPORT_WRITE_FAILED",
    category: "filesystem",
    message: "Failed to write the requested report file.",
    details: {
      outputPath: input.outputPath,
      resolvedPath: input.resolvedPath,
      cause: input.cause instanceof Error ? input.cause.message : String(input.cause)
    }
  });
}

function isNoSuchEntryError(cause: unknown): boolean {
  const code = cause instanceof Error && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  return code === "ENOENT";
}

function isAlreadyExistsError(cause: unknown): boolean {
  const code = cause instanceof Error && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  return code === "EEXIST";
}

function closeReportTempFile(fileDescriptor: number): void {
  try {
    closeSync(fileDescriptor);
  } catch {
    // The write path already reports the original failure; cleanup is best effort.
  }
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

function isSameRealPath(leftPath: string, rightPath: string): boolean {
  if (process.platform === "win32") {
    return path.normalize(leftPath).toLowerCase() === path.normalize(rightPath).toLowerCase();
  }

  return path.normalize(leftPath) === path.normalize(rightPath);
}
