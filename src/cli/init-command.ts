import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  discoverProject,
  projectLockfiles
} from "../project/discover";
import {
  createError,
  exitCodeForError,
  formatError,
  type OhriskError
} from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";
import type { CliCommand } from "./command";
import { OHRISK_VERSION } from "./version";

export type InitCommandIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

type InitCommand = Extract<CliCommand, { kind: "init" }>;
type InitFileStatus = "create" | "unchanged" | "preserved";
type FinalInitFileStatus = "created" | "unchanged" | "preserved";

type InitFilePlan = {
  rootDir: string;
  relativePath: string;
  displayPath: string;
  content: string;
};

type PreparedInitFile = InitFilePlan & {
  absolutePath: string;
  status: InitFileStatus;
};

type FinalInitFile = {
  displayPath: string;
  status: FinalInitFileStatus;
};

export function runInitCommand(command: InitCommand, io: InitCommandIO): number {
  const discovered = discoverProject({
    cwd: io.cwd,
    autoMergeSameRoot: true
  });
  if (isErr(discovered)) {
    io.stderr(formatError(discovered.error));
    return exitCodeForError(discovered.error);
  }

  const detectedProjectRoot = discovered.value.rootDir;
  let projectRoot: string;
  try {
    projectRoot = realpathSync(detectedProjectRoot);
  } catch (cause) {
    const failure = initWriteFailure(".", "Project root could not be resolved.", cause);
    io.stderr(formatError(failure));
    return exitCodeForError(failure);
  }

  const repositoryRoot = findNearestGitRoot(projectRoot) ?? projectRoot;
  const lockfiles = projectLockfiles(discovered.value);
  const projectDirectory = displayRelativePath(repositoryRoot, projectRoot);
  if (command.workflow && !isSafeWorkflowDirectory(projectDirectory)) {
    const failure = initWriteFailure(
      ".github/workflows/ohrisk.yml",
      "Detected project path cannot be embedded safely in a GitHub workflow."
    );
    io.stderr(formatError(failure));
    return exitCodeForError(failure);
  }
  const scanAll = lockfiles.length > 1;
  const plans: InitFilePlan[] = [
    {
      rootDir: projectRoot,
      relativePath: ".ohrisk.yml",
      displayPath: displayRelativePath(repositoryRoot, path.join(projectRoot, ".ohrisk.yml")),
      content: renderPolicyTemplate()
    },
    ...(command.workflow
      ? [{
          rootDir: repositoryRoot,
          relativePath: ".github/workflows/ohrisk.yml",
          displayPath: ".github/workflows/ohrisk.yml",
          content: renderWorkflowTemplate({
            profile: command.profile,
            failOn: command.failOn,
            projectDirectory,
            scanAll
          })
        } satisfies InitFilePlan]
      : []),
    ...(command.waivers
      ? [{
          rootDir: projectRoot,
          relativePath: ".ohrisk-waivers.json",
          displayPath: displayRelativePath(
            repositoryRoot,
            path.join(projectRoot, ".ohrisk-waivers.json")
          ),
          content: renderWaiverTemplate()
        } satisfies InitFilePlan]
      : [])
  ];

  const prepared: PreparedInitFile[] = [];
  for (const plan of plans) {
    const result = prepareInitFile(plan);
    if (isErr(result)) {
      io.stderr(formatError(result.error));
      return exitCodeForError(result.error);
    }
    prepared.push(result.value);
  }

  const files: FinalInitFile[] = [];
  for (const file of prepared) {
    if (file.status !== "create") {
      files.push({
        displayPath: file.displayPath,
        status: file.status
      });
      continue;
    }

    const written = writePreparedInitFile(file);
    if (isErr(written)) {
      io.stderr(formatError(written.error));
      return exitCodeForError(written.error);
    }
    files.push({
      displayPath: file.displayPath,
      status: "created"
    });
  }

  const inputs = lockfiles
    .map((lockfile) => displayRelativePath(detectedProjectRoot, lockfile.path))
    .sort((left, right) => left.localeCompare(right));
  const output = [
    "Ohrisk initialized.",
    `project: ${projectDirectory}`,
    `inputs: ${inputs.join(", ")}`,
    ...files.map((file) => `${file.status}: ${file.displayPath}`),
    command.workflow
      ? "next: review and commit the generated policy and workflow."
      : "next: review the generated policy, then run ohrisk scan."
  ];
  io.stdout(output.join("\n"));
  return 0;
}

