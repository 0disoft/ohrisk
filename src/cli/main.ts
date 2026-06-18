#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseArgs, type CliCommand } from "./args";
import { diffRiskFindings } from "../diff/compare";
import { collectGraphEvidence } from "../evidence/collect";
import { readGitRefFile, type GitRefFileReader } from "../git/ref-file";
import { parseBunLockfile, parseBunLockText } from "../graph/npm-bun-lock";
import { parsePackageLockfile, parsePackageLockText } from "../graph/npm-package-lock";
import type { DependencyGraph } from "../graph/types";
import { normalizeAllLicenseEvidence, normalizeLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisk, evaluateLicenseRisks } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import { renderDiffReport } from "../report/diff-report";
import { renderExplainReport } from "../report/explain-report";
import { renderSarifReport } from "../report/sarif-report";
import { renderScanReport } from "../report/scan-report";
import { writeReportFile, type ReportWriter } from "../report/write-output";
import { discoverProject, type ProjectInput } from "../project/discover";
import { exitCodeForError, formatError, type OhriskError } from "../shared/errors";
import { isErr, ok, type Result } from "../shared/result";

export type CliIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readRefFile?: GitRefFileReader;
  writeReport?: ReportWriter;
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
    case "diff":
      return runDiff(command, io);
    case "explain":
      return runExplain(command, io);
  }
}

async function runDiff(
  command: Extract<CliCommand, { kind: "diff" }>,
  io: CliIO
): Promise<number> {
  const current = await scanProject({
    cwd: io.cwd,
    profile: command.profile,
    prodOnly: command.prodOnly
  });

  if (isErr(current)) {
    io.stderr(formatError(current.error));
    return exitCodeForError(current.error);
  }

  const relativeLockfilePath = path.relative(
    current.value.project.rootDir,
    current.value.project.lockfile.path
  );
  const readRefFile = io.readRefFile ?? readGitRefFile;
  const baselineLockfile = readRefFile({
    projectRoot: current.value.project.rootDir,
    ref: command.baselineRef,
    relativePath: relativeLockfilePath
  });

  if (isErr(baselineLockfile)) {
    io.stderr(formatError(baselineLockfile.error));
    return exitCodeForError(baselineLockfile.error);
  }

  const baselineGraph = parseLockfileTextForKind({
    kind: current.value.project.lockfile.kind,
    text: baselineLockfile.value,
    lockfilePath: `${command.baselineRef}:${relativeLockfilePath}`
  });

  if (isErr(baselineGraph)) {
    io.stderr(formatError(baselineGraph.error));
    return exitCodeForError(baselineGraph.error);
  }

  const scanGraph = command.prodOnly
    ? {
        ...baselineGraph.value,
        nodes: baselineGraph.value.nodes.filter((node) => node.dependencyType === "production")
      }
    : baselineGraph.value;
  const baselineEvidence = await collectGraphEvidence({
    graph: scanGraph,
    projectRoot: current.value.project.rootDir
  });

  if (isErr(baselineEvidence)) {
    io.stderr(formatError(baselineEvidence.error));
    return exitCodeForError(baselineEvidence.error);
  }

  const baselineLicenses = normalizeAllLicenseEvidence(baselineEvidence.value);
  const baselineFindings = evaluateLicenseRisks({
    licenses: baselineLicenses,
    dependencies: scanGraph.nodes,
    profile: command.profile
  });
  const diff = diffRiskFindings({
    baselineFindings,
    currentFindings: current.value.riskFindings
  });

  const output = renderDiffReport({
      baselineRef: command.baselineRef,
      profile: command.profile,
      prodOnly: command.prodOnly,
      diff,
      json: command.json,
      markdown: command.markdown
    });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (command.failOn && hasFailingFinding(diff.newFindings, command.failOn)) {
    return 1;
  }

  return 0;
}

