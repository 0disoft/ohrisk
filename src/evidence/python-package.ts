import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { omitUndefined } from "../shared/object";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const PYTHON_METADATA_MAX_BYTES = 1024 * 1024;
const PYTHON_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const PYTHON_LICENSE_FILE_LIMIT = 50;

export type PythonMetadata = {
  name?: string;
  version?: string;
  licenseExpression?: string;
  license?: string;
  classifiers: string[];
  licenseFiles: string[];
};

type PythonDistInfo = {
  path: string;
  metadata: PythonMetadata;
};

const LICENSE_CLASSIFIER_ALIASES = new Map<string, string>([
  ["License :: OSI Approved :: Apache Software License", "Apache-2.0"],
  ["License :: OSI Approved :: BSD License", "BSD-3-Clause"],
  ["License :: OSI Approved :: GNU Affero General Public License v3", "AGPL-3.0-only"],
  ["License :: OSI Approved :: GNU General Public License v2 (GPLv2)", "GPL-2.0-only"],
  ["License :: OSI Approved :: GNU General Public License v3 (GPLv3)", "GPL-3.0-only"],
  ["License :: OSI Approved :: GNU Lesser General Public License v2 (LGPLv2)", "LGPL-2.0-only"],
  ["License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)", "LGPL-3.0-only"],
  ["License :: OSI Approved :: ISC License (ISCL)", "ISC"],
  ["License :: OSI Approved :: MIT License", "MIT"],
  ["License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)", "MPL-2.0"],
  ["License :: Public Domain", "Unlicense"]
]);

export function collectPythonPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  metadataMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const metadataMaxBytes = input.metadataMaxBytes ?? PYTHON_METADATA_MAX_BYTES;
  const evidenceFileMaxBytes = input.evidenceFileMaxBytes ?? PYTHON_EVIDENCE_FILE_MAX_BYTES;
  const sitePackageDirs = findPythonSitePackageDirs(input.projectRoot);

  for (const sitePackageDir of sitePackageDirs) {
    const distInfo = findMatchingDistInfo({
      sitePackageDir,
      packageName: input.packageName,
      version: input.version,
      metadataMaxBytes
    });

    if (!distInfo.ok) {
      return err(distInfo.error);
    }

    if (!distInfo.value) {
      continue;
    }

    return collectDistInfoEvidence({
      packageId: input.packageId,
      distInfo: distInfo.value,
      evidenceFileMaxBytes
    });
  }

  return ok({
    packageId: input.packageId,
    files: [],
    source: "unavailable",
    warnings: [
      "Python package metadata was not found in a local .venv or venv site-packages directory."
    ]
  });
}

function findPythonSitePackageDirs(projectRoot: string): string[] {
  const candidates = [
    path.join(projectRoot, ".venv", "Lib", "site-packages"),
    path.join(projectRoot, "venv", "Lib", "site-packages"),
    ...sitePackageDirsUnder(path.join(projectRoot, ".venv", "lib")),
    ...sitePackageDirsUnder(path.join(projectRoot, "venv", "lib")),
    ...sitePackageDirsUnder(path.join(projectRoot, ".venv", "lib64")),
    ...sitePackageDirsUnder(path.join(projectRoot, "venv", "lib64"))
  ];

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
    .filter((candidate) => existsSync(candidate) && isReadableDirectory(candidate));
}

function sitePackageDirsUnder(libDir: string): string[] {
  if (!existsSync(libDir) || !isReadableDirectory(libDir)) {
    return [];
  }

  try {
    return readdirSync(libDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("python"))
      .map((entry) => path.join(libDir, entry.name, "site-packages"))
      .filter((candidate) => existsSync(candidate) && isReadableDirectory(candidate));
  } catch {
    return [];
  }
}

function findMatchingDistInfo(input: {
  sitePackageDir: string;
  packageName: string;
  version: string;
  metadataMaxBytes: number;
}): Result<PythonDistInfo | undefined, OhriskError> {
  let entries;

  try {
    entries = readdirSync(input.sitePackageDir, { withFileTypes: true });
  } catch (cause) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "filesystem",
        message: "Failed to inspect Python site-packages evidence directory.",
        details: {
          sitePackageDir: input.sitePackageDir,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".dist-info")) {
      continue;
    }

    const distInfoPath = path.join(input.sitePackageDir, entry.name);
    const metadata = readPythonMetadata({
      metadataPath: path.join(distInfoPath, "METADATA"),
      packageId: `${input.packageName}@${input.version}`,
      maxBytes: input.metadataMaxBytes
    });

    if (!metadata.ok) {
      return err(metadata.error);
    }

    if (!metadata.value) {
      continue;
    }

    if (
      normalizePythonPackageName(metadata.value.name ?? "") === normalizePythonPackageName(input.packageName)
      && metadata.value.version === input.version
    ) {
      return ok({
        path: distInfoPath,
        metadata: metadata.value
      });
    }
  }

  return ok(undefined);
}

