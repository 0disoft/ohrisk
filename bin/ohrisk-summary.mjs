#!/usr/bin/env node

import {
  appendFileSync,
  readFileSync,
  realpathSync
} from "node:fs";
import path from "node:path";

const SEVERITIES = ["low", "review", "unknown", "high"];
const DEFAULT_MAX_FINDINGS = 20;

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${renderHelp()}\n`);
    process.exitCode = 0;
  } else {
    process.exitCode = summarize(options);
  }
} catch (cause) {
  process.stderr.write(`ohrisk-summary: ${errorMessage(cause)}\n`);
  process.exitCode = 2;
}

function summarize(options) {
  const reportPath = resolveReportPath(options.report, options.workspace);
  const report = readReport(reportPath);
  const summary = summarizeReport(report, options.maxFindings);
  const markdown = renderMarkdown(summary);

  if (options.stepSummary) {
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!stepSummaryPath) {
      throw new Error("--step-summary requires GITHUB_STEP_SUMMARY.");
    }
    appendFileSync(stepSummaryPath, `${markdown}\n`, "utf8");
  }

  if (options.githubOutput) {
    writeGitHubOutputs(options.githubOutput, summary);
  }

  process.stdout.write(
    options.json
      ? `${JSON.stringify(summary, null, 2)}\n`
      : `${markdown}\n`
  );
  return 0;
}

function summarizeReport(report, maxFindings) {
  const reportType = report.status === "profile_risk_evaluated" ? "scan" : "diff";
  const findings = report.findings.map(normalizeFinding).sort(compareFindings);
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  const failOn = SEVERITIES.includes(report.failOn) ? report.failOn : undefined;
  const computedFailingCount = failOn
    ? findings.filter(
        (finding) => severityRank(finding.severity) >= severityRank(failOn)
      ).length
    : 0;
  const failingFindingCount = nonNegativeInteger(report.failingFindingCount)
    ?? computedFailingCount;
  const completeness = reportType === "scan" && isObject(report.completeness)
    && (report.completeness.status === "complete" || report.completeness.status === "partial")
    ? report.completeness.status
    : "not-reported";
  const waiverDriftFailed = report.waiverDriftFailed === true;
  const thresholdFailed = report.failed === true;
  const waivedFindingCount = reportType === "scan" && isObject(report.waivers)
    ? nonNegativeInteger(report.waivers.applied) ?? 0
    : 0;

  return {
    status: report.status,
    reportType,
    failed: thresholdFailed || waiverDriftFailed,
    thresholdFailed,
    waiverDriftFailed,
    failOn: failOn ?? null,
    completeness,
    findingCount: findings.length,
    failingFindingCount,
    waivedFindingCount,
    counts,
    shownFindingCount: Math.min(findings.length, maxFindings),
    omittedFindingCount: Math.max(0, findings.length - maxFindings),
    findings: findings.slice(0, maxFindings)
  };
}

function readReport(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read an Ohrisk JSON report from ${displayPath(filePath)}: ${errorMessage(cause)}`);
  }

  if (!isObject(parsed) || !Array.isArray(parsed.findings)) {
    throw new Error(`${displayPath(filePath)} does not contain an Ohrisk findings array.`);
  }
  if (
    parsed.status !== "profile_risk_evaluated"
    && parsed.status !== "risk_diff_evaluated"
  ) {
    throw new Error(`${displayPath(filePath)} is not a supported Ohrisk scan or diff report.`);
  }
  return parsed;
}

function normalizeFinding(value) {
  if (!isObject(value)) {
    throw new Error("Every report finding must be an object.");
  }
  const { id, packageId, severity, reason, action } = value;
  if (
    typeof id !== "string"
    || typeof packageId !== "string"
    || !SEVERITIES.includes(severity)
  ) {
    throw new Error("Every report finding must contain id, packageId, and a supported severity.");
  }
  return {
    id,
    packageId,
    severity,
    reason: typeof reason === "string" ? reason : "",
    action: typeof action === "string" ? action : ""
  };
}

