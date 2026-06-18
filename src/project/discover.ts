import { existsSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type SupportedLockfileKind = "bun";

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
};

const SUPPORTED_LOCKFILES: Record<string, SupportedLockfileKind> = {
  "bun.lock": "bun"
};

const KNOWN_LOCKFILES = [
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
] as const;

export function discoverProject(
  options: DiscoverProjectOptions = {}
): Result<ProjectInput, OhriskError> {
  const startDir = path.resolve(options.cwd ?? process.cwd());

  try {
    for (const dir of ancestorsFrom(startDir)) {
      const lockfiles = findKnownLockfiles(dir);
      const hasPackageManifest = existsSync(path.join(dir, "package.json"));

      if (lockfiles.length === 0) {
        if (hasPackageManifest) {
          return err(
            createError({
              code: "NO_SUPPORTED_LOCKFILE",
              category: "unsupported_input",
              message: "Project manifest found, but no supported lockfile exists. Ohrisk v0 currently supports bun.lock.",
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
            message: "No supported lockfile found. Ohrisk v0 currently supports bun.lock.",
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
      message: "No supported lockfile found. Ohrisk v0 currently supports bun.lock.",
      details: {
        startDir,
        supportedLockfiles: Object.keys(SUPPORTED_LOCKFILES)
      }
    })
  );
}

function findKnownLockfiles(dir: string): string[] {
  return KNOWN_LOCKFILES.filter((lockfile) => existsSync(path.join(dir, lockfile)));
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
