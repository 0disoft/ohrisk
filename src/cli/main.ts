#!/usr/bin/env bun
import path from "node:path";

import { parseArgs, type CliCommand } from "./args";
import { discoverProject, type ProjectInput } from "../project/discover";
import { exitCodeForError, formatError } from "../shared/errors";
import { isErr } from "../shared/result";

export type CliIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export async function main(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIO()
): Promise<number> {
  const parsed = parseArgs(argv);

  if (isErr(parsed)) {
    io.stderr(formatError(parsed.error));
    return exitCodeForError(parsed.error);
  }

  const command = parsed.value;

  switch (command.kind) {
    case "help":
      io.stdout(renderHelp());
      return 0;
    case "scan":
      return runScan(command, io);
  }
}

function runScan(command: Extract<CliCommand, { kind: "scan" }>, io: CliIO): number {
  const discovered = discoverProject({ cwd: io.cwd });

  if (isErr(discovered)) {
    io.stderr(formatError(discovered.error));
    return exitCodeForError(discovered.error);
  }

  io.stdout(renderScanSkeleton(discovered.value, command));
  return 0;
}

function renderScanSkeleton(
  project: ProjectInput,
  command: Extract<CliCommand, { kind: "scan" }>
): string {
  if (command.json) {
    return JSON.stringify(
      {
        status: "ready_for_graph_scan",
        projectRoot: project.rootDir,
        lockfile: {
          kind: project.lockfile.kind,
          path: project.lockfile.path
        },
        profile: command.profile,
        prodOnly: command.prodOnly
      },
      null,
      2
    );
  }

  return [
    "Ohrisk scan",
    `Project: ${project.rootDir}`,
    `Lockfile: ${path.basename(project.lockfile.path)} (${project.lockfile.kind})`,
    `Profile: ${command.profile}`,
    `Production only: ${command.prodOnly ? "yes" : "no"}`,
    "Status: ready for dependency graph parsing",
    "Next: implement bun.lock graph parsing."
  ].join("\n");
}

function renderHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    "  ohrisk scan [--profile saas|distributed-app] [--prod] [--json]",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --prod                 Limit later scan stages to production dependencies.",
    "  --json                 Print machine-readable output."
  ].join("\n");
}

function defaultIO(): CliIO {
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`)
  };
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
