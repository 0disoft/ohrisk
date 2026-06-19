import { existsSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import type { RiskFinding } from "./types";

export const DEFAULT_WAIVER_FILE_NAME = ".ohrisk-waivers.json";
export const WAIVER_FILE_MAX_BYTES = 1024 * 1024;

export type RiskWaiver = {
  id?: string;
  fingerprint?: string;
  reason: string;
  expiresOn?: string;
};

export type WaivedRiskFinding = {
  finding: RiskFinding;
  waiver: RiskWaiver;
  matchedBy: "id" | "fingerprint";
};

export type AppliedRiskWaivers = {
  activeFindings: RiskFinding[];
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
};

export function readRiskWaivers(
  projectRoot: string,
  options?: {
    waiverFileMaxBytes?: number;
  }
): Result<RiskWaiver[], OhriskError> {
  const waiverPath = path.join(projectRoot, DEFAULT_WAIVER_FILE_NAME);

  if (!existsSync(waiverPath)) {
    return ok([]);
  }

  const text = readTextFileWithLimit({
    filePath: waiverPath,
    maxBytes: options?.waiverFileMaxBytes ?? WAIVER_FILE_MAX_BYTES
  });

  if (!text.ok) {
    return err(
      createError({
        code: "WAIVER_FILE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: waiverFileReadFailedMessage(text.error),
        details: {
          path: waiverPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "WAIVER_FILE_PARSE_FAILED",
        category: "invalid_input",
        message: "Ohrisk waiver file is not valid JSON.",
        details: {
          path: waiverPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const waivers = parseWaivers(parsed);
  if (!waivers.ok) {
    return err(
      createError({
        code: "WAIVER_FILE_PARSE_FAILED",
        category: "invalid_input",
        message: waivers.error,
        details: {
          path: waiverPath
        }
      })
    );
  }

  return waivers;
}

function waiverFileReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Ohrisk waiver file exceeded the maximum supported size."
    : "Failed to read the Ohrisk waiver file.";
}

export function applyRiskWaivers(input: {
  findings: RiskFinding[];
  waivers: RiskWaiver[];
  now?: Date;
}): AppliedRiskWaivers {
  const now = input.now ?? new Date();
  const activeWaivers = input.waivers.filter((waiver) => !isExpired(waiver, now));
  const expiredWaivers = input.waivers.filter((waiver) => isExpired(waiver, now));
  const activeFindings: RiskFinding[] = [];
  const waivedFindings: WaivedRiskFinding[] = [];
  const matchedWaivers = new Set<RiskWaiver>();

  for (const finding of input.findings) {
    const waiver = activeWaivers.find((candidate) => matchesWaiver(candidate, finding));
    if (!waiver) {
      activeFindings.push(finding);
      continue;
    }

    matchedWaivers.add(waiver);
    waivedFindings.push({
      finding,
      waiver,
      matchedBy: waiver.id === finding.id ? "id" : "fingerprint"
    });
  }

  return {
    activeFindings,
    waivedFindings,
    expiredWaivers,
    unmatchedWaivers: activeWaivers.filter((waiver) => !matchedWaivers.has(waiver))
  };
}

function parseWaivers(value: unknown): Result<RiskWaiver[], string> {
  if (!isRecord(value)) {
    return err("Ohrisk waiver file must be an object with a waivers array.");
  }

  if (!Array.isArray(value.waivers)) {
    return err("Ohrisk waiver file must contain a waivers array.");
  }

  const waivers: RiskWaiver[] = [];
  for (const [index, waiver] of value.waivers.entries()) {
    const parsed = parseWaiver(waiver, index);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    waivers.push(parsed.value);
  }

  return ok(waivers);
}

function parseWaiver(value: unknown, index: number): Result<RiskWaiver, string> {
  if (!isRecord(value)) {
    return err(`Waiver at index ${index} must be an object.`);
  }

  const id = readOptionalString(value.id);
  const fingerprint = readOptionalString(value.fingerprint);
  const reason = readOptionalString(value.reason);
  const expiresOn = readOptionalString(value.expiresOn);

  if (!id && !fingerprint) {
    return err(`Waiver at index ${index} must include id or fingerprint.`);
  }

  if (!reason) {
    return err(`Waiver at index ${index} must include a non-empty reason.`);
  }

  if (expiresOn && !isIsoDate(expiresOn)) {
    return err(`Waiver at index ${index} has an invalid expiresOn date.`);
  }

  return ok({
    ...(id ? { id } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    reason,
    ...(expiresOn ? { expiresOn } : {})
  });
}

function matchesWaiver(waiver: RiskWaiver, finding: RiskFinding): boolean {
  return waiver.id === finding.id || waiver.fingerprint === finding.fingerprint;
}

function isExpired(waiver: RiskWaiver, now: Date): boolean {
  if (!waiver.expiresOn) {
    return false;
  }

  const expiry = new Date(`${waiver.expiresOn}T23:59:59.999Z`);
  return expiry.getTime() < now.getTime();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
