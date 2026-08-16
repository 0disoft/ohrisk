import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import type {
  ExternalLicenseToolObservation,
  HeldoutLicenseCase
} from "./license-heldout";

const TOOL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TOOL_OUTPUT_BYTES = 32 * 1024 * 1024;

export type HeldoutCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type HeldoutCommandRunner = (
  command: string,
  argumentsList: readonly string[]
) => HeldoutCommandResult;

export function buildScanCodeArguments(inputRoot: string, outputPath: string): string[] {
  return ["--license", "--package", "--strip-root", "--json", outputPath, inputRoot];
}

export function buildLicenseeArguments(inputRoot: string): string[] {
  return ["detect", inputRoot, "--json", "--no-readme", "--packages"];
}

export function materializeHeldoutCases(
  root: string,
  cases: readonly HeldoutLicenseCase[]
): void {
  mkdirSync(root, { recursive: true });
  for (const item of cases) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(item.id)) {
      throw new Error(`Held-out case id is unsafe: ${item.id}.`);
    }
    const caseRoot = join(root, item.id);
    mkdirSync(caseRoot, { recursive: true });
    const declaredLicense = item.evidence.packageJsonLicense ?? item.evidence.metadataLicense;
    const packageJson = {
      name: `heldout-${item.id}`,
      version: "1.0.0",
      private: true,
      ...(declaredLicense === undefined ? {} : { license: declaredLicense })
    };
    writeFileSync(
      join(caseRoot, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8"
    );

    for (const file of item.evidence.files) {
      const target = safeEvidencePath(caseRoot, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.text, "utf8");
    }
  }
}

export function parseScanCodeHeldoutReport(
  input: unknown,
  caseIds: readonly string[]
): Record<string, ExternalLicenseToolObservation> {
  if (!isRecord(input)) {
    throw new Error("ScanCode report root must be an object.");
  }
  const version = scanCodeVersion(input.headers);
  const expressions = new Map(caseIds.map((id) => [id, new Set<string>()]));
  const failedCases = new Set<string>();

  for (const file of arrayRecords(input.files)) {
    const caseId = caseIdFromPath(file.path, caseIds);
    if (!caseId) {
      continue;
    }
    if (Array.isArray(file.scan_errors) && file.scan_errors.length > 0) {
      failedCases.add(caseId);
    }
    collectScanCodeExpressions(file, expressions.get(caseId));
    for (const packageData of arrayRecords(file.package_data)) {
      collectScanCodeExpressions(packageData, expressions.get(caseId));
    }
  }

  for (const packageData of arrayRecords(input.packages)) {
    for (const path of stringArray(packageData.datafile_paths)) {
      const caseId = caseIdFromPath(path, caseIds);
      if (caseId) {
        collectScanCodeExpressions(packageData, expressions.get(caseId));
      }
    }
  }

  return Object.fromEntries(caseIds.map((caseId) => {
    const common = version ? { version } : {};
    if (failedCases.has(caseId)) {
      return [caseId, {
        status: "error",
        ...common,
        note: "ScanCode reported one or more file scan errors."
      } satisfies ExternalLicenseToolObservation];
    }
    const detected = [...(expressions.get(caseId) ?? [])].sort();
    return detected.length > 0
      ? [caseId, { status: "detected", expressions: detected, ...common }]
      : [caseId, { status: "no-detection", ...common }];
  }));
}

export function parseLicenseeHeldoutReport(
  input: unknown,
  version?: string
): ExternalLicenseToolObservation {
  if (!isRecord(input)) {
    throw new Error("Licensee report root must be an object.");
  }
  const expressions = new Set<string>();
  for (const license of Array.isArray(input.licenses) ? input.licenses : []) {
    collectLicenseeExpression(license, expressions);
  }
  for (const matchedFile of arrayRecords(input.matched_files)) {
    collectLicenseeExpression(matchedFile.license, expressions);
    for (const license of Array.isArray(matchedFile.licenses) ? matchedFile.licenses : []) {
      collectLicenseeExpression(license, expressions);
    }
  }
  const detected = [...expressions].sort();
  const common = version ? { version } : {};
  return detected.length > 0
    ? { status: "detected", expressions: detected, ...common }
    : { status: "no-detection", ...common };
}

