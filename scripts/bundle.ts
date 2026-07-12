import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";

export const CLI_ENTRYPOINT = "src/cli/main.ts";
export const CLI_BUNDLE_FILENAME = "cli.js";

export async function buildCliBundle(outdir: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [CLI_ENTRYPOINT],
    naming: CLI_BUNDLE_FILENAME,
    outdir,
    packages: "bundle",
    target: "node"
  });

  if (!result.success) {
    throw new Error([
      "CLI bundle build failed.",
      ...result.logs.map((log) => String(log))
    ].join("\n"));
  }

  const bundlePath = path.join(outdir, CLI_BUNDLE_FILENAME);
  chmodSync(bundlePath, 0o755);
  return bundlePath;
}

export function assertVersionContract(): string {
  const packageVersion = readPackageVersion();
  const sourceVersion = readSourceVersion();

  if (sourceVersion !== packageVersion) {
    throw new Error(
      `Version mismatch: package.json declares ${packageVersion}, but src/cli/version.ts declares ${sourceVersion}.`
    );
  }

  return packageVersion;
}

export function assertBuiltCliVersion(cliPath: string, packageVersion: string): void {
  const result = spawnSync(process.execPath, [cliPath, "version"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Built CLI version check failed for ${cliPath}.`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const expectedOutput = `ohrisk ${packageVersion}`;
  const actualOutput = (result.stdout ?? "").trim();
  if (actualOutput !== expectedOutput) {
    throw new Error(
      `Built CLI version mismatch for ${cliPath}: expected "${expectedOutput}", but received "${actualOutput}".`
    );
  }
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    throw new Error("package.json must contain a non-empty string version.");
  }

  return packageJson.version;
}

function readSourceVersion(): string {
  const source = readFileSync("src/cli/version.ts", "utf8");
  const match = /OHRISK_VERSION\s*=\s*"([^"]+)"/.exec(source);
  if (!match?.[1]) {
    throw new Error("src/cli/version.ts must export a string OHRISK_VERSION constant.");
  }

  return match[1];
}
