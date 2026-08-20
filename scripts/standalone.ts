import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export type StandaloneTargetId =
  | "linux-x64"
  | "linux-arm64"
  | "macos-x64"
  | "macos-arm64"
  | "windows-x64"
  | "windows-arm64";

export type StandaloneBunTarget =
  | "bun-linux-x64-baseline"
  | "bun-linux-arm64"
  | "bun-darwin-x64-baseline"
  | "bun-darwin-arm64"
  | "bun-windows-x64-baseline"
  | "bun-windows-arm64";

export type StandaloneExecutableFormat = "elf" | "mach-o" | "pe";

export type StandaloneTarget = {
  id: StandaloneTargetId;
  bunTarget: StandaloneBunTarget;
  assetName: string;
  platform: "linux" | "darwin" | "win32";
  architecture: "x64" | "arm64";
  format: StandaloneExecutableFormat;
  machine: number;
};

export const STANDALONE_ENTRYPOINT = "scripts/standalone-entrypoint.ts";
export const STANDALONE_RELEASE_DIRECTORY = "release/standalone";
export const STANDALONE_CHECKSUM_FILENAME = "SHA256SUMS";

export const STANDALONE_TARGETS: readonly StandaloneTarget[] = [
  {
    id: "linux-x64",
    bunTarget: "bun-linux-x64-baseline",
    assetName: "ohrisk-linux-x64",
    platform: "linux",
    architecture: "x64",
    format: "elf",
    machine: 0x3e
  },
  {
    id: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    assetName: "ohrisk-linux-arm64",
    platform: "linux",
    architecture: "arm64",
    format: "elf",
    machine: 0xb7
  },
  {
    id: "macos-x64",
    bunTarget: "bun-darwin-x64-baseline",
    assetName: "ohrisk-macos-x64",
    platform: "darwin",
    architecture: "x64",
    format: "mach-o",
    machine: 0x01000007
  },
  {
    id: "macos-arm64",
    bunTarget: "bun-darwin-arm64",
    assetName: "ohrisk-macos-arm64",
    platform: "darwin",
    architecture: "arm64",
    format: "mach-o",
    machine: 0x0100000c
  },
  {
    id: "windows-x64",
    bunTarget: "bun-windows-x64-baseline",
    assetName: "ohrisk-windows-x64.exe",
    platform: "win32",
    architecture: "x64",
    format: "pe",
    machine: 0x8664
  },
  {
    id: "windows-arm64",
    bunTarget: "bun-windows-arm64",
    assetName: "ohrisk-windows-arm64.exe",
    platform: "win32",
    architecture: "arm64",
    format: "pe",
    machine: 0xaa64
  }
];

export type StandaloneBuildOptions = {
  repoRoot: string;
  outdir: string;
  targets: readonly StandaloneTarget[];
};

export type StandaloneBuildAsset = {
  target: StandaloneTargetId;
  assetName: string;
  path: string;
  bytes: number;
  sha256: string;
  smoked: boolean;
};

export type StandaloneBuildResult = {
  outdir: string;
  checksumPath: string;
  assets: readonly StandaloneBuildAsset[];
};

const MIN_STANDALONE_EXECUTABLE_BYTES = 1024 * 1024;
const NATIVE_SMOKE_TIMEOUT_MS = 30_000;

export function parseStandaloneBuildArgs(
  argv: readonly string[],
  cwd: string
): StandaloneBuildOptions {
  const repoRoot = path.resolve(cwd);
  assertOhriskRepositoryRoot(repoRoot);

  const selectedIds: StandaloneTargetId[] = [];
  let outdirArgument = STANDALONE_RELEASE_DIRECTORY;
  let nativeOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (argument === "--native") {
      nativeOnly = true;
      continue;
    }

    if (argument === "--target") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--target requires a standalone target id.");
      }
      selectedIds.push(parseStandaloneTargetId(value));
      index += 1;
      continue;
    }

    if (argument.startsWith("--target=")) {
      selectedIds.push(parseStandaloneTargetId(argument.slice("--target=".length)));
      continue;
    }

    if (argument === "--outdir") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--outdir requires a repository-relative path.");
      }
      outdirArgument = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--outdir=")) {
      outdirArgument = argument.slice("--outdir=".length);
      continue;
    }

    throw new Error(`Unknown standalone build argument: ${argument}`);
  }

  if (nativeOnly && selectedIds.length > 0) {
    throw new Error("--native cannot be combined with --target.");
  }

  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Standalone target ids must not be repeated.");
  }

  const selectedSet = nativeOnly
    ? new Set<StandaloneTargetId>([nativeStandaloneTarget().id])
    : new Set<StandaloneTargetId>(
        selectedIds.length > 0
          ? selectedIds
          : STANDALONE_TARGETS.map((target) => target.id)
      );
  const targets = STANDALONE_TARGETS.filter((target) => selectedSet.has(target.id));

  if (targets.length === 0) {
    throw new Error("At least one standalone target must be selected.");
  }

  return {
    repoRoot,
    outdir: resolveStandaloneOutputDirectory(repoRoot, outdirArgument),
    targets
  };
}