function renderMarkdown(summary) {
  const outcome = summary.failed ? "Failed" : "Passed";
  const lines = [
    "## Ohrisk license-risk summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Result | ${outcome} |`,
    `| Report | ${summary.reportType} |`,
    `| Completeness | ${summary.completeness} |`,
    `| Findings | ${summary.findingCount} |`,
    `| High | ${summary.counts.high} |`,
    `| Unknown | ${summary.counts.unknown} |`,
    `| Review | ${summary.counts.review} |`,
    `| Low | ${summary.counts.low} |`,
    `| Waived | ${summary.waivedFindingCount} |`,
    `| Failing at threshold | ${summary.failingFindingCount} |`,
    ""
  ];

  if (summary.findings.length === 0) {
    lines.push("No active findings are present in this report.");
    return lines.join("\n");
  }

  lines.push(
    "### Active findings",
    "",
    "| Severity | Package | Finding | Reason |",
    "| --- | --- | --- | --- |"
  );
  for (const finding of summary.findings) {
    lines.push(
      `| ${escapeCell(finding.severity)} | ${escapeCell(finding.packageId)} | ${escapeCell(finding.id)} | ${escapeCell(finding.reason)} |`
    );
  }
  if (summary.omittedFindingCount > 0) {
    lines.push(
      "",
      `${summary.omittedFindingCount} additional finding${summary.omittedFindingCount === 1 ? " was" : "s were"} omitted from the summary. The report artifact remains authoritative.`
    );
  }
  return lines.join("\n");
}

function writeGitHubOutputs(filePath, summary) {
  const outputs = {
    status: summary.status,
    "report-type": summary.reportType,
    failed: String(summary.failed),
    completeness: summary.completeness,
    "finding-count": String(summary.findingCount),
    "failing-finding-count": String(summary.failingFindingCount),
    "high-count": String(summary.counts.high),
    "unknown-count": String(summary.counts.unknown),
    "review-count": String(summary.counts.review),
    "low-count": String(summary.counts.low),
    "waived-count": String(summary.waivedFindingCount),
    "waiver-drift-failed": String(summary.waiverDriftFailed)
  };
  appendFileSync(
    resolveUntrustedPath(filePath),
    `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8"
  );
}

function parseArguments(argv) {
  const options = {
    maxFindings: DEFAULT_MAX_FINDINGS,
    json: false,
    stepSummary: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--report":
        options.report = nextValue(argv, ++index, argument);
        break;
      case "--workspace":
        options.workspace = nextValue(argv, ++index, argument);
        break;
      case "--github-output":
        options.githubOutput = nextValue(argv, ++index, argument);
        break;
      case "--max-findings": {
        const rawValue = nextValue(argv, ++index, argument);
        if (!/^\d+$/.test(rawValue)) {
          throw new Error("--max-findings must be an integer from 0 to 100.");
        }
        const value = Number(rawValue);
        if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
          throw new Error("--max-findings must be an integer from 0 to 100.");
        }
        options.maxFindings = value;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--step-summary":
        options.stepSummary = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${JSON.stringify(argument)}. Run ohrisk-summary --help.`);
    }
  }

  if (!options.help && !options.report) {
    throw new Error("--report is required.");
  }
  return options;
}

function resolveReportPath(reportPath, workspacePath) {
  if (!reportPath) {
    throw new Error("--report is required.");
  }

  rejectControlCharacters(reportPath, "report path");

  if (!workspacePath) {
    return realpathSync(resolveUntrustedPath(reportPath));
  }

  rejectControlCharacters(workspacePath, "workspace path");
  if (path.isAbsolute(reportPath)) {
    throw new Error("--report must be workspace-relative when --workspace is set.");
  }
  const workspace = realpathSync(resolveUntrustedPath(workspacePath));
  const report = realpathSync(path.resolve(workspace, reportPath));
  const relative = path.relative(workspace, report);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("--report must resolve inside --workspace.");
  }
  return report;
}

function resolveUntrustedPath(value) {
  rejectControlCharacters(value, "path");
  return path.resolve(process.cwd(), value);
}

function rejectControlCharacters(value, label) {
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
}

function nextValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function renderHelp() {
  return [
    "Usage:",
    "  ohrisk-summary --report <report.json> [--max-findings <0..100>] [--json]",
    "  ohrisk-summary --report <report.json> --step-summary --github-output <path>",
    "",
    "Render a bounded Markdown summary from an Ohrisk scan or diff JSON report.",
    "--workspace constrains a relative report path to one real filesystem root."
  ].join("\n");
}

function compareFindings(left, right) {
  return severityRank(right.severity) - severityRank(left.severity)
    || left.packageId.localeCompare(right.packageId)
    || left.id.localeCompare(right.id);
}

function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank === -1) {
    throw new Error(`unsupported severity ${JSON.stringify(severity)}.`);
  }
  return rank;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function escapeCell(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replaceAll("\\", "/")
    : filePath;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
