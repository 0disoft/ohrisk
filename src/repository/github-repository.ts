import { spawn } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";

export type GitHubRepository = {
  url: string;
  owner: string;
  name: string;
};

export type RepositorySubmoduleMode = "ignore" | "reject";

export type RepositorySubmoduleSummary = {
  total: number;
  paths: string[];
  pathsTruncated: boolean;
};

export type ClonedRepository = {
  rootDir: string;
  submodules: RepositorySubmoduleSummary;
  cleanup: () => void;
};

export type RepositoryCloneOptions = {
  submodules: RepositorySubmoduleMode;
};

export type RepositoryCloner = (
  repository: GitHubRepository,
  options: RepositoryCloneOptions
) => Promise<Result<ClonedRepository, OhriskError>>;

const GITHUB_HOSTNAME = "github.com";
const OWNER_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;
const REPOSITORY_PATTERN = /^(?![.-])[A-Za-z0-9._-]{1,100}(?<!\.)$/;
const CLONE_TIMEOUT_MS = 120_000;
const MAX_TREE_ENTRIES = 50_000;
const MAX_TREE_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_STAGING_BYTES = 512 * 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_PATH_SEGMENTS = 64;
const MAX_SEGMENT_BYTES = 255;
const MAX_GIT_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 64 * 1024;
const MAX_REPORTED_SUBMODULE_PATHS = 100;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

type GitRunResult = {
  exitCode: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  sizeLimitExceeded: boolean;
  outputLimitExceeded: boolean;
  spawnError?: string;
};

export function parseGitHubRepositoryUrl(
  value: string
): Result<GitHubRepository, OhriskError> {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err(invalidRepositoryUrl(value));
  }
  const authority = /^https:\/\/([^/]+)/iu.exec(trimmed)?.[1];

  if (
    url.protocol !== "https:"
    || authority?.toLowerCase() !== GITHUB_HOSTNAME
    || url.hostname.toLowerCase().replace(/\.$/, "") !== GITHUB_HOSTNAME
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname.includes("%")
  ) {
    return err(invalidRepositoryUrl(value));
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return err(invalidRepositoryUrl(value));
  }

  const owner = segments[0] ?? "";
  const rawName = segments[1] ?? "";
  const name = rawName.toLowerCase().endsWith(".git")
    ? rawName.slice(0, -4)
    : rawName;
  if (!OWNER_PATTERN.test(owner) || !REPOSITORY_PATTERN.test(name)) {
    return err(invalidRepositoryUrl(value));
  }

  return ok({
    url: `https://${GITHUB_HOSTNAME}/${owner}/${name}.git`,
    owner,
    name
  });
}

export const cloneGitHubRepository: RepositoryCloner = async (repository, options) => {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-repository-"));
  const repositoryRoot = path.join(stagingRoot, "repository");
  const deadline = Date.now() + CLONE_TIMEOUT_MS;
  const cleanup = createOwnedCleanup(stagingRoot);

  try {
    const cloned = await runGit({
      args: cloneArguments(repository.url, repositoryRoot),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: remainingTime(deadline)
    });
    const cloneFailure = gitFailure(cloned, "clone");
    if (cloneFailure) {
      cleanup();
      return err(cloneFailure);
    }

    const tree = await runGit({
      args: treeArguments(repositoryRoot),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: remainingTime(deadline)
    });
    const treeFailure = gitFailure(tree, "inspect");
    if (treeFailure) {
      cleanup();
      return err(treeFailure);
    }

    const validatedTree = validateGitTree(tree.stdout, options);
    if (isErr(validatedTree)) {
      cleanup();
      return validatedTree;
    }

    const checkedOut = await runGit({
      args: checkoutArguments(repositoryRoot),
      cwd: stagingRoot,
      stagingRoot,
      timeoutMs: remainingTime(deadline)
    });
    const checkoutFailure = gitFailure(checkedOut, "checkout");
    if (checkoutFailure) {
      cleanup();
      return err(checkoutFailure);
    }

    const materialized = validateMaterializedTree(repositoryRoot);
    if (isErr(materialized)) {
      cleanup();
      return materialized;
    }

    return ok({
      rootDir: repositoryRoot,
      submodules: validatedTree.value.submodules,
      cleanup
    });
  } catch (cause) {
    cleanup();
    return err(createError({
      code: "REPOSITORY_CLONE_FAILED",
      category: "filesystem",
      message: "Failed to prepare the temporary repository checkout.",
      details: {
        reason: "temporary_repository_failed",
        cause: sanitizeGitDiagnostic(cause instanceof Error ? cause.message : String(cause))
      }
    }));
  }
};

