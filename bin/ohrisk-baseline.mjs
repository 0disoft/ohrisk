#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const BASELINE_SCHEMA = "urn:ohrisk:schema:baseline:1.0.0";
const CHECK_SCHEMA = "urn:ohrisk:schema:baseline-check:1.0.0";
const SEVERITIES = ["low", "review", "unknown", "high"];
const DEFAULT_BASELINE_PATH = ".ohrisk-baseline.json";

const { command, options } = parseArguments(process.argv.slice(2));

try {
  if (command === "help") {
    process.stdout.write(`${renderHelp()}\n`);
    process.exitCode = 0;
  } else if (command === "create") {
    process.exitCode = createBaseline(options);
  } else {
    process.exitCode = checkBaseline(options);
  }
} catch (cause) {
  process.stderr.write(`ohrisk-baseline: ${errorMessage(cause)}\n`);
  process.exitCode = 2;
}

function createBaseline(options) {
  const reportPath = requiredPath(options.report, "--report");
  const outputPath = resolvedPath(options.output ?? DEFAULT_BASELINE_PATH);
  const report = readScanReport(reportPath);
  const baseline = baselineFromReport(report);

  writeJsonAtomically(outputPath, baseline);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      status: "baseline_created",
      path: displayPath(outputPath),
      findingCount: baseline.findings.length,
      configurationDigest: baseline.configurationDigest
    }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Created ${displayPath(outputPath)} with ${baseline.findings.length} reviewed finding${baseline.findings.length === 1 ? "" : "s"}.\n`
    );
  }

  return 0;
}

function checkBaseline(options) {
  const reportPath = requiredPath(options.report, "--report");
  const baselinePath = resolvedPath(options.baseline ?? DEFAULT_BASELINE_PATH);
  const failOn = options.failOn ?? "high";
  const report = readScanReport(reportPath);
  const baseline = readBaseline(baselinePath);
  const current = baselineFromReport(report);

  if (baseline.configurationDigest !== current.configurationDigest) {
    throw new Error([
      "baseline configuration does not match the current report.",
      `baseline: ${baseline.configurationDigest}`,
      `current: ${current.configurationDigest}`,
      "Review the profile, production scope, effective policy contents, and report schema before regenerating the baseline."
    ].join(" "));
  }

  const previousById = new Map(
    baseline.findings.map((finding) => [finding.id, finding])
  );
  const newFindings = [];
  const changedFindings = [];
  const escalatedFindings = [];

  for (const finding of current.findings) {
    const previous = previousById.get(finding.id);
    if (!previous) {
      newFindings.push(finding);
      continue;
    }
    if (severityRank(finding.severity) > severityRank(previous.severity)) {
      escalatedFindings.push({
        ...finding,
        previousSeverity: previous.severity
      });
      continue;
    }
    if (finding.fingerprint !== previous.fingerprint) {
      changedFindings.push({
        ...finding,
        previousFingerprint: previous.fingerprint,
        previousSeverity: previous.severity
      });
    }
  }

  const introducedFindings = [...newFindings, ...changedFindings, ...escalatedFindings]
    .sort(compareFindings);
  const failingFindings = introducedFindings.filter(
    (finding) => severityRank(finding.severity) >= severityRank(failOn)
  );
  const result = {
    $schema: CHECK_SCHEMA,
    schemaVersion: "1.0.0",
    status: "baseline_checked",
    failed: failingFindings.length > 0,
    failOn,
    baselineFindingCount: baseline.findings.length,
    currentFindingCount: current.findings.length,
    newFindingCount: newFindings.length,
    changedFindingCount: changedFindings.length,
    escalatedFindingCount: escalatedFindings.length,
    introducedFindingCount: introducedFindings.length,
    failingFindingCount: failingFindings.length,
    introducedFindings,
    failingFindings
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderCheckResult(result)}\n`);
  }

  return result.failed ? 1 : 0;
}

function baselineFromReport(report) {
  const findingsById = new Map();

  for (const rawFinding of report.findings) {
    const finding = normalizeFinding(rawFinding);
    if (findingsById.has(finding.id)) {
      throw new Error(`scan report contains duplicate finding id ${JSON.stringify(finding.id)}.`);
    }
    findingsById.set(finding.id, finding);
  }

  const findings = [...findingsById.values()].sort(compareFindings);
  const configuration = {
    reportSchema: report.$schema,
    profile: report.profile,
    prodOnly: report.prodOnly,
    policyDigest: report.policy.digest
  };

  return {
    $schema: BASELINE_SCHEMA,
    schemaVersion: "1.0.0",
    sourceReportSchema: report.$schema,
    profile: report.profile,
    prodOnly: report.prodOnly,
    configurationDigest: sha256(stableJson(configuration)),
    findings
  };
}

function readScanReport(filePath) {
  const report = readJson(filePath);
  if (!isObject(report)) {
    throw new Error(`${displayPath(filePath)} must contain a JSON object.`);
  }
  if (
    typeof report.$schema !== "string"
    || !report.$schema.startsWith("urn:ohrisk:schema:scan-report:")
  ) {
    throw new Error(`${displayPath(filePath)} is not an Ohrisk scan JSON report.`);
  }
  if (typeof report.profile !== "string" || typeof report.prodOnly !== "boolean") {
    throw new Error(`${displayPath(filePath)} is missing profile or prodOnly metadata.`);
  }
  if (
    !isObject(report.policy)
    || typeof report.policy.digest !== "string"
    || !/^[0-9a-f]{64}$/.test(report.policy.digest)
    || !Array.isArray(report.findings)
  ) {
    throw new Error(`${displayPath(filePath)} is missing policy or findings data.`);
  }
  return report;
}

