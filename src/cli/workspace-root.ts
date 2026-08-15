import { realpathSync, statSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export function resolveWorkspaceRootPath(input: {
  cwd: string;
  workspaceRootPath: string | undefined;
}): Result<string | undefined, OhriskError> {
  if (!input.workspaceRootPath) {
    return ok(undefined);
  }

  const resolvedPath = path.resolve(input.cwd, input.workspaceRootPath);
  try {
    const realPath = realpathSync(resolvedPath);
    if (!statSync(realPath).isDirectory()) {
      return err(workspaceRootInvalidError(input.workspaceRootPath));
    }

    return ok(realPath);
  } catch {
    return err(workspaceRootInvalidError(input.workspaceRootPath));
  }
}

function workspaceRootInvalidError(workspaceRootPath: string): OhriskError {
  const absolute = path.isAbsolute(workspaceRootPath);
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "--workspace-root must point to an existing directory.",
    details: {
      workspaceRootPath: absolute ? "<absolute-path>" : workspaceRootPath,
      reason: absolute
        ? "absolute_workspace_root_not_available"
        : "workspace_root_not_available"
    }
  });
}
