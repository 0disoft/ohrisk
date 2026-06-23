import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  type TextFileReadError
} from "../shared/read-text-file";
import { ok, type Result } from "../shared/result";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const VCPKG_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const VCPKG_EVIDENCE_FILE_LIMIT = 20;
const VCPKG_INSTALL_ROOT_LIMIT = 8;

export function collectVcpkgPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const warnings: string[] = [];
  const files = readVcpkgEvidenceFiles({
    packageName: input.packageName,
    projectRoot: input.projectRoot,
    maxBytes: input.evidenceFileMaxBytes ?? VCPKG_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("vcpkg package copyright file was not found in local vcpkg_installed directories.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: files.length > 0 ? "local" : "unavailable",
    warnings
  });
}

function readVcpkgEvidenceFiles(input: {
  packageName: string;
  projectRoot: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files = new Map<string, LicenseEvidenceFile>();

  for (const installRoot of findVcpkgInstallRoots(input.projectRoot)) {
    for (const candidate of vcpkgCopyrightCandidates({
      installRoot,
      packageName: input.packageName
    })) {
      if (files.size >= VCPKG_EVIDENCE_FILE_LIMIT) {
        input.warnings.push(`vcpkg evidence file limit reached at ${VCPKG_EVIDENCE_FILE_LIMIT} files.`);
        return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
      }

      if (files.has(candidate.relativePath)) {
        continue;
      }

      const text = readTextFileWithLimit({
        filePath: candidate.absolutePath,
        maxBytes: input.maxBytes
      });

      if (!text.ok) {
        input.warnings.push(`Skipped vcpkg evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
        continue;
      }

      files.set(candidate.relativePath, {
        path: candidate.relativePath,
        kind: "license",
        text: text.value
      });
    }
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function findVcpkgInstallRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  const direct = path.join(projectRoot, "vcpkg_installed");
  if (isReadableDirectory(direct)) {
    roots.push(direct);
  }

  try {
    for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(projectRoot, entry.name, "vcpkg_installed");
      if (isReadableDirectory(candidate) && !roots.includes(candidate)) {
        roots.push(candidate);
      }

      if (roots.length >= VCPKG_INSTALL_ROOT_LIMIT) {
        break;
      }
    }
  } catch {
    return roots;
  }

  return roots;
}

function vcpkgCopyrightCandidates(input: {
  installRoot: string;
  packageName: string;
}): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  const candidates: Array<{
    absolutePath: string;
    relativePath: string;
  }> = [];

  for (const tripletDir of childDirectories(input.installRoot)) {
    if (path.basename(tripletDir) === "vcpkg") {
      continue;
    }

    const copyrightPath = path.join(tripletDir, "share", input.packageName, "copyright");
    if (!isFile(copyrightPath)) {
      continue;
    }

    candidates.push({
      absolutePath: copyrightPath,
      relativePath: path.relative(input.installRoot, copyrightPath).replace(/\\/g, "/")
    });
  }

  return candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function childDirectories(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name))
      .filter(isReadableDirectory)
      .sort();
  } catch {
    return [];
  }
}

function evidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "read_failed":
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

function isFile(pathname: string): boolean {
  if (!existsSync(pathname)) {
    return false;
  }

  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}