export function cloneArguments(repositoryUrl: string, destination: string): string[] {
  return [
    ...safeGitConfiguration(),
    "clone",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-checkout",
    "--no-recurse-submodules",
    "--no-local",
    repositoryUrl,
    destination
  ];
}

export function treeArguments(repositoryRoot: string): string[] {
  return [
    ...safeGitConfiguration(),
    "-C",
    repositoryRoot,
    "ls-tree",
    "-r",
    "-z",
    "-l",
    "--full-tree",
    "HEAD"
  ];
}

export function checkoutArguments(repositoryRoot: string): string[] {
  return [
    ...safeGitConfiguration(),
    "-C",
    repositoryRoot,
    "checkout",
    "--force",
    "--detach",
    "HEAD"
  ];
}

export function validateGitTree(
  treeOutput: Buffer,
  options: RepositoryCloneOptions = { submodules: "reject" }
): Result<{ submodules: RepositorySubmoduleSummary }, OhriskError> {
  if (treeOutput.length > 0 && treeOutput[treeOutput.length - 1] !== 0) {
    return err(repositoryTreeError("malformed_tree_output"));
  }
  const entries = splitNullTerminated(treeOutput);
  if (entries.length > MAX_TREE_ENTRIES) {
    return err(repositoryLimitError("entry_count", entries.length, MAX_TREE_ENTRIES));
  }

  let totalBytes = 0;
  let submoduleCount = 0;
  const submodulePaths: string[] = [];
  const compatiblePaths = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  for (const rawEntry of entries) {
    const tabIndex = rawEntry.indexOf(0x09);
    if (tabIndex <= 0) {
      return err(repositoryTreeError("malformed_tree_entry"));
    }

    const header = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64}) +([0-9]+|-)$/u.exec(
      rawEntry.subarray(0, tabIndex).toString("ascii")
    );
    if (!header) {
      return err(repositoryTreeError("malformed_tree_entry"));
    }
    const [, mode, type, , sizeText] = header;

    let repositoryPath: string;
    try {
      repositoryPath = decoder.decode(rawEntry.subarray(tabIndex + 1));
    } catch {
      return err(repositoryTreeError("path_not_utf8"));
    }
    const pathValidation = validateRepositoryPath(repositoryPath, compatiblePaths);
    if (isErr(pathValidation)) {
      return pathValidation;
    }

    if (mode === "160000") {
      if (type !== "commit") {
        return err(repositoryTreeError("unsupported_entry", repositoryPath));
      }
      if (options.submodules === "reject") {
        return err(repositoryTreeError("submodule", repositoryPath));
      }
      submoduleCount += 1;
      if (submodulePaths.length < MAX_REPORTED_SUBMODULE_PATHS) {
        submodulePaths.push(repositoryPath);
      }
      continue;
    }

    if (type !== "blob" || mode === "120000") {
      return err(repositoryTreeError(
        mode === "120000" ? "symbolic_link" : "unsupported_entry",
        repositoryPath
      ));
    }

    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(repositoryTreeError("unknown_file_size", repositoryPath));
    }
    if (size > MAX_FILE_BYTES) {
      return err(repositoryLimitError("file_size", size, MAX_FILE_BYTES));
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TREE_BYTES) {
      return err(repositoryLimitError("total_file_size", totalBytes, MAX_TREE_BYTES));
    }
  }

  return ok({
    submodules: {
      total: submoduleCount,
      paths: submodulePaths,
      pathsTruncated: submoduleCount > submodulePaths.length
    }
  });
}

function safeGitConfiguration(): string[] {
  return [
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "http.followRedirects=initial",
    "-c", "credential.helper=",
    "-c", "core.askPass=",
    "-c", "core.longpaths=true",
    "-c", "core.symlinks=false",
    "-c", "submodule.recurse=false"
  ];
}

