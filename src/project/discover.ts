import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type SupportedLockfileKind =
  | "bun"
  | "package-lock"
  | "npm-shrinkwrap"
  | "pnpm-lock"
  | "deno-lock"
  | "yarn-lock";

export type ProjectLockfile = {
  kind: SupportedLockfileKind;
  path: string;
};

export type ProjectInput = {
  rootDir: string;
  lockfile: ProjectLockfile;
};

export type DiscoverProjectOptions = {
  cwd?: string;
  lockfilePath?: string;
};

const SUPPORTED_LOCKFILES: Record<string, SupportedLockfileKind> = {
  "bun.lock": "bun",
  "package-lock.json": "package-lock",
  "npm-shrinkwrap.json": "npm-shrinkwrap",
  "pnpm-lock.yaml": "pnpm-lock",
  "deno.lock": "deno-lock",
  "yarn.lock": "yarn-lock"
};

const KNOWN_LOCKFILES = [
  "bun.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "deno.lock",
  "yarn.lock"
] as const;

const KNOWN_PROJECT_MANIFESTS = [
  "package.json",
  "deno.json",
  "deno.jsonc"
] as const;

const SUPPORTED_LOCKFILE_MESSAGE = "Ohrisk currently supports bun.lock, package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, deno.lock, and Yarn v1 yarn.lock.";

export function discoverProject(
  options: DiscoverProjectOptions = {}
): Result<ProjectInput, OhriskError> {
  const startDir = path.resolve(options.cwd ?? process.cwd());

  try {
    if (options.lockfilePath) {
      return discoverExplicitLockfile({
        cwd: startDir,
        lockfilePath: options.lockfilePath
      });
    }

    for (const dir of ancestorsFrom(startDir)) {
      const lockfiles = findKnownLockfiles(dir);
      const hasProjectManifest = KNOWN_PROJECT_MANIFESTS.some((manifest) =>
        existsSync(path.join(dir, manifest))
      );

      if (lockfiles.length === 0) {
        if (hasProjectManifest) {
          return err(
            createError({
              code: "NO_SUPPORTED_LOCKFILE",
              category: "unsupported_input",
              message: `Project manifest found, but no supported lockfile exists. ${SUPPORTED_LOCKFILE_MESSAGE}`,
              details: {
                rootDir: dir,
                supportedLockfiles: Object.keys(SUPPORTED_LOCKFILES)
              }
            })
          );
        }

        continue;
      }

      if (lockfiles.length > 1) {
        return err(
          createError({
            code: "MULTIPLE_LOCKFILES",
            category: "unsupported_input",
            message: "Multiple lockfiles found in the same project root. Ohrisk v0 needs exactly one lockfile.",
            details: {
              rootDir: dir,
              lockfiles
            }
          })
        );
      }

      const lockfileName = lockfiles[0];

      if (!lockfileName) {
        continue;
      }

      const kind = SUPPORTED_LOCKFILES[lockfileName];

      if (!kind) {
        return err(
          createError({
            code: "NO_SUPPORTED_LOCKFILE",
            category: "unsupported_input",
            message: `No supported lockfile found. ${SUPPORTED_LOCKFILE_MESSAGE}`,
            details: {
              rootDir: dir,
              foundLockfiles: lockfiles,
              supportedLockfiles: Object.keys(SUPPORTED_LOCKFILES)
            }
          })
        );
      }

      return ok({
        rootDir: dir,
        lockfile: {
          kind,
          path: path.join(dir, lockfileName)
        }
      });
    }
  } catch (cause) {
    return err(
      createError({
        code: "PROJECT_DISCOVERY_FAILED",
        category: "filesystem",
        message: "Project discovery failed while walking parent directories.",
        details: {
          startDir,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  return err(
    createError({
      code: "NO_SUPPORTED_LOCKFILE",
      category: "unsupported_input",
      message: `No supported lockfile found. ${SUPPORTED_LOCKFILE_MESSAGE}`,
      details: {
        startDir,
        supportedLockfiles: Object.keys(SUPPORTED_LOCKFILES)
      }
    })
  );
}

function discoverExplicitLockfile(input: {
  cwd: string;
  lockfilePath: string;
}): Result<ProjectInput, OhriskError> {
  const lockfilePath = path.resolve(input.cwd, input.lockfilePath);
  const lockfileName = path.basename(lockfilePath);
  const kind = SUPPORTED_LOCKFILES[lockfileName];

  if (!kind) {
    return err(
      createError({
        code: "UNSUPPORTED_LOCKFILE",
        category: "unsupported_input",
        message: `Explicit lockfile path is not a supported lockfile name. ${SUPPORTED_LOCKFILE_MESSAGE}`,
        details: {
          lockfilePath,
          supportedLockfiles: Object.keys(SUPPORTED_LOCKFILES)
        }
      })
    );
  }

  if (!existsSync(lockfilePath)) {
    return err(
      createError({
        code: "LOCKFILE_NOT_FOUND",
        category: "invalid_input",
        message: "Explicit lockfile path does not exist.",
        details: {
          lockfilePath
        }
      })
    );
  }

  if (!isFile(lockfilePath)) {
    return err(
      createError({
        code: "LOCKFILE_NOT_FILE",
        category: "invalid_input",
        message: "Explicit lockfile path exists but is not a file.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok({
    rootDir: path.dirname(lockfilePath),
    lockfile: {
      kind,
      path: lockfilePath
    }
  });
}

function findKnownLockfiles(dir: string): string[] {
  return KNOWN_LOCKFILES.filter((lockfile) => isFile(path.join(dir, lockfile)));
}

function isFile(pathname: string): boolean {
  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function ancestorsFrom(startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir;

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);

    if (parent === current) {
      return dirs;
    }

    current = parent;
  }
}