async function runExplain(
  command: Extract<CliCommand, { kind: "explain" }>,
  io: CliIO
): Promise<number> {
  const normalizedLicense = normalizeLicenseEvidence({
    packageId: "input",
    packageJsonLicense: command.expression,
    files: [],
    source: "unavailable",
    warnings: []
  });
  const finding = evaluateLicenseRisk({
    license: normalizedLicense,
    dependency: {
      id: "input",
      name: "input",
      version: "0.0.0",
      ecosystem: "npm",
      dependencyType: "production",
      direct: true,
      paths: [["input"]]
    },
    profile: command.profile
  });

  const output = renderExplainReport({
      expression: command.expression,
      profile: command.profile,
      normalizedLicense,
      finding,
      json: command.json
    });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  return 0;
}

async function runScan(
  command: Extract<CliCommand, { kind: "scan" | "ci" }>,
  io: CliIO
): Promise<number> {
  const scanned = await scanProject({
    cwd: io.cwd,
    profile: command.profile,
    prodOnly: command.prodOnly
  });

  if (isErr(scanned)) {
    io.stderr(formatError(scanned.error));
    return exitCodeForError(scanned.error);
  }

  const reportInput = {
    project: scanned.value.project,
    graph: scanned.value.graph,
    evidence: scanned.value.evidence,
    normalizedLicenses: scanned.value.normalizedLicenses,
    riskFindings: scanned.value.riskFindings,
    profile: command.profile,
    prodOnly: command.prodOnly,
    json: command.json,
    markdown: command.markdown
  };

  const output = command.sarif ? renderSarifReport(reportInput) : renderScanReport(reportInput);
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (command.kind === "ci" && hasFailingFinding(scanned.value.riskFindings, command.failOn)) {
    return 1;
  }

  return 0;
}

async function scanProject(input: {
  cwd: string;
  profile: Extract<CliCommand, { kind: "scan" | "ci" | "diff" }>["profile"];
  prodOnly: boolean;
}) {
  const discovered = discoverProject({ cwd: input.cwd });

  if (isErr(discovered)) {
    return discovered;
  }

  const graph = parseProjectLockfile(discovered.value);

  if (isErr(graph)) {
    return graph;
  }

  const scanGraph = input.prodOnly
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
    return evidence;
  }

  const normalizedLicenses = normalizeAllLicenseEvidence(evidence.value);
  const riskFindings = evaluateLicenseRisks({
    licenses: normalizedLicenses,
    dependencies: scanGraph.nodes,
    profile: input.profile
  });

  return {
    ok: true as const,
    value: {
      project: discovered.value,
      graph: scanGraph,
      evidence: evidence.value,
      normalizedLicenses,
      riskFindings
    }
  };
}

function parseProjectLockfile(project: ProjectInput): Result<DependencyGraph, OhriskError> {
  switch (project.lockfile.kind) {
    case "bun":
      return parseBunLockfile(project.lockfile.path);
    case "package-lock":
      return parsePackageLockfile(project.lockfile.path);
  }
}

function parseLockfileTextForKind(input: {
  kind: ProjectInput["lockfile"]["kind"];
  text: string;
  lockfilePath: string;
}): Result<DependencyGraph, OhriskError> {
  switch (input.kind) {
    case "bun":
      return parseBunLockText(input.text, input.lockfilePath);
    case "package-lock":
      return parsePackageLockText(input.text, input.lockfilePath);
  }
}

function renderHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    "  ohrisk scan [--profile saas|distributed-app] [--prod] [--json|--sarif|--markdown] [--output <file>]",
    "  ohrisk ci [--profile saas|distributed-app] [--prod] [--json|--sarif|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "  ohrisk diff <baseline-ref> [--profile saas|distributed-app] [--prod] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "  ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
    "  ohrisk --version",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "  ci      Run a scan and exit non-zero when findings meet the fail threshold.",
    "  diff    Compare current findings against a baseline git ref.",
    "  explain Explain how a license expression is classified for a profile.",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --prod                 Limit later scan stages to production dependencies.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --fail-on <severity>   CI threshold. Defaults to high for ci.",
    "  --version, -v          Print the Ohrisk package version."
  ].join("\n");
}

function emitReport(input: {
  contents: string;
  outputPath: string | undefined;
  io: CliIO;
}): Result<void, OhriskError> {
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

  return ok(undefined);
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
