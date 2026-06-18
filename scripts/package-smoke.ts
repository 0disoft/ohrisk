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

  const packStdout = run("npm", ["pack", "--json", "--pack-destination", packDir], repoRoot);

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

  run("bun", ["install"], consumerDir);
  const ohriskBin = path.join(
    consumerDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "ohrisk.exe" : "ohrisk"
  );

  const smokeOutput = run(ohriskBin, ["version"], consumerDir).trim();
  const expectedOutput = `ohrisk ${expectedVersion}`;

  if (!smokeOutput.includes(expectedOutput)) {
    throw new Error(
      `Packaged CLI smoke test expected "${expectedOutput}" but received "${smokeOutput}".`
    );
  }

  const scanOutput = run(ohriskBin, ["scan", "--json"], consumerDir);
  const scanReport = readJsonObject(scanOutput);
  if (scanReport.status !== "profile_risk_evaluated") {
    throw new Error(
      `Packaged CLI scan smoke test expected status "profile_risk_evaluated" but received "${String(scanReport.status)}".`
    );
  }
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