function prepareInitFile(plan: InitFilePlan): Result<PreparedInitFile, OhriskError> {
  const relativeSegments = normalizedRelativeSegments(plan.relativePath);
  if (!relativeSegments) {
    return err(initWriteFailure(
      plan.displayPath,
      "Generated path was not a safe relative path."
    ));
  }

  const absolutePath = path.join(plan.rootDir, ...relativeSegments);
  if (!isPathInsideOrEqual(absolutePath, plan.rootDir)) {
    return err(initWriteFailure(
      plan.displayPath,
      "Generated path escaped its initialization root."
    ));
  }

  let currentPath = plan.rootDir;
  try {
    for (const segment of relativeSegments.slice(0, -1)) {
      currentPath = path.join(currentPath, segment);
      if (!existsSync(currentPath)) {
        continue;
      }
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        return err(initWriteFailure(
          plan.displayPath,
          "Parent path contains a symbolic link."
        ));
      }
      if (!stats.isDirectory()) {
        return err(initWriteFailure(
          plan.displayPath,
          "Parent path contains a non-directory entry."
        ));
      }
    }

    if (!existsSync(absolutePath)) {
      return ok({
        ...plan,
        absolutePath,
        status: "create"
      });
    }

    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      return err(initWriteFailure(
        plan.displayPath,
        "Existing target is a symbolic link."
      ));
    }
    if (!stats.isFile()) {
      return err(initWriteFailure(
        plan.displayPath,
        "Existing target is not a regular file."
      ));
    }

    const currentContent = readFileSync(absolutePath, "utf8");
    return ok({
      ...plan,
      absolutePath,
      status: normalizedText(currentContent) === normalizedText(plan.content)
        ? "unchanged"
        : "preserved"
    });
  } catch (cause) {
    return err(initWriteFailure(
      plan.displayPath,
      "Initialization target could not be inspected.",
      cause
    ));
  }
}

function writePreparedInitFile(
  file: PreparedInitFile
): Result<undefined, OhriskError> {
  const relativeSegments = normalizedRelativeSegments(file.relativePath);
  if (!relativeSegments) {
    return err(initWriteFailure(
      file.displayPath,
      "Generated path was not a safe relative path."
    ));
  }

  let currentPath = file.rootDir;
  try {
    for (const segment of relativeSegments.slice(0, -1)) {
      currentPath = path.join(currentPath, segment);
      if (!existsSync(currentPath)) {
        mkdirSync(currentPath, { mode: 0o755 });
      }
      const stats = lstatSync(currentPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return err(initWriteFailure(
          file.displayPath,
          "Parent path changed during initialization."
        ));
      }
    }

    writeFileSync(file.absolutePath, file.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644
    });
    return ok(undefined);
  } catch (cause) {
    return err(initWriteFailure(
      file.displayPath,
      "Initialization file could not be created.",
      cause
    ));
  }
}

function renderPolicyTemplate(): string {
  return [
    "# Generated by ohrisk init.",
    "# Add explicit rules only when project policy differs from Ohrisk defaults.",
    "version: 1",
    ""
  ].join("\n");
}

function renderWaiverTemplate(): string {
  return [
    "{",
    '  "waivers": []',
    "}",
    ""
  ].join("\n");
}

function renderWorkflowTemplate(input: {
  profile: InitCommand["profile"];
  failOn: InitCommand["failOn"];
  projectDirectory: string;
  scanAll: boolean;
}): string {
  return [
    "name: License risk",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  ohrisk:",
    "    name: Ohrisk",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 10",
    "",
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
    "        with:",
    "          fetch-depth: 0",
    "",
    "      - name: Setup Node",
    "        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
    "        with:",
    '          node-version: "24"',
    "",
    "      - name: Check dependency license risk",
    `        working-directory: ${JSON.stringify(input.projectDirectory)}`,
    "        run: >-",
    `          npx --yes ohrisk@${OHRISK_VERSION}`,
    '          diff "${{ github.event.pull_request.base.sha }}"',
    `          --profile ${input.profile}`,
    "          --prod",
    `          --fail-on ${input.failOn}`,
    ...(input.scanAll ? ["          --all"] : []),
    ""
  ].join("\n");
}

function findNearestGitRoot(startPath: string): string | undefined {
  let currentPath = startPath;
  while (true) {
    if (existsSync(path.join(currentPath, ".git"))) {
      try {
        return realpathSync(currentPath);
      } catch {
        return currentPath;
      }
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }
}

function normalizedRelativeSegments(value: string): string[] | undefined {
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized === ""
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
  ) {
    return undefined;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments;
}

function displayRelativePath(rootDir: string, targetPath: string): string {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath === ""
    ? "."
    : relativePath.split(path.sep).join("/");
}

function isSafeWorkflowDirectory(value: string): boolean {
  return !value.includes("${{")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && (value === "." || normalizedRelativeSegments(value) !== undefined);
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function initWriteFailure(
  displayPath: string,
  reason: string,
  cause?: unknown
): OhriskError {
  const causeCode = filesystemErrorCode(cause);
  return createError({
    code: "INIT_WRITE_FAILED",
    category: "filesystem",
    message: "Project initialization could not create a safe scaffold.",
    details: {
      path: displayPath,
      reason,
      ...(causeCode ? { causeCode } : {})
    }
  });
}

function filesystemErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  return typeof cause.code === "string" ? cause.code : undefined;
}
