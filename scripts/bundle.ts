import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const CLI_ENTRYPOINT = "src/cli/main.ts";
export const CLI_BUNDLE_FILENAME = "cli.js";
export const ACTION_BUNDLE_FINGERPRINT_PREFIX = "// ohrisk-action-source-sha256: ";
export const CLI_BUNDLE_VIRTUAL_DIRNAME = "/__ohrisk_bundle__";
export const CLI_BUNDLE_VIRTUAL_FILENAME = `${CLI_BUNDLE_VIRTUAL_DIRNAME}/${CLI_BUNDLE_FILENAME}`;

export async function buildCliBundle(outdir: string): Promise<string> {
  const sourceFingerprint = actionBundleSourceFingerprint();
  const result = await Bun.build({
    entrypoints: [CLI_ENTRYPOINT],
    naming: CLI_BUNDLE_FILENAME,
    outdir,
    packages: "bundle",
    target: "node",
    banner: `${ACTION_BUNDLE_FINGERPRINT_PREFIX}${sourceFingerprint}`,
    define: {
      __dirname: JSON.stringify(CLI_BUNDLE_VIRTUAL_DIRNAME),
      __filename: JSON.stringify(CLI_BUNDLE_VIRTUAL_FILENAME)
    }
  });

  if (!result.success) {
    throw new Error([
      "CLI bundle build failed.",
      ...result.logs.map((log) => String(log))
    ].join("\n"));
  }

  const bundlePath = path.join(outdir, CLI_BUNDLE_FILENAME);
  assertPortableCliBundle(bundlePath);
  chmodSync(bundlePath, 0o755);
  return bundlePath;
}

export function assertPortableCliBundle(bundlePath: string): void {
  const source = readFileSync(bundlePath, "utf8");
  const forbiddenFragments = [
    "// ohrisk-action-build-platform:",
    process.cwd(),
    process.cwd().replace(/\\/g, "/"),
    JSON.stringify(process.cwd()).slice(1, -1)
  ];
  const leakedFragment = forbiddenFragments.find(
    (fragment) => fragment !== "" && source.includes(fragment)
  );

  if (leakedFragment !== undefined) {
    throw new Error(
      `CLI bundle contains platform-specific build metadata or an absolute build path: ${leakedFragment}`
    );
  }
}

export function actionBundleSourceFingerprint(): string {
  const files = [
    "bun.lock",
    "package.json",
    ...listSourceFiles("src")
  ].sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");

  for (const file of files) {
    const normalizedPath = file.replace(/\\/g, "/");
    const normalizedContents = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    hash.update(`${normalizedPath}\0${normalizedContents}\0`, "utf8");
  }

  return hash.digest("hex");
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

export function assertVersionContract(): string {
  return readPackageVersion();
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
