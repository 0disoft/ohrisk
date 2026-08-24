import {
  cloneGitHubRepository,
  type GitHubRepository,
  type RepositoryCloner,
  type RepositorySubmoduleMode
} from "../repository/github-repository";
import type { RepositoryTreeInventory } from "../repository/tree-inventory";
import type { RemoteRepositoryReportSource } from "../report/scan-report";
import { exitCodeForError, formatError, type OhriskError } from "../shared/errors";
import { isErr } from "../shared/result";
import {
  COMMAND_CANCELLED_EXIT_CODE,
  isCommandCancelled,
  renderCommandCancelled
} from "./cancellation";
import {
  closeScanProgressReporter,
  type ScanProgressReporter
} from "./scan-progress";

export type RemoteRepositoryScanContext = {
  scanCwd: string;
  configurationRoot: string;
  runtimeRoot: string;
  allowLocalProjectEvidence: false;
  allowProjectContainedGoReplacementEvidence: true;
  temporaryRoot: string;
  repository: RemoteRepositoryReportSource;
  inventory?: RepositoryTreeInventory;
};

export async function runRemoteRepositoryScan(input: {
  repository: GitHubRepository;
  submoduleMode: RepositorySubmoduleMode;
  invocationCwd: string;
  signal: AbortSignal;
  reportProgress?: ScanProgressReporter;
  cloneRepository?: RepositoryCloner;
  stderr: (text: string) => void;
  scan: (context: RemoteRepositoryScanContext) => Promise<number>;
}): Promise<number> {
  input.reportProgress?.(
    0,
    `Cloning ${input.repository.owner}/${input.repository.name}...`
  );
  const cloner = input.cloneRepository ?? cloneGitHubRepository;
  const cloned = await cloner(input.repository, { submodules: input.submoduleMode });
  if (isErr(cloned)) {
    await closeScanProgressReporter(input.reportProgress, "failure");
    input.stderr(formatError(cloned.error));
    return exitCodeForError(cloned.error);
  }

  try {
    if (isCommandCancelled(input.signal)) {
      await closeScanProgressReporter(input.reportProgress, "failure");
      input.stderr(renderCommandCancelled("Scan"));
      return COMMAND_CANCELLED_EXIT_CODE;
    }

    return await input.scan({
      scanCwd: cloned.value.rootDir,
      configurationRoot: input.invocationCwd,
      runtimeRoot: input.invocationCwd,
      allowLocalProjectEvidence: false,
      allowProjectContainedGoReplacementEvidence: true,
      temporaryRoot: cloned.value.rootDir,
      ...(cloned.value.inventory ? { inventory: cloned.value.inventory } : {}),
      repository: {
        owner: input.repository.owner,
        name: input.repository.name,
        submodules: {
          mode: input.submoduleMode,
          skippedCount: cloned.value.submodules.total,
          skippedPaths: cloned.value.submodules.paths,
          pathsTruncated: cloned.value.submodules.pathsTruncated
        },
        symbolicLinks: {
          skippedCount: cloned.value.symbolicLinks.total,
          skippedPaths: cloned.value.symbolicLinks.paths,
          pathsTruncated: cloned.value.symbolicLinks.pathsTruncated
        },
        nonPortablePaths: {
          skippedCount: cloned.value.nonPortablePaths.total,
          skippedPaths: cloned.value.nonPortablePaths.paths,
          pathsTruncated: cloned.value.nonPortablePaths.pathsTruncated
        }
      }
    });
  } finally {
    cloned.value.cleanup();
  }
}

export function redactTemporaryPath(error: OhriskError, temporaryRoot: string): OhriskError {
  return {
    ...error,
    message: redactTemporaryPathText(error.message, temporaryRoot),
    ...(error.details
      ? { details: redactTemporaryPathValue(error.details, temporaryRoot) as Record<string, unknown> }
      : {})
  };
}

function redactTemporaryPathValue(value: unknown, temporaryRoot: string): unknown {
  if (typeof value === "string") {
    return redactTemporaryPathText(value, temporaryRoot);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactTemporaryPathValue(item, temporaryRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactTemporaryPathValue(item, temporaryRoot)])
    );
  }
  return value;
}

function redactTemporaryPathText(value: string, temporaryRoot: string): string {
  const variants = [
    temporaryRoot,
    temporaryRoot.replace(/\\/g, "/"),
    temporaryRoot.replace(/\//g, "\\")
  ];
  return variants.reduce(
    (redacted, variant) => redacted.split(variant).join("<temporary repository>"),
    value
  );
}
