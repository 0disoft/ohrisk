import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";

const packageVersion = assertVersionContract();

rmSync("dist", { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: ["src/cli/main.ts"],
  naming: "cli.js",
  outdir: "dist",
  packages: "bundle",
  target: "node"
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

chmodSync("dist/cli.js", 0o755);
assertBuiltCliVersion(packageVersion);

function assertVersionContract(): string {
  const packageVersion = readPackageVersion();
  const sourceVersion = readSourceVersion();

  if (sourceVersion !== packageVersion) {
    console.error(
      `Version mismatch: package.json declares ${packageVersion}, but src/cli/version.ts declares ${sourceVersion}.`
    );
    process.exit(1);
  }

  return packageVersion;
}

function assertBuiltCliVersion(packageVersion: string): void {
  const result = spawnSync(process.execPath, ["dist/cli.js", "version"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    console.error(
      [
        "Built CLI version check failed.",
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
    process.exit(1);
  }

  const expectedOutput = `ohrisk ${packageVersion}`;
  const actualOutput = (result.stdout ?? "").trim();

  if (actualOutput !== expectedOutput) {
    console.error(
      `Built CLI version mismatch: expected "${expectedOutput}", but received "${actualOutput}".`
    );
    process.exit(1);
  }
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    console.error("package.json must contain a non-empty string version.");
    process.exit(1);
  }

  return packageJson.version;
}

function readSourceVersion(): string {
  const source = readFileSync("src/cli/version.ts", "utf8");
  const match = /OHRISK_VERSION\s*=\s*"([^"]+)"/.exec(source);
  if (!match?.[1]) {
    console.error("src/cli/version.ts must export a string OHRISK_VERSION constant.");
    process.exit(1);
  }

  return match[1];
}
