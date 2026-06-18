#!/usr/bin/env bun
import path from "node:path";

import { parseArgs, type CliCommand } from "./args";
import { collectGraphEvidence } from "../evidence/collect";
import { parseBunLockfile } from "../graph/npm-bun-lock";
import type { DependencyGraph } from "../graph/types";
import { normalizeAllLicenseEvidence } from "../license/normalize";
import type { NormalizedLicense } from "../license/types";
import { evaluateLicenseRisks } from "../policy/evaluate";
import type { RiskFinding, RiskSeverity } from "../policy/types";
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
    renderScanSkeleton(
      discovered.value,
      scanGraph,
      evidence.value,
      normalizedLicenses,
      riskFindings,
      command
    )
  );
  return 0;
}

function renderScanSkeleton(
  project: ProjectInput,
  graph: DependencyGraph,
  evidence: Array<{ files: unknown[]; warnings: string[] }>,
  normalizedLicenses: NormalizedLicense[],
  riskFindings: RiskFinding[],
  command: Extract<CliCommand, { kind: "scan" }>
): string {
  const directCount = graph.nodes.filter((node) => node.direct).length;
  const transitiveCount = graph.nodes.length - directCount;
  const evidenceFileCount = evidence.reduce((sum, item) => sum + item.files.length, 0);
  const evidenceWarningCount = evidence.reduce((sum, item) => sum + item.warnings.length, 0);
  const licenseSummary = summarizeLicenses(normalizedLicenses);
  const riskSummary = summarizeRiskFindings(riskFindings);

  if (command.json) {
    return JSON.stringify(
      {
        status: "profile_risk_evaluated",
        projectRoot: project.rootDir,
        lockfile: {
          kind: project.lockfile.kind,
          path: project.lockfile.path
        },
        profile: command.profile,
        prodOnly: command.prodOnly,
        dependencyGraph: {
          total: graph.nodes.length,
          direct: directCount,
          transitive: transitiveCount
        },
        evidence: {
          packages: evidence.length,
          files: evidenceFileCount,
          warnings: evidenceWarningCount
        },
        licenses: {
          highConfidence: licenseSummary.high,
          mediumConfidence: licenseSummary.medium,
          lowConfidence: licenseSummary.low,
          missing: licenseSummary.missing,
          malformed: licenseSummary.malformed
        },
        risks: {
          high: riskSummary.high,
          review: riskSummary.review,
          unknown: riskSummary.unknown,
          low: riskSummary.low
        }
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
    `Dependencies: ${graph.nodes.length} total, ${directCount} direct, ${transitiveCount} transitive`,
    `Evidence: ${evidenceFileCount} files, ${evidenceWarningCount} warnings`,
    `Licenses: ${licenseSummary.high} high-confidence, ${licenseSummary.medium} medium-confidence, ${licenseSummary.low} low-confidence`,
    `Risks: ${riskSummary.high} high, ${riskSummary.review} review, ${riskSummary.unknown} unknown, ${riskSummary.low} low`,
    "Status: profile-aware risk evaluated",
    "Next: render actionable package findings."
  ].join("\n");
}

function summarizeLicenses(normalizedLicenses: NormalizedLicense[]): {
  high: number;
  medium: number;
  low: number;
  missing: number;
  malformed: number;
} {
  return normalizedLicenses.reduce(
    (summary, license) => {
      summary[license.confidence] += 1;

      if (license.signals.includes("missing")) {
        summary.missing += 1;
      }

      if (license.signals.includes("malformed")) {
        summary.malformed += 1;
      }

      return summary;
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      missing: 0,
      malformed: 0
    }
  );
}

function summarizeRiskFindings(riskFindings: RiskFinding[]): Record<RiskSeverity, number> {
  return riskFindings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    {
      high: 0,
      review: 0,
      unknown: 0,
      low: 0
    }
  );
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