export async function buildStandaloneRelease(
  options: StandaloneBuildOptions
): Promise<StandaloneBuildResult> {
  const packageVersion = readPackageVersion(options.repoRoot);
  prepareStandaloneOutputDirectory(options.repoRoot, options.outdir);

  const assets: StandaloneBuildAsset[] = [];
  for (const target of options.targets) {
    const outputPath = path.join(options.outdir, target.assetName);
    console.log(`Building ${target.id} (${target.bunTarget})...`);

    const build = await Bun.build({
      entrypoints: [path.join(options.repoRoot, STANDALONE_ENTRYPOINT)],
      compile: {
        target: target.bunTarget,
        outfile: outputPath,
        autoloadDotenv: false,
        autoloadBunfig: false
      },
      minify: true
    });

    if (!build.success) {
      throw new Error([
        `Standalone build failed for ${target.id}.`,
        ...build.logs.map((log) => String(log))
      ].join("\n"));
    }

    if (!existsSync(outputPath)) {
      throw new Error(
        `Standalone build for ${target.id} did not create ${target.assetName}.`
      );
    }

    const executable = readFileSync(outputPath);
    if (executable.byteLength < MIN_STANDALONE_EXECUTABLE_BYTES) {
      throw new Error(
        `${target.assetName} is unexpectedly small: ${executable.byteLength} bytes.`
      );
    }
    assertStandaloneExecutableHeader(executable, target);

    if (target.platform !== "win32") {
      chmodSync(outputPath, 0o755);
    }

    const smoked = isNativeStandaloneTarget(target);
    if (smoked) {
      smokeStandaloneExecutable({
        executablePath: outputPath,
        packageVersion,
        repoRoot: options.repoRoot
      });
    }

    assets.push({
      target: target.id,
      assetName: target.assetName,
      path: outputPath,
      bytes: executable.byteLength,
      sha256: sha256(executable),
      smoked
    });
  }

  const checksumPath = path.join(
    options.outdir,
    STANDALONE_CHECKSUM_FILENAME
  );
  writeFileSync(
    checksumPath,
    renderSha256Sums(
      assets.map((asset) => ({
        assetName: asset.assetName,
        sha256: asset.sha256
      }))
    ),
    "utf8"
  );

  return {
    outdir: options.outdir,
    checksumPath,
    assets
  };
}

export function nativeStandaloneTarget(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): StandaloneTarget {
  const target = STANDALONE_TARGETS.find(
    (candidate) =>
      candidate.platform === platform
      && candidate.architecture === architecture
  );
  if (!target) {
    throw new Error(
      `Standalone builds do not support the current host: ${platform}/${architecture}.`
    );
  }
  return target;
}

export function isNativeStandaloneTarget(
  target: StandaloneTarget,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): boolean {
  return target.platform === platform && target.architecture === architecture;
}

export function resolveStandaloneOutputDirectory(
  repoRoot: string,
  value: string
): string {
  if (value.trim() === "") {
    throw new Error("--outdir must not be empty.");
  }
  if (path.isAbsolute(value)) {
    throw new Error("--outdir must be repository-relative.");
  }

  const resolvedRoot = path.resolve(repoRoot);
  const resolvedOutput = path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, resolvedOutput);

  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error("--outdir must stay below the repository root.");
  }

  assertNoSymlinkTraversal(resolvedRoot, relative);
  return resolvedOutput;
}

export function assertStandaloneExecutableHeader(
  executable: Buffer,
  target: StandaloneTarget
): void {
  switch (target.format) {
    case "elf":
      assertElfHeader(executable, target);
      return;
    case "mach-o":
      assertMachOHeader(executable, target);
      return;
    case "pe":
      assertPeHeader(executable, target);
      return;
  }
}

export function renderSha256Sums(
  entries: readonly { assetName: string; sha256: string }[]
): string {
  const names = new Set<string>();
  const lines = [...entries]
    .sort((left, right) =>
      left.assetName < right.assetName
        ? -1
        : left.assetName > right.assetName
          ? 1
          : 0
    )
    .map((entry) => {
      if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
        throw new Error(`Invalid SHA-256 digest for ${entry.assetName}.`);
      }
      if (
        entry.assetName === ""
        || entry.assetName.includes("/")
        || entry.assetName.includes("\\")
        || entry.assetName.includes("\n")
        || entry.assetName.includes("\r")
      ) {
        throw new Error(`Invalid standalone asset name: ${entry.assetName}`);
      }
      if (names.has(entry.assetName)) {
        throw new Error(`Duplicate standalone asset name: ${entry.assetName}`);
      }
      names.add(entry.assetName);
      return `${entry.sha256}  ${entry.assetName}`;
    });

  return `${lines.join("\n")}\n`;
}

function parseStandaloneTargetId(value: string): StandaloneTargetId {
  const target = STANDALONE_TARGETS.find((candidate) => candidate.id === value);
  if (!target) {
    throw new Error(
      `Unknown standalone target ${value}. Expected one of: ${
        STANDALONE_TARGETS.map((candidate) => candidate.id).join(", ")
      }.`
    );
  }
  return target.id;
}

