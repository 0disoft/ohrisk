#!/usr/bin/env bun
import { readFileSync } from "node:fs";

import { parseArgs, type CliCommand } from "./args";
import { collectGraphEvidence } from "../evidence/collect";
import { parseBunLockfile } from "../graph/npm-bun-lock";
import { normalizeAllLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisks } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
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
    case "version":
      io.stdout(renderVersion());
      return 0;
    case "scan":
      return runScan(command, io);
    case "ci":
      return runScan(command, io);
  }
}

async function runScan(
  command: Extract<CliCommand, { kind: "scan" | "ci" }>,
  io: CliIO
): Promise<number> {
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

  const evidence = await collectGraphEvidence({
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

  if (command.kind === "ci" && hasFailingFinding(riskFindings, command.failOn)) {
    return 1;
  }

  return 0;
}

function renderHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    "  ohrisk scan [--profile saas|distributed-app] [--prod] [--json]",
    "  ohrisk ci [--profile saas|distributed-app] [--prod] [--json] [--fail-on high|unknown|review|low]",
    "  ohrisk --version",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "  ci      Run a scan and exit non-zero when findings meet the fail threshold.",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --prod                 Limit later scan stages to production dependencies.",
    "  --json                 Print machine-readable output.",
    "  --fail-on <severity>   CI threshold. Defaults to high.",
    "  --version, -v          Print the Ohrisk package version."
  ].join("\n");
}

function hasFailingFinding(findings: RiskFinding[], failOn: RiskSeverity): boolean {
  return findings.some((finding) => severityRank(finding.severity) >= severityRank(failOn));
}

function severityRank(severity: RiskSeverity): number {
  switch (severity) {
    case "low":
      return 0;
    case "review":
      return 1;
    case "unknown":
      return 2;
    case "high":
      return 3;
  }
}

function renderVersion(): string {
  return `ohrisk ${readPackageVersion()}`;
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { version?: unknown };

  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
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
