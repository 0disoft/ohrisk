#!/usr/bin/env bun
import { parseArgs, type CliCommand } from "./args";
import { collectGraphEvidence } from "../evidence/collect";
import { parseBunLockfile } from "../graph/npm-bun-lock";
import { normalizeAllLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisks } from "../policy/evaluate";
import { renderScanReport } from "../report/scan-report";
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

  const graph = parseBunLockfile(discovered.value.lockfile.path);

  if (isErr(graph)) {
    io.stderr(formatError(graph.error));
    return exitCodeForError(graph.error);
  }

  const scanGraph = command.prodOnly
    ? {
        ...graph.value,
        nodes: graph.value.nodes.filter((node) => node.dependencyType === "production")
      }
    : graph.value;

  const evidence = collectGraphEvidence({
    graph: scanGraph,
    projectRoot: discovered.value.rootDir
  });

  if (isErr(evidence)) {
    io.stderr(formatError(evidence.error));
    return exitCodeForError(evidence.error);
  }

  const normalizedLicenses = normalizeAllLicenseEvidence(evidence.value);
  const riskFindings = evaluateLicenseRisks({
    licenses: normalizedLicenses,
    dependencies: scanGraph.nodes,
    profile: command.profile
  });

  io.stdout(
    renderScanReport({
      project: discovered.value,
      graph: scanGraph,
      evidence: evidence.value,
      normalizedLicenses,
      riskFindings,
      profile: command.profile,
      prodOnly: command.prodOnly,
      json: command.json
    })
  );
  return 0;
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
