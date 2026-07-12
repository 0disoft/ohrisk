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

const MIX_EXS_MAX_BYTES = 1024 * 1024;
const REBAR_CONFIG_MAX_BYTES = 1024 * 1024;
const HEX_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const HEX_LICENSE_FILE_LIMIT = 50;

type HexMetadataLicenses = {
  licenses: string[];
  source: "mix.exs" | "rebar.config";
};

export function collectHexPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  mixExsMaxBytes?: number;
  rebarConfigMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findHexPackageDir({
    packageName: input.packageName,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Hex package source was not found in the local deps directory."]
    });
  }

  const metadataLicenses = readHexMetadataLicenses({
    packageId: input.packageId,
    packageDir,
    mixExsMaxBytes: input.mixExsMaxBytes ?? MIX_EXS_MAX_BYTES,
    rebarConfigMaxBytes: input.rebarConfigMaxBytes ?? REBAR_CONFIG_MAX_BYTES
  });

  if (!metadataLicenses.ok) {
    return err(metadataLicenses.error);
  }

  const warnings: string[] = [];
  const files = readHexEvidenceFiles({
    packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? HEX_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Hex package source.");
  }

  if (!metadataLicenses.value || metadataLicenses.value.licenses.length === 0) {
    warnings.push("Hex package mix.exs or rebar.config did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadataLicenses.value && metadataLicenses.value.licenses.length === 1
      ? {
          metadataLicense: metadataLicenses.value.licenses[0],
          metadataSource: metadataLicenses.value.source
        }
      : {}),
    ...(metadataLicenses.value && metadataLicenses.value.licenses.length > 1
      ? {
          metadataLicenses: metadataLicenses.value.licenses,
          metadataSource: metadataLicenses.value.source
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findHexPackageDir(input: {
  packageName: string;
  projectRoot: string;
}): string | undefined {
  const packageDirName = hexPackageDirectoryName(input.packageName);
  if (!packageDirName) {
    return undefined;
  }

  const depsRoot = path.resolve(input.projectRoot, "deps");
  const exactCandidate = path.resolve(depsRoot, packageDirName);
  if (
    isPathInside(depsRoot, exactCandidate)
    && existsSync(exactCandidate)
    && isReadableDirectory(exactCandidate)
  ) {
    return exactCandidate;
  }

  return findCaseInsensitiveChildDirectory({
    parent: depsRoot,
    childName: packageDirName
  });
}

function hexPackageDirectoryName(packageName: string): string | undefined {
  const normalized = packageName.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  return basename.trim() === "" ? undefined : basename.trim();
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

function readHexMetadataLicenses(input: {
  packageId: string;
  packageDir: string;
  mixExsMaxBytes: number;
  rebarConfigMaxBytes: number;
}): Result<HexMetadataLicenses | undefined, OhriskError> {
  const mixExsLicenses = readMixExsLicenses({
    packageId: input.packageId,
    mixExsPath: path.join(input.packageDir, "mix.exs"),
    maxBytes: input.mixExsMaxBytes
  });
  if (!mixExsLicenses.ok) {
    return err(mixExsLicenses.error);
  }
  if (mixExsLicenses.value && mixExsLicenses.value.length > 0) {
    return ok({
      licenses: mixExsLicenses.value,
      source: "mix.exs"
    });
  }

  const rebarConfigLicenses = readRebarConfigLicenses({
    packageId: input.packageId,
    rebarConfigPath: path.join(input.packageDir, "rebar.config"),
    maxBytes: input.rebarConfigMaxBytes
  });
  if (!rebarConfigLicenses.ok) {
    return err(rebarConfigLicenses.error);
  }
  if (rebarConfigLicenses.value && rebarConfigLicenses.value.length > 0) {
    return ok({
      licenses: rebarConfigLicenses.value,
      source: "rebar.config"
    });
  }

  return ok(undefined);
}

function readMixExsLicenses(input: {
  packageId: string;
  mixExsPath: string;
  maxBytes: number;
}): Result<string[] | undefined, OhriskError> {
  if (!existsSync(input.mixExsPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.mixExsPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "Hex mix.exs metadata exceeded the maximum supported size."
          : "Failed to read Hex mix.exs metadata.",
        details: {
          packageId: input.packageId,
          mixExsPath: input.mixExsPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseMixExsLicenses(text.value));
}

function readRebarConfigLicenses(input: {
  packageId: string;
  rebarConfigPath: string;
  maxBytes: number;
}): Result<string[] | undefined, OhriskError> {
  if (!existsSync(input.rebarConfigPath)) {
    return ok(undefined);
  }

  const text = readTextFileWithLimit({
    filePath: input.rebarConfigPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "Hex rebar.config metadata exceeded the maximum supported size."
          : "Failed to read Hex rebar.config metadata.",
        details: {
          packageId: input.packageId,
          rebarConfigPath: input.rebarConfigPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseRebarConfigLicenses(text.value));
}

function parseMixExsLicenses(text: string): string[] | undefined {
  const listMatch = text.match(/licenses:\s*\[([^\]]*)\]/m);
  if (!listMatch?.[1]) {
    return undefined;
  }

  const values = parseLicenseList(listMatch[1]);
  return values.length > 0 ? values : undefined;
}

function parseRebarConfigLicenses(text: string): string[] | undefined {
  const listMatch = text.match(/\{licenses\s*,\s*\[([^\]]*)\]\s*\}/m);
  if (!listMatch?.[1]) {
    return undefined;
  }

  const values = parseLicenseList(listMatch[1]);
  return values.length > 0 ? values : undefined;
}

function parseLicenseList(text: string): string[] {
  return [...text.matchAll(/<<"([^"]+)">>|"([^"]+)"|'([^']+)'/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((item): item is string => item !== undefined && item.trim() !== "")
    .map((item) => item.trim());
}

function readHexEvidenceFiles(input: {
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

    if (files.length >= HEX_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Hex package evidence file limit reached at ${HEX_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Hex evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
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