function readBaseline(filePath) {
  const baseline = readJson(filePath);
  if (!isObject(baseline) || baseline.$schema !== BASELINE_SCHEMA) {
    throw new Error(`${displayPath(filePath)} is not an Ohrisk baseline file.`);
  }
  if (
    baseline.schemaVersion !== "1.0.0"
    || typeof baseline.configurationDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(baseline.configurationDigest)
    || !Array.isArray(baseline.findings)
  ) {
    throw new Error(`${displayPath(filePath)} has an unsupported baseline shape.`);
  }

  const findings = baseline.findings.map(normalizeFinding).sort(compareFindings);
  const findingIds = new Set();
  for (const finding of findings) {
    if (findingIds.has(finding.id)) {
      throw new Error(`baseline contains duplicate finding id ${JSON.stringify(finding.id)}.`);
    }
    findingIds.add(finding.id);
  }

  return {
    ...baseline,
    findings
  };
}

function normalizeFinding(value) {
  if (!isObject(value)) {
    throw new Error("Every finding must be a JSON object.");
  }
  const { fingerprint, id, packageId, severity } = value;
  if (
    typeof fingerprint !== "string"
    || fingerprint.length === 0
    || typeof id !== "string"
    || id.length === 0
    || typeof packageId !== "string"
    || packageId.length === 0
    || !SEVERITIES.includes(severity)
  ) {
    throw new Error("Every finding must contain fingerprint, id, packageId, and a supported severity.");
  }
  return { fingerprint, id, packageId, severity };
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", options: {} };
  }

  const command = argv[0];
  if (command !== "create" && command !== "check") {
    throw new Error(`unknown command ${JSON.stringify(command)}. Run ohrisk-baseline help.`);
  }

  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--report":
        options.report = nextValue(argv, ++index, argument);
        break;
      case "--output":
        if (command !== "create") {
          throw new Error("--output is supported only by create.");
        }
        options.output = nextValue(argv, ++index, argument);
        break;
      case "--baseline":
        if (command !== "check") {
          throw new Error("--baseline is supported only by check.");
        }
        options.baseline = nextValue(argv, ++index, argument);
        break;
      case "--fail-on": {
        if (command !== "check") {
          throw new Error("--fail-on is supported only by check.");
        }
        const severity = nextValue(argv, ++index, argument);
        if (!SEVERITIES.includes(severity)) {
          throw new Error(`--fail-on must be one of ${SEVERITIES.join(", ")}.`);
        }
        options.failOn = severity;
        break;
      }
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        return { command: "help", options: {} };
      default:
        throw new Error(`unknown option ${JSON.stringify(argument)}. Run ohrisk-baseline help.`);
    }
  }

  return { command, options };
}

function nextValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function requiredPath(value, option) {
  if (!value) {
    throw new Error(`${option} is required.`);
  }
  return resolvedPath(value);
}

function resolvedPath(value) {
  if (value.includes("\0")) {
    throw new Error("paths must not contain NUL bytes.");
  }
  return path.resolve(process.cwd(), value);
}

function readJson(filePath) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new Error(`cannot read ${displayPath(filePath)}: ${errorMessage(cause)}`);
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw new Error(`cannot parse ${displayPath(filePath)} as JSON: ${errorMessage(cause)}`);
  }
}

function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function renderCheckResult(result) {
  const lines = [
    "Ohrisk baseline check",
    `Baseline findings: ${result.baselineFindingCount}`,
    `Current findings: ${result.currentFindingCount}`,
    `New findings: ${result.newFindingCount}`,
    `Changed findings: ${result.changedFindingCount}`,
    `Escalated findings: ${result.escalatedFindingCount}`,
    `Failing findings at or above ${result.failOn}: ${result.failingFindingCount}`
  ];

  for (const finding of result.introducedFindings) {
    const previous = "previousSeverity" in finding
      ? `, previously ${finding.previousSeverity}`
      : "";
    lines.push(
      `  ${finding.severity.toUpperCase()} ${finding.packageId} (${finding.id}${previous})`
    );
  }

  lines.push(result.failed ? "Result: failed" : "Result: passed");
  return lines.join("\n");
}

function renderHelp() {
  return [
    "Usage:",
    "  ohrisk-baseline create --report <scan.json> [--output <baseline.json>] [--json]",
    "  ohrisk-baseline check --report <scan.json> [--baseline <baseline.json>] [--fail-on high|unknown|review|low] [--json]",
    "",
    "Create stores semantic finding fingerprints from an Ohrisk scan JSON report.",
    "Check fails for new findings, changed semantics, or severity escalations at the selected threshold.",
    `The default baseline path is ${DEFAULT_BASELINE_PATH}.`
  ].join("\n");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareFindings(left, right) {
  return compareStrings(left.fingerprint, right.fingerprint)
    || compareStrings(left.packageId, right.packageId)
    || compareStrings(left.id, right.id);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank === -1) {
    throw new Error(`unsupported severity ${JSON.stringify(severity)}.`);
  }
  return rank;
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