function collectDistInfoEvidence(input: {
  packageId: string;
  distInfo: PythonDistInfo;
  evidenceFileMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const warnings: string[] = [];
  const files = readPythonEvidenceFiles({
    distInfoPath: input.distInfo.path,
    maxBytes: input.evidenceFileMaxBytes,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Python dist-info metadata.");
  }

  const metadataLicense = readPythonMetadataLicense(input.distInfo.metadata);
  if (!metadataLicense) {
    warnings.push("Python METADATA did not declare License-Expression, License, or a recognized license classifier.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadataLicense ? { metadataLicense, metadataSource: "METADATA" } : {}),
    files,
    source: "local",
    warnings
  });
}

function readPythonMetadata(input: {
  metadataPath: string;
  packageId: string;
  maxBytes: number;
}): Result<PythonMetadata | undefined, OhriskError> {
  if (!existsSync(input.metadataPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.metadataPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: metadataReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          metadataPath: input.metadataPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parsePythonMetadataText(text.value));
}

export function parsePythonMetadataText(text: string): PythonMetadata {
  const headers = parseEmailStyleHeaders(text);

  return omitUndefined({
    name: firstHeader(headers, "Name"),
    version: firstHeader(headers, "Version"),
    licenseExpression: firstHeader(headers, "License-Expression"),
    license: firstHeader(headers, "License"),
    classifiers: headers.get("Classifier") ?? [],
    licenseFiles: headers.get("License-File") ?? []
  });
}

function parseEmailStyleHeaders(text: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  let currentKey: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      break;
    }

    if (/^\s/.test(line) && currentKey) {
      const values = headers.get(currentKey);
      if (values && values.length > 0) {
        values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`.trim();
      }
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      currentKey = undefined;
      continue;
    }

    currentKey = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();
    const values = headers.get(currentKey) ?? [];
    values.push(value);
    headers.set(currentKey, values);
  }

  return headers;
}

function firstHeader(headers: Map<string, string[]>, key: string): string | undefined {
  const value = headers.get(key)?.find((item) => item.trim() !== "")?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function readPythonMetadataLicense(metadata: PythonMetadata): string | undefined {
  if (metadata.licenseExpression) {
    return metadata.licenseExpression;
  }

  const classifierLicenses = metadata.classifiers
    .map((classifier) => LICENSE_CLASSIFIER_ALIASES.get(classifier))
    .filter((license): license is string => license !== undefined);

  if (classifierLicenses.length > 0) {
    return [...new Set(classifierLicenses)].join(" OR ");
  }

  if (
    metadata.license
    && metadata.license.length <= 200
    && !metadata.license.includes("\n")
    && !isAbsentPythonLicense(metadata.license)
  ) {
    return metadata.license;
  }

  return undefined;
}

function isAbsentPythonLicense(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "" || normalized === "UNKNOWN" || normalized === "NOASSERTION";
}

function readPythonEvidenceFiles(input: {
  distInfoPath: string;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  const candidates = [
    ...evidenceFileCandidates(input.distInfoPath, ""),
    ...evidenceFileCandidates(path.join(input.distInfoPath, "licenses"), "licenses")
  ];

  for (const candidate of candidates.slice(0, PYTHON_LICENSE_FILE_LIMIT)) {
    const kind = classifyEvidenceFile(candidate.relativePath);
    if (!kind) {
      continue;
    }

    try {
      const text = readTextFileWithLimit({
        filePath: candidate.absolutePath,
        maxBytes: input.maxBytes
      });

      if (!text.ok) {
        input.warnings.push(evidenceFileReadWarning(candidate.relativePath, text.error));
        continue;
      }

      files.push({
        path: candidate.relativePath,
        kind,
        text: text.value
      });
    } catch (cause) {
      input.warnings.push(
        `Failed to read ${candidate.relativePath}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function evidenceFileCandidates(dir: string, relativePrefix: string): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  if (!existsSync(dir) || !isReadableDirectory(dir)) {
    return [];
  }

  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        absolutePath: path.join(dir, entry.name),
        relativePath: relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      }));
  } catch {
    return [];
  }
}

export function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function isReadableDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function metadataReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Python package METADATA exceeded the maximum supported size."
    : "Failed to read Python package METADATA.";
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}