function validateRepositoryPath(
  repositoryPath: string,
  compatiblePaths: Map<string, string>
): Result<void, OhriskError> {
  const pathBytes = Buffer.byteLength(repositoryPath, "utf8");
  const segments = repositoryPath.split("/");
  if (
    repositoryPath === ""
    || repositoryPath.startsWith("/")
    || repositoryPath.includes("\\")
    || pathBytes > MAX_PATH_BYTES
    || segments.length > MAX_PATH_SEGMENTS
  ) {
    return err(repositoryTreeError("invalid_path", repositoryPath));
  }

  let prefix = "";
  for (const segment of segments) {
    if (
      segment === ""
      || segment === "."
      || segment === ".."
      || segment.toLowerCase() === ".git"
      || Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES
      || /[\u0000-\u001f\u007f<>:"|?*]/u.test(segment)
      || /[. ]$/u.test(segment)
      || RESERVED_WINDOWS_NAME.test(segment)
    ) {
      return err(repositoryTreeError("invalid_path_segment", repositoryPath));
    }

    prefix = prefix ? `${prefix}/${segment}` : segment;
    const compatibilityKey = prefix.normalize("NFC").toLowerCase();
    const existing = compatiblePaths.get(compatibilityKey);
    if (existing !== undefined && existing !== prefix) {
      return err(repositoryTreeError("path_collision", repositoryPath));
    }
    compatiblePaths.set(compatibilityKey, prefix);
  }

  return ok(undefined);
}

function validateMaterializedTree(repositoryRoot: string): Result<void, OhriskError> {
  const pending = [repositoryRoot];
  let entries = 0;
  let totalBytes = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const name of readdirSync(directory)) {
      if (directory === repositoryRoot && name === ".git") continue;
      const entryPath = path.join(directory, name);
      const stats = lstatSync(entryPath);
      entries += 1;
      if (entries > MAX_TREE_ENTRIES) {
        return err(repositoryLimitError("materialized_entry_count", entries, MAX_TREE_ENTRIES));
      }
      if (stats.isSymbolicLink()) {
        return err(repositoryTreeError("materialized_symbolic_link"));
      }
      if (stats.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        return err(repositoryTreeError("materialized_special_file"));
      }
      totalBytes += stats.size;
      if (stats.size > MAX_FILE_BYTES || totalBytes > MAX_TREE_BYTES) {
        return err(repositoryLimitError(
          stats.size > MAX_FILE_BYTES ? "materialized_file_size" : "materialized_total_file_size",
          stats.size > MAX_FILE_BYTES ? stats.size : totalBytes,
          stats.size > MAX_FILE_BYTES ? MAX_FILE_BYTES : MAX_TREE_BYTES
        ));
      }
    }
  }

  return ok(undefined);
}

function splitNullTerminated(buffer: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) entries.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start !== buffer.length) {
    entries.push(buffer.subarray(start));
  }
  return entries;
}

async function runGit(input: {
  args: string[];
  cwd: string;
  stagingRoot: string;
  timeoutMs: number;
}): Promise<GitRunResult> {
  if (input.timeoutMs <= 0) {
    return emptyGitFailure({ timedOut: true });
  }

  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let sizeLimitExceeded = false;
    let outputLimitExceeded = false;
    let settled = false;
    const child = spawn("git", input.args, {
      cwd: input.cwd,
      env: gitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (result: GitRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(sizeMonitor);
      resolve(result);
    };
    const stop = (): void => {
      child.kill();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    const sizeMonitor = setInterval(() => {
      if (directorySize(input.stagingRoot, MAX_STAGING_BYTES) > MAX_STAGING_BYTES) {
        sizeLimitExceeded = true;
        stop();
      }
    }, 250);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_STDOUT_BYTES) {
        outputLimitExceeded = true;
        stop();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, MAX_GIT_STDERR_BYTES - stderrBytes);
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
      stderrBytes += chunk.length;
    });
    child.once("error", (cause) => finish({
      exitCode: null,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8"),
      timedOut,
      sizeLimitExceeded,
      outputLimitExceeded,
      spawnError: cause.message
    }));
    child.once("close", (exitCode) => finish({
      exitCode,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8"),
      timedOut,
      sizeLimitExceeded,
      outputLimitExceeded
    }));
  });
}

