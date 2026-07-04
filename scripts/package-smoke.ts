import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const expectedVersion = readPackageVersion(repoRoot);
const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-package-smoke-"));

try {
  const packDir = path.join(workspace, "pack");
  const consumerDir = path.join(workspace, "consumer");

  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const packStdout = run(
    "npm",
    ["pack", "--silent", "--json", "--pack-destination", packDir],
    repoRoot
  );

  const packOutput = readFirstJsonObject(packStdout);
  const filename = packOutput?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not return a package filename.");
  }

  const tarballPath = path.join(packDir, filename).replaceAll("\\", "/");
  writeFileSync(
    path.join(consumerDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          ohrisk: `file:${tarballPath}`
        }
      },
      null,
      2
    ),
    "utf8"
  );

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], consumerDir);
  const consumerBinDir = path.join(consumerDir, "node_modules", ".bin");

  const smokeOutput = runWithPath("ohrisk", ["version"], consumerDir, consumerBinDir).trim();
  const expectedOutput = `ohrisk ${expectedVersion}`;

  if (smokeOutput !== expectedOutput) {
    throw new Error(
      `Packaged CLI smoke test expected "${expectedOutput}" but received "${smokeOutput}".`
    );
  }

  const scanOutput = runWithPath("ohrisk", ["scan", "--json"], consumerDir, consumerBinDir);
  const scanReport = readJsonObject(scanOutput);
  if (scanReport.status !== "profile_risk_evaluated") {
    throw new Error(
      `Packaged CLI scan smoke test expected status "profile_risk_evaluated" but received "${String(scanReport.status)}".`
    );
  }

  const sarifOutput = runWithPath("ohrisk", ["scan", "--sarif"], consumerDir, consumerBinDir);
  assertSarifReport(readJsonObject(sarifOutput), expectedVersion);

  const cyclonedxOutput = runWithPath(
    "ohrisk",
    ["scan", "--cyclonedx"],
    consumerDir,
    consumerBinDir
  );
  assertCycloneDxReport(readJsonObject(cyclonedxOutput));

  const markdownOutput = runWithPath(
    "ohrisk",
    ["scan", "--markdown"],
    consumerDir,
    consumerBinDir
  );
  assertMarkdownReport(markdownOutput);
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout ?? "";
}

function runWithPath(command: string, args: string[], cwd: string, binDir: string): string {
  const pathKey = pathEnvironmentKey();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ""}`
    }
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout ?? "";
}

function pathEnvironmentKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function readPackageVersion(rootDir: string): string {
  const packageJson = readJsonObject(readFileSync(path.join(rootDir, "package.json"), "utf8"));

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must contain a string version.");
  }

  return packageJson.version;
}

function readFirstJsonObject(stdout: string): { filename?: unknown } | undefined {
  const parsed = JSON.parse(stdout) as unknown;
  if (Array.isArray(parsed)) {
    return isJsonObject(parsed[0]) ? parsed[0] : undefined;
  }

  return isJsonObject(parsed) ? parsed : undefined;
}

function readJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error("Expected a JSON object.");
  }

  return parsed;
}

function assertSarifReport(report: Record<string, unknown>, expectedVersion: string): void {
  if (report.version !== "2.1.0") {
    throw new Error(
      `Packaged CLI SARIF smoke test expected SARIF version "2.1.0" but received "${String(report.version)}".`
    );
  }

  const runs = report.runs;
  if (!Array.isArray(runs) || !isJsonObject(runs[0])) {
    throw new Error("Packaged CLI SARIF smoke test expected at least one run.");
  }

  const tool = runs[0].tool;
  const driver = isJsonObject(tool) && isJsonObject(tool.driver) ? tool.driver : undefined;
  if (!driver || driver.semanticVersion !== expectedVersion) {
    throw new Error(
      `Packaged CLI SARIF smoke test expected semanticVersion "${expectedVersion}" but received "${String(driver?.semanticVersion)}".`
    );
  }
}

function assertCycloneDxReport(report: Record<string, unknown>): void {
  if (report.bomFormat !== "CycloneDX") {
    throw new Error(
      `Packaged CLI CycloneDX smoke test expected bomFormat "CycloneDX" but received "${String(report.bomFormat)}".`
    );
  }

  if (report.specVersion !== "1.5") {
    throw new Error(
      `Packaged CLI CycloneDX smoke test expected specVersion "1.5" but received "${String(report.specVersion)}".`
    );
  }
}

function assertMarkdownReport(report: string): void {
  if (!report.includes("# Ohrisk scan")) {
    throw new Error("Packaged CLI Markdown smoke test expected an Ohrisk scan heading.");
  }

  if (!report.includes("- Risks:")) {
    throw new Error("Packaged CLI Markdown smoke test expected the risk summary.");
  }

  if (!report.includes("## Next")) {
    throw new Error("Packaged CLI Markdown smoke test expected the next-action section.");
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
