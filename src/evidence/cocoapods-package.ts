import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const COCOAPODS_PODSPEC_MAX_BYTES = 1024 * 1024;
const COCOAPODS_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const COCOAPODS_LICENSE_FILE_LIMIT = 50;

export function collectCocoapodsPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  podspecMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findCocoapodsPackageDir({
    packageName: input.packageName,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["CocoaPods package source was not found in the local Pods directory."]
    });
  }

  const podspecLicense = readPodspecLicense({
    packageId: input.packageId,
    packageName: input.packageName,
    projectRoot: input.projectRoot,
    maxBytes: input.podspecMaxBytes ?? COCOAPODS_PODSPEC_MAX_BYTES
  });

  if (!podspecLicense.ok) {
    return err(podspecLicense.error);
  }

  const warnings: string[] = [];
  const files = readCocoapodsEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? COCOAPODS_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in CocoaPods package source.");
  }

  if (!podspecLicense.value) {
    warnings.push("CocoaPods podspec did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(podspecLicense.value
      ? {
          metadataLicense: podspecLicense.value,
          metadataSource: "podspec"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findCocoapodsPackageDir(input: {
  packageName: string;
  projectRoot: string;
}): string | undefined {
  const podsRoot = path.resolve(input.projectRoot, "Pods");
  const exactCandidate = path.resolve(podsRoot, input.packageName);
  if (
    isPathInside(podsRoot, exactCandidate)
    && existsSync(exactCandidate)
    && isReadableDirectory(exactCandidate)
  ) {
    return exactCandidate;
  }

  return findCaseInsensitiveChildDirectory({
    parent: podsRoot,
    childName: input.packageName
  });
}

function findCaseInsensitiveChildDirectory(input: {
  parent: string;
  childName: string;
}): string | undefined {
  if (!existsSync(input.parent) || !isReadableDirectory(input.parent)) {
    return undefined;
  }

  let entries;
  try {
    entries = readdirSync(input.parent, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const normalizedName = input.childName.toLowerCase();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.toLowerCase() !== normalizedName) {
      continue;
    }

    const candidate = path.resolve(input.parent, entry.name);
    if (isPathInside(input.parent, candidate) && isReadableDirectory(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function readPodspecLicense(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  const podspecPath = path.resolve(
    input.projectRoot,
    "Pods",
    "Local Podspecs",
    `${input.packageName}.podspec.json`
  );

  if (!existsSync(podspecPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: podspecPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "CocoaPods podspec metadata exceeded the maximum supported size."
          : "Failed to read CocoaPods podspec metadata.",
        details: {
          packageId: input.packageId,
          podspecPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  try {
    return ok(podspecLicenseFromJson(JSON.parse(text.value) as unknown));
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        message: "CocoaPods podspec metadata was not valid JSON.",
        details: {
          packageId: input.packageId,
          podspecPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function podspecLicenseFromJson(parsed: unknown): string | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }

  if (typeof parsed.license === "string" && parsed.license.trim() !== "") {
    return parsed.license.trim();
  }

  if (isRecord(parsed.license)) {
    const type = parsed.license.type;
    if (typeof type === "string" && type.trim() !== "") {
      return type.trim();
    }
  }

  return undefined;
}

function readCocoapodsEvidenceFiles(input: {
  packageDir: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const candidate of evidenceFileCandidates(input.packageDir)) {
    const kind = classifyEvidenceFile(candidate.relativePath);
    if (!kind) {
      continue;
    }

    if (files.length >= COCOAPODS_LICENSE_FILE_LIMIT) {
      input.warnings.push(`CocoaPods package evidence file limit reached at ${COCOAPODS_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped CocoaPods evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
      continue;
    }

    files.push({
      path: candidate.relativePath,
      kind,
      text: text.value
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function evidenceFileCandidates(dir: string): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        absolutePath: path.join(dir, entry.name),
        relativePath: entry.name
      }));
  } catch {
    return [];
  }
}

function evidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "filesystem":
      return error.cause;
  }
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
