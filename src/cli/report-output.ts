import type { ReportWriter } from "../report/write-output";
import { writeReportFile } from "../report/write-output";
import type { OhriskError } from "../shared/errors";
import { isErr, ok, type Result } from "../shared/result";
import type { CliCommand } from "./command";

type ReportOutputIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  writeReport?: ReportWriter;
};

export function emitReport(input: {
  contents: string;
  outputPath: string | undefined;
  io: ReportOutputIO;
  suppressSuccessMessage?: boolean;
}): Result<string | undefined, OhriskError> {
  if (!input.outputPath) {
    input.io.stdout(input.contents);
    return ok(undefined);
  }

  const writer = input.io.writeReport ?? writeReportFile;
  const written = writer({
    cwd: input.io.cwd,
    outputPath: input.outputPath,
    contents: input.contents
  });

  if (isErr(written)) {
    return written;
  }

  if (!input.suppressSuccessMessage) {
    input.io.stderr(`Wrote report to ${written.value}`);
  }
  return ok(written.value);
}

export function formatReportOpenWarning(error: OhriskError): string {
  const opener =
    typeof error.details?.opener === "string" && error.details.opener.trim() !== ""
      ? ` with ${error.details.opener}`
      : "";
  const cause =
    typeof error.details?.cause === "string" && error.details.cause.trim() !== ""
      ? ` Cause: ${error.details.cause}`
      : "";
  return `Could not open report${opener}: ${error.message}${cause}`;
}

export function reportFormatLabel(
  command: Extract<CliCommand, { kind: "scan" | "ci" }>
): string {
  if (command.json) {
    return "JSON";
  }
  if (command.sarif) {
    return "SARIF";
  }
  if (command.markdown) {
    return "Markdown";
  }
  if (command.html) {
    return "HTML";
  }
  if (command.cyclonedx) {
    return "CycloneDX";
  }
  return "terminal";
}
