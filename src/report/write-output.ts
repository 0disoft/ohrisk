import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type ReportWriter = (input: {
  cwd: string;
  outputPath: string;
  contents: string;
}) => Result<string, OhriskError>;

export const writeReportFile: ReportWriter = (input) => {
  const resolvedPath = path.resolve(input.cwd, input.outputPath);

  try {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
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
