import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPOSITORY_URL = "https://github.com/tailscale/tailscale";
const OUTPUT_DIRECTORY = path.join(".tmp", "live-scans");
const WORK_DIRECTORY = path.join(OUTPUT_DIRECTORY, "tailscale-matrix-work");
const TOOLING_PACKAGE_MARKER = "golangci-lint";

type Finding = {
  packageId?: unknown;
  dependencyType?: unknown;
  evidence?: unknown;
  paths?: unknown;
};

type ScanReport = {
  dependencyGraph?: { total?: unknown; direct?: unknown; transitive?: unknown };
  evidence?: { sources?: Record<string, { packages?: unknown }> };
  risks?: Record<string, unknown>;
  findings?: unknown;
};

type ScanSummary = {
  label: string;
  dependencyGraph: { total: number; direct: number; transitive: number };
  risks: Record<string, number>;
  evidencePackages: Record<string, number>;
  toolingPackageCount: number;
  toolingPackages: string[];
  toolRootEvidenceSources: string[];
  nonDevelopmentToolingPackages: string[];
};

mkdirSync(WORK_DIRECTORY, { recursive: true });

const cleanSummary = runScan({ label: "clean", productionOnly: false });
const toolingRoot = cleanSummary.toolingPackages.find((packageId) =>
  packageId.startsWith("github.com/golangci/golangci-lint@")
);
if (!toolingRoot) {
  throw new Error("The clean Tailscale report did not contain an exact golangci-lint module root.");
}
const hydratedGoRoot = hydrateGoModule(toolingRoot);
const localRepository = cloneTailscaleRepository();
const localSummary = runScan({
  label: "local",
  productionOnly: false,
  goEnvironmentRoot: hydratedGoRoot,
  repositoryDirectory: localRepository
});
const productionSummary = runScan({ label: "prod", productionOnly: true });
const summaries = [localSummary, cleanSummary, productionSummary];

const summaryPath = path.join(OUTPUT_DIRECTORY, "tailscale-matrix-summary.json");
writeFileSync(summaryPath, `${JSON.stringify({ repository: REPOSITORY_URL, scans: summaries }, null, 2)}\n`, "utf8");

const failures: string[] = [];
for (const summary of summaries.filter((value) => value.label !== "prod")) {
  if (summary.toolingPackageCount === 0) {
    failures.push(`${summary.label}: no ${TOOLING_PACKAGE_MARKER} tooling subtree was found`);
  }
  if (summary.nonDevelopmentToolingPackages.length > 0) {
    failures.push(
      `${summary.label}: tooling packages were not development-only: ${summary.nonDevelopmentToolingPackages.join(", ")}`
    );
  }
}
if (!localSummary.toolRootEvidenceSources.includes("local")) {
  failures.push("local: the hydrated golangci-lint module was not used as local evidence");
}
if (cleanSummary.toolRootEvidenceSources.includes("local")) {
  failures.push("clean: the isolated scan unexpectedly used local evidence for golangci-lint");
}
if (productionSummary.toolingPackageCount !== 0) {
  failures.push("prod: golangci-lint tooling packages remained in the production-only report");
}