export function runHeldoutExternalTools(
  cases: readonly HeldoutLicenseCase[],
  options: {
    scancodeCommand?: string;
    licenseeCommand?: string;
    runCommand?: HeldoutCommandRunner;
  } = {}
): HeldoutLicenseCase[] {
  const runCommand = options.runCommand ?? runBoundedCommand;
  const scancodeCommand = options.scancodeCommand ?? "scancode";
  const licenseeCommand = options.licenseeCommand ?? "licensee";
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ohrisk-heldout-tools-"));
  const casesRoot = join(temporaryRoot, "cases");
  try {
    materializeHeldoutCases(casesRoot, cases);
    const scanCode = runScanCode({
      command: scancodeCommand,
      cases,
      casesRoot,
      outputPath: join(temporaryRoot, "scancode.json"),
      runCommand
    });
    const licensee = runLicensee({
      command: licenseeCommand,
      cases,
      casesRoot,
      runCommand
    });
    return cases.map((item) => ({
      ...item,
      external: {
        scancode: scanCode[item.id] ?? toolError("ScanCode", "did not return a case result"),
        licensee: licensee[item.id] ?? toolError("Licensee", "did not return a case result")
      }
    }));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function runScanCode(input: {
  command: string;
  cases: readonly HeldoutLicenseCase[];
  casesRoot: string;
  outputPath: string;
  runCommand: HeldoutCommandRunner;
}): Record<string, ExternalLicenseToolObservation> {
  const result = input.runCommand(
    input.command,
    buildScanCodeArguments(input.casesRoot, input.outputPath)
  );
  if (result.status !== 0) {
    return observationsForAll(input.cases, commandFailure("ScanCode", result));
  }
  try {
    const report = readBoundedJsonFile(input.outputPath, "ScanCode");
    return parseScanCodeHeldoutReport(report, input.cases.map((item) => item.id));
  } catch {
    return observationsForAll(input.cases, toolError("ScanCode", "returned an invalid report"));
  }
}

function runLicensee(input: {
  command: string;
  cases: readonly HeldoutLicenseCase[];
  casesRoot: string;
  runCommand: HeldoutCommandRunner;
}): Record<string, ExternalLicenseToolObservation> {
  const versionResult = input.runCommand(input.command, ["version"]);
  if (versionResult.status !== 0 && isMissingExecutable(versionResult)) {
    return observationsForAll(input.cases, commandFailure("Licensee", versionResult));
  }
  const version = versionResult.status === 0 ? firstVersion(versionResult.stdout) : undefined;
  return Object.fromEntries(input.cases.map((item) => {
    const result = input.runCommand(
      input.command,
      buildLicenseeArguments(join(input.casesRoot, item.id))
    );
    if (result.status !== 0) {
      return [item.id, commandFailure("Licensee", result)];
    }
    try {
      return [item.id, parseLicenseeHeldoutReport(parseBoundedJson(result.stdout, "Licensee"), version)];
    } catch {
      return [item.id, toolError("Licensee", "returned invalid JSON")];
    }
  }));
}

function runBoundedCommand(command: string, argumentsList: readonly string[]): HeldoutCommandResult {
  const result = spawnSync(command, [...argumentsList], {
    encoding: "utf8",
    maxBuffer: MAX_TOOL_OUTPUT_BYTES,
    timeout: TOOL_TIMEOUT_MS,
    windowsHide: true,
    shell: false
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {})
  };
}

function readBoundedJsonFile(path: string, tool: string): unknown {
  if (!existsSync(path) || statSync(path).size > MAX_TOOL_OUTPUT_BYTES) {
    throw new Error(`${tool} report is missing or oversized.`);
  }
  return parseBoundedJson(readFileSync(path, "utf8"), tool);
}

function parseBoundedJson(text: string, tool: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
    throw new Error(`${tool} output is oversized.`);
  }
  return JSON.parse(text) as unknown;
}

function observationsForAll(
  cases: readonly HeldoutLicenseCase[],
  observation: ExternalLicenseToolObservation
): Record<string, ExternalLicenseToolObservation> {
  return Object.fromEntries(cases.map((item) => [item.id, observation]));
}

function commandFailure(tool: string, result: HeldoutCommandResult): ExternalLicenseToolObservation {
  if (isMissingExecutable(result)) {
    return toolError(tool, "executable was not found");
  }
  if (result.error?.message.toLowerCase().includes("timed out")) {
    return toolError(tool, "execution timed out");
  }
  return toolError(tool, "exited unsuccessfully");
}

function isMissingExecutable(result: HeldoutCommandResult): boolean {
  return (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function toolError(tool: string, reason: string): ExternalLicenseToolObservation {
  return { status: "error", note: `${tool} ${reason}.` };
}

function safeEvidencePath(root: string, path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-z]:/iu.test(normalized)) {
    throw new Error(`Evidence path must be a safe relative path: ${path}.`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`Evidence path must be a safe relative path: ${path}.`);
  }
  return join(root, ...segments);
}

function scanCodeVersion(headers: unknown): string | undefined {
  for (const header of arrayRecords(headers)) {
    if (header.tool_name === "scancode-toolkit" && typeof header.tool_version === "string") {
      return header.tool_version;
    }
  }
  return undefined;
}

function collectScanCodeExpressions(
  record: Record<string, unknown>,
  target: Set<string> | undefined
): void {
  if (!target) {
    return;
  }
  for (const key of [
    "detected_license_expression_spdx",
    "declared_license_expression_spdx",
    "other_license_expression_spdx"
  ]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      target.add(record[key].trim());
    }
  }
  for (const key of ["spdx_license_expressions", "declared_license_expression_spdx"]) {
    for (const expression of stringArray(record[key])) {
      if (expression.trim()) {
        target.add(expression.trim());
      }
    }
  }
}

function collectLicenseeExpression(value: unknown, target: Set<string>): void {
  if (typeof value === "string") {
    const normalized = normalizeLicenseeIdentifier(value);
    if (normalized) {
      target.add(normalized);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of ["spdx_id", "spdxId"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      target.add(value[key].trim());
      return;
    }
  }
  if (typeof value.key === "string") {
    const normalized = normalizeLicenseeIdentifier(value.key);
    if (normalized) {
      target.add(normalized);
    }
  }
}

function normalizeLicenseeIdentifier(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const aliases: Readonly<Record<string, string>> = {
    "apache-2.0": "Apache-2.0",
    "bsd-2-clause": "BSD-2-Clause",
    "bsd-3-clause": "BSD-3-Clause",
    "cc0-1.0": "CC0-1.0",
    "gpl-2.0": "GPL-2.0-only",
    "gpl-3.0": "GPL-3.0-only",
    "isc": "ISC",
    "mit": "MIT",
    "mpl-2.0": "MPL-2.0",
    "unlicense": "Unlicense",
    "zlib": "Zlib"
  };
  return aliases[trimmed.toLowerCase()] ?? trimmed;
}

function caseIdFromPath(value: unknown, caseIds: readonly string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const segments = value.replace(/\\/gu, "/").split("/");
  return caseIds.find((caseId) => segments.includes(caseId));
}

function firstVersion(value: string): string | undefined {
  return value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/u)?.[0];
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