function directorySize(root: string, stopAfter: number): number {
  const pending = [root];
  let total = 0;
  while (pending.length > 0 && total <= stopAfter) {
    const current = pending.pop();
    if (!current) continue;
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) continue;
    if (stats.isFile()) {
      total += stats.size;
      continue;
    }
    if (!stats.isDirectory()) continue;
    try {
      for (const name of readdirSync(current)) pending.push(path.join(current, name));
    } catch {
      // A Git worker can rename pack files while the bounded size check walks the staging tree.
    }
  }
  return total;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /^GIT_CONFIG(?:_|$)/u.test(name)
      || /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|INDEX_FILE|CEILING_DIRECTORIES|EXEC_PATH|SSH|SSH_COMMAND|ASKPASS|PROXY_COMMAND)$/u.test(name)
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_ALLOW_PROTOCOL: "https",
    GIT_OPTIONAL_LOCKS: "0"
  };
}

function gitFailure(result: GitRunResult, stage: "clone" | "inspect" | "checkout"): OhriskError | undefined {
  if (
    result.exitCode === 0
    && !result.timedOut
    && !result.sizeLimitExceeded
    && !result.outputLimitExceeded
    && !result.spawnError
  ) {
    return undefined;
  }

  if (result.sizeLimitExceeded) {
    return repositoryLimitError("staging_size", MAX_STAGING_BYTES + 1, MAX_STAGING_BYTES);
  }

  const reason = result.timedOut
    ? "timeout"
    : result.outputLimitExceeded
      ? "git_output_limit"
      : result.spawnError
        ? "git_not_available"
        : `${stage}_failed`;
  const details = {
    stage,
    reason,
    ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
    ...(result.spawnError ? { cause: sanitizeGitDiagnostic(result.spawnError) } : {}),
    ...(!result.spawnError && result.stderr.trim()
      ? { cause: sanitizeGitDiagnostic(result.stderr) }
      : {})
  };
  return stage === "clone"
    ? createError({
        code: "REPOSITORY_CLONE_FAILED",
        category: "network",
        message: "Failed to clone the GitHub repository.",
        details
      })
    : createError({
        code: "REPOSITORY_CHECKOUT_FAILED",
        category: "filesystem",
        message: "Failed to prepare the GitHub repository for scanning.",
        details
      });
}

function emptyGitFailure(input: { timedOut?: boolean }): GitRunResult {
  return {
    exitCode: null,
    stdout: Buffer.alloc(0),
    stderr: "",
    timedOut: input.timedOut ?? false,
    sizeLimitExceeded: false,
    outputLimitExceeded: false
  };
}

function remainingTime(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function createOwnedCleanup(stagingRoot: string): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(stagingRoot, { recursive: true, force: true });
  };
}

function invalidRepositoryUrl(value: string): OhriskError {
  return createError({
    code: "INVALID_ARGUMENT",
    category: "invalid_input",
    message: "Repository input must be a public GitHub HTTPS repository URL.",
    details: {
      repository: safeRepositoryUrl(value),
      expected: "https://github.com/<owner>/<repository>[.git]"
    }
  });
}

function repositoryTreeError(reason: string, repositoryPath?: string): OhriskError {
  return createError({
    code: "REPOSITORY_TREE_INVALID",
    category: "unsupported_input",
    message: "The repository tree cannot be checked out safely on supported platforms.",
    details: {
      reason,
      ...(repositoryPath ? { path: repositoryPath } : {})
    }
  });
}

function repositoryLimitError(reason: string, actual: number, limit: number): OhriskError {
  return createError({
    code: "REPOSITORY_LIMIT_EXCEEDED",
    category: "unsupported_input",
    message: "The repository exceeds the remote scan resource limits.",
    details: { reason, actual, limit }
  });
}

function safeRepositoryUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "<invalid>";
  }
}

function sanitizeGitDiagnostic(value: string): string {
  const lastLine = value
    .replace(/[A-Za-z]:\\[^\r\n]*\\ohrisk-repository-[^\r\n'"]*/giu, "<temporary repository>")
    .replace(/\/[^\r\n]*\/ohrisk-repository-[^\r\n'"]*/gu, "<temporary repository>")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(-500);
  return lastLine || "Git did not provide a diagnostic.";
}