process.stdout.write(`${JSON.stringify({ summaryPath, scans: summaries }, null, 2)}\n`);
if (failures.length > 0) {
  process.stderr.write(`Tailscale scan matrix failed:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}

function runScan(input: {
  label: "local" | "clean" | "prod";
  productionOnly: boolean;
  goEnvironmentRoot?: string;
  repositoryDirectory?: string;
}): ScanSummary {
  const isolatedRoot = mkdtempSync(path.join(WORK_DIRECTORY, `${input.label}-`));
  const outputPath = path.join(OUTPUT_DIRECTORY, `tailscale-${input.label}.json`);
  const artifactCache = input.repositoryDirectory
    ? path.join(input.repositoryDirectory, ".ohrisk-artifact-cache")
    : path.join(isolatedRoot, "artifact-cache");
  const invocationOutput = input.repositoryDirectory ? "tailscale-local.json" : outputPath;
  mkdirSync(artifactCache, { recursive: true });

  const environment = isolatedGoEnvironment(input.goEnvironmentRoot ?? isolatedRoot);

  const nodeCommand = process.platform === "win32" ? "node.exe" : "node";
  const argumentsList = [
    path.resolve("action-dist/cli.js"),
    "scan",
    "--json",
    "--output",
    invocationOutput,
    "--cache-dir",
    input.repositoryDirectory ? ".ohrisk-artifact-cache" : artifactCache,
    ...(input.repositoryDirectory ? ["--all"] : []),
    ...(input.productionOnly ? ["--prod"] : []),
    ...(input.repositoryDirectory ? [] : [REPOSITORY_URL])
  ];
  const result = Bun.spawnSync([nodeCommand, ...argumentsList], {
    cwd: input.repositoryDirectory ?? process.cwd(),
    env: environment,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit"
  });
  if (result.exitCode !== 0) {
    throw new Error(`Tailscale ${input.label} scan exited with ${result.exitCode}.`);
  }

  if (input.repositoryDirectory) {
    const localReportPath = path.join(input.repositoryDirectory, invocationOutput);
    writeFileSync(outputPath, readFileSync(localReportPath));
  }

  return summarizeReport(input.label, readScanReport(outputPath));
}

function cloneTailscaleRepository(): string {
  const checkoutRoot = mkdtempSync(path.join(WORK_DIRECTORY, "local-checkout-"));
  const repositoryDirectory = path.join(checkoutRoot, "tailscale");
  const gitCommand = process.platform === "win32" ? "git.exe" : "git";
  const result = Bun.spawnSync([
    gitCommand,
    "clone",
    "--depth",
    "1",
    "--no-tags",
    REPOSITORY_URL,
    repositoryDirectory
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit"
  });
  if (result.exitCode !== 0) {
    throw new Error("Failed to create the bounded local Tailscale checkout.");
  }
  return repositoryDirectory;
}

function hydrateGoModule(packageId: string): string {
  const goEnvironmentRoot = mkdtempSync(path.join(WORK_DIRECTORY, "local-go-cache-"));
  const environment = isolatedGoEnvironment(goEnvironmentRoot);
  environment.GOPROXY = "https://proxy.golang.org";
  environment.GOSUMDB = "sum.golang.org";
  environment.GOTOOLCHAIN = "local";
  const goCommand = process.platform === "win32" ? "go.exe" : "go";
  const result = Bun.spawnSync([goCommand, "mod", "download", "-json", packageId], {
    cwd: process.cwd(),
    env: environment,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit"
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to hydrate the exact Go module cache entry ${packageId}.`);
  }
  return goEnvironmentRoot;
}

function isolatedGoEnvironment(root: string): Record<string, string | undefined> {
  const goModCache = path.join(root, "go-mod-cache");
  const goPath = path.join(root, "go-path");
  const home = path.join(root, "home");
  mkdirSync(goModCache, { recursive: true });
  mkdirSync(goPath, { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    GOMODCACHE: path.resolve(goModCache),
    GOPATH: path.resolve(goPath),
    HOME: path.resolve(home),
    USERPROFILE: path.resolve(home)
  };
}

function readScanReport(reportPath: string): ScanReport {
  const value: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Tailscale report ${reportPath} was not a JSON object.`);
  }
  return value;
}

function summarizeReport(label: string, report: ScanReport): ScanSummary {
  const findings = Array.isArray(report.findings)
    ? report.findings.filter((value): value is Finding => isRecord(value))
    : [];
  const toolingFindings = findings.filter((finding) => findingPaths(finding).some((dependencyPath) =>
    dependencyPath.some((packageId) => packageId.toLowerCase().includes(TOOLING_PACKAGE_MARKER))
  ));
  const toolingPackages = uniqueStrings(toolingFindings.map((finding) => stringValue(finding.packageId)));
  const toolRootEvidenceSources = uniqueStrings(toolingFindings
    .filter((finding) => stringValue(finding.packageId).startsWith("github.com/golangci/golangci-lint@"))
    .flatMap(findingEvidenceSources));
  const nonDevelopmentToolingPackages = uniqueStrings(toolingFindings
    .filter((finding) => finding.dependencyType !== "development")
    .map((finding) => stringValue(finding.packageId)));

  return {
    label,
    dependencyGraph: {
      total: numberValue(report.dependencyGraph?.total),
      direct: numberValue(report.dependencyGraph?.direct),
      transitive: numberValue(report.dependencyGraph?.transitive)
    },
    risks: numericRecord(report.risks),
    evidencePackages: numericRecord(Object.fromEntries(
      Object.entries(report.evidence?.sources ?? {}).map(([source, value]) => [source, value.packages])
    )),
    toolingPackageCount: toolingPackages.length,
    toolingPackages,
    toolRootEvidenceSources,
    nonDevelopmentToolingPackages
  };
}

function findingEvidenceSources(finding: Finding): string[] {
  return Array.isArray(finding.evidence)
    ? finding.evidence
        .map(stringValue)
        .filter((value) => value.startsWith("source: "))
        .map((value) => value.slice("source: ".length))
    : [];
}

function findingPaths(finding: Finding): string[][] {
  return Array.isArray(finding.paths)
    ? finding.paths
        .filter((value): value is unknown[] => Array.isArray(value))
        .map((value) => value.map(stringValue).filter(Boolean))
    : [];
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, numberValue(entry)]));
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