function assertOhriskRepositoryRoot(repoRoot: string): void {
  const packagePath = path.join(repoRoot, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error("Standalone builds must run from the Ohrisk repository root.");
  }

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    name?: unknown;
  };
  if (packageJson.name !== "ohrisk") {
    throw new Error("package.json does not identify the Ohrisk repository.");
  }
}

function prepareStandaloneOutputDirectory(
  repoRoot: string,
  outdir: string
): void {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(outdir));
  resolveStandaloneOutputDirectory(repoRoot, relative);
  rmSync(outdir, { force: true, recursive: true });
  mkdirSync(outdir, { recursive: true });
}

function assertNoSymlinkTraversal(repoRoot: string, relative: string): void {
  let current = repoRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("--outdir must not traverse symbolic links.");
    }
  }
}

function readPackageVersion(repoRoot: string): string {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as { version?: unknown };
  if (
    typeof packageJson.version !== "string"
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)
  ) {
    throw new Error("package.json must contain an exact semantic version.");
  }
  return packageJson.version;
}

function assertElfHeader(
  executable: Buffer,
  target: StandaloneTarget
): void {
  if (
    executable.byteLength < 20
    || executable[0] !== 0x7f
    || executable[1] !== 0x45
    || executable[2] !== 0x4c
    || executable[3] !== 0x46
    || executable[4] !== 0x02
  ) {
    throw new Error(`${target.assetName} is not a 64-bit ELF executable.`);
  }

  const machine = executable.readUInt16LE(18);
  if (machine !== target.machine) {
    throw new Error(
      `${target.assetName} has ELF machine 0x${machine.toString(16)}, expected 0x${
        target.machine.toString(16)
      }.`
    );
  }
}

function assertMachOHeader(
  executable: Buffer,
  target: StandaloneTarget
): void {
  if (
    executable.byteLength < 8
    || executable.readUInt32LE(0) !== 0xfeedfacf
  ) {
    throw new Error(`${target.assetName} is not a 64-bit Mach-O executable.`);
  }

  const machine = executable.readUInt32LE(4);
  if (machine !== target.machine) {
    throw new Error(
      `${target.assetName} has Mach-O CPU type 0x${machine.toString(16)}, expected 0x${
        target.machine.toString(16)
      }.`
    );
  }
}

function assertPeHeader(
  executable: Buffer,
  target: StandaloneTarget
): void {
  if (
    executable.byteLength < 64
    || executable[0] !== 0x4d
    || executable[1] !== 0x5a
  ) {
    throw new Error(`${target.assetName} is not a PE executable.`);
  }

  const peOffset = executable.readUInt32LE(0x3c);
  if (
    peOffset > executable.byteLength - 6
    || executable.readUInt32LE(peOffset) !== 0x00004550
  ) {
    throw new Error(`${target.assetName} has an invalid PE signature.`);
  }

  const machine = executable.readUInt16LE(peOffset + 4);
  if (machine !== target.machine) {
    throw new Error(
      `${target.assetName} has PE machine 0x${machine.toString(16)}, expected 0x${
        target.machine.toString(16)
      }.`
    );
  }
}

function smokeStandaloneExecutable(input: {
  executablePath: string;
  packageVersion: string;
  repoRoot: string;
}): void {
  const version = runStandaloneCommand(
    input.executablePath,
    ["version"],
    input.repoRoot
  );
  const expectedVersion = `ohrisk ${input.packageVersion}`;
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(
      `Standalone version mismatch: expected "${expectedVersion}", received "${
        version.stdout.trim()
      }".`
    );
  }

  const explain = runStandaloneCommand(
    input.executablePath,
    ["explain", "MIT", "--json"],
    input.repoRoot
  );
  let report: { status?: unknown; expression?: unknown };
  try {
    report = JSON.parse(explain.stdout) as {
      status?: unknown;
      expression?: unknown;
    };
  } catch (cause) {
    throw new Error(
      `Standalone explain smoke returned invalid JSON: ${errorMessage(cause)}`
    );
  }
  if (
    report.status !== "license_explained"
    || report.expression !== "MIT"
  ) {
    throw new Error(
      "Standalone explain smoke returned an unexpected report contract."
    );
  }
}

function runStandaloneCommand(
  executablePath: string,
  args: readonly string[],
  cwd: string
): { stdout: string; stderr: string } {
  const result = spawnSync(executablePath, [...args], {
    cwd,
    encoding: "utf8",
    timeout: NATIVE_SMOKE_TIMEOUT_MS,
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error([
      `Standalone smoke failed: ${path.basename(executablePath)} ${args.join(" ")}`,
      `exit: ${result.status}`,
      result.stdout ? `stdout:\n${result.stdout}` : undefined,
      result.stderr ? `stderr:\n${result.stderr}` : undefined
    ].filter(Boolean).join("\n"));
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
