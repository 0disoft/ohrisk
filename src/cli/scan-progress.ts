import {
  createProgressRuntime,
  type ProgressRuntime,
  type StreamTarget,
  type TaskHandle
} from "@0disoft/laqu";

import type { EvidenceCollectionProgress } from "../evidence/collect";

export type ScanClock = () => number;
export type ScanProgressCloseStatus = "success" | "failure";
export type ScanProgressReporter = ((percent: number, message: string) => void) & {
  close?: (status?: ScanProgressCloseStatus) => Promise<void>;
};

type ScanProgressIO = {
  stderr: (text: string) => void;
  stderrStream?: StreamTarget;
  env?: Record<string, string | undefined>;
};

export const SCAN_PROGRESS_DISCOVER_PERCENT = 5;
export const SCAN_PROGRESS_READ_LOCKFILE_PERCENT = 10;
export const SCAN_PROGRESS_EVIDENCE_START_PERCENT = 10;
export const SCAN_PROGRESS_EVALUATE_PERCENT = 96;
export const SCAN_PROGRESS_RENDER_PERCENT = 98;
export const SCAN_PROGRESS_WRITE_PERCENT = 99;
export const SCAN_PROGRESS_READY_PERCENT = 100;

const SCAN_PROGRESS_EVIDENCE_END_PERCENT = 95;
const SCAN_PROGRESS_BAR_WIDTH = 20;
const SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE = 5;

export function createEvidenceProgressReporter(input: {
  progress: ScanProgressReporter;
  now: ScanClock;
}): (progress: EvidenceCollectionProgress) => void {
  const startedAtMs = input.now();

  return (progress) => {
    const completed = clampCount(progress.completed, progress.total);
    const total = Math.max(0, progress.total);
    const elapsedMs = Math.max(0, input.now() - startedAtMs);
    const averageMs = completed > 0 ? elapsedMs / completed : 0;
    const concurrency = Math.max(1, Math.trunc(progress.concurrency));
    const etaMs = (averageMs * Math.max(0, total - completed)) / concurrency;
    const eta = formatEvidenceProgressEta({ completed, total, etaMs });

    input.progress(
      evidenceCollectionPercent({ completed, total }),
      [
        `Collecting license evidence ${completed}/${total}: ${formatProgressPackageId(progress.packageId)}`,
        `(elapsed ${formatDuration(elapsedMs)}, eta ${eta}, avg ${formatDuration(averageMs)}/pkg)`
      ].join(" ")
    );
  };
}

export function createScanProgressReporter(io: ScanProgressIO): ScanProgressReporter {
  if (!io.stderrStream?.isTTY) {
    return createLegacyScanProgressReporter(io);
  }

  const runtime = createProgressRuntime({
    stderr: io.stderrStream,
    format: "human",
    progressPolicy: "auto",
    env: io.env ?? process.env,
    maxRows: 1,
    manageProcessLifecycle: false,
    theme: {
      runningSymbol: ">",
      successSymbol: "ok",
      progressComplete: "#",
      progressIncomplete: "-",
      overflowMarker: "..."
    }
  });
  const task = runtime.createTask("Ohrisk scan", { total: 100 });

  const reporter = ((rawPercent, message) => {
    updateLaquScanTask(task, rawPercent, message);
  }) as ScanProgressReporter;
  reporter.close = (status) => closeLaquScanProgress(runtime, task, status);
  return reporter;
}

export async function closeScanProgressReporter(
  reporter: ScanProgressReporter | undefined,
  status: ScanProgressCloseStatus = "success"
): Promise<void> {
  await reporter?.close?.(status);
}

function evidenceCollectionPercent(
  progress: Pick<EvidenceCollectionProgress, "completed" | "total">
): number {
  const fraction = progress.total <= 0
    ? 1
    : Math.min(1, Math.max(0, progress.completed / progress.total));

  return SCAN_PROGRESS_EVIDENCE_START_PERCENT
    + ((SCAN_PROGRESS_EVIDENCE_END_PERCENT - SCAN_PROGRESS_EVIDENCE_START_PERCENT) * fraction);
}

function clampCount(value: number, total: number): number {
  return Math.min(Math.max(0, total), Math.max(0, value));
}

function formatProgressPackageId(packageId: string): string {
  return packageId.replace(/[\r\n]+/g, " ").trim() || "(unknown package)";
}

function formatEvidenceProgressEta(input: {
  completed: number;
  total: number;
  etaMs: number;
}): string {
  if (input.completed >= input.total || input.total <= SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE) {
    return formatDuration(input.etaMs);
  }

  return input.completed >= SCAN_PROGRESS_ETA_MIN_COMPLETED_SAMPLE
    ? formatDuration(input.etaMs)
    : "calculating";
}

function formatDuration(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds));
  if (safeMilliseconds < 1_000) {
    return `${safeMilliseconds}ms`;
  }

  const seconds = Math.round(safeMilliseconds / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function createLegacyScanProgressReporter(io: ScanProgressIO): ScanProgressReporter {
  return (rawPercent, message) => {
    const percent = normalizeScanProgressPercent(rawPercent);
    const filled = Math.round((percent / 100) * SCAN_PROGRESS_BAR_WIDTH);
    const bar = `${"#".repeat(filled)}${"-".repeat(SCAN_PROGRESS_BAR_WIDTH - filled)}`;
    io.stderr(`[${bar}] ${percent.toString().padStart(3, " ")}% ${message}`);
  };
}

function updateLaquScanTask(task: TaskHandle, rawPercent: number, message: string): void {
  const percent = normalizeScanProgressPercent(rawPercent);
  task.setCompleted(percent);
  task.setMessage(`${percent.toString().padStart(3, " ")}% ${message}`);
}

async function closeLaquScanProgress(
  runtime: ProgressRuntime,
  task: TaskHandle,
  status: ScanProgressCloseStatus = "success"
): Promise<void> {
  if (status === "success") {
    task.succeed("Report ready.");
  } else {
    task.fail("Scan failed.");
  }
  await runtime.close();
}

function normalizeScanProgressPercent(rawPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, rawPercent)));
}
