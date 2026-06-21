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

const GEMSPEC_MAX_BYTES = 1024 * 1024;
const GEM_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;

type RubyGemLocation = {
  packageDir: string;
  gemspecPath?: string;
};

export function collectRubyGemEvidence(input: {
  packageId: string;
  gemName: string;
  version: string;
  projectRoot: string;
  gemspecMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const location = findRubyGemLocation({
    gemName: input.gemName,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (!location) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Ruby gem source was not found in a local Bundler or RubyGems install path."]
    });
  }

  const gemspec = location.gemspecPath
    ? readGemSpecLicenses({
        packageId: input.packageId,
        gemspecPath: location.gemspecPath,
        maxBytes: input.gemspecMaxBytes ?? GEMSPEC_MAX_BYTES
      })
    : ok(undefined);

  if (!gemspec.ok) {
    return err(gemspec.error);
  }

  const warnings: string[] = [];
  const files = readRubyGemEvidenceFiles({
    packageDir: location.packageDir,
    maxBytes: input.evidenceFileMaxBytes ?? GEM_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Ruby gem source.");
  }

  if (!gemspec.value || gemspec.value.length === 0) {
    warnings.push("Ruby gemspec did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(gemspec.value && gemspec.value.length === 1
      ? {
          metadataLicense: gemspec.value[0],
          metadataSource: "gemspec"
        }
      : {}),
    ...(gemspec.value && gemspec.value.length > 1
      ? {
          metadataLicenses: gemspec.value,
          metadataSource: "gemspec"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findRubyGemLocation(input: {
  gemName: string;
  version: string;
  projectRoot: string;
}): RubyGemLocation | undefined {
  const gemDirName = `${input.gemName}-${input.version}`;

  for (const root of rubyGemInstallRoots(input.projectRoot)) {
    const gemsRoot = path.resolve(root, "gems");
    const packageDir = path.resolve(gemsRoot, gemDirName);
    if (
      !isPathInside(gemsRoot, packageDir)
      || !existsSync(packageDir)
      || !isReadableDirectory(packageDir)
    ) {
      continue;
    }

    const specificationsRoot = path.resolve(root, "specifications");
    const gemspecPath = path.resolve(specificationsRoot, `${gemDirName}.gemspec`);
    return {
      packageDir,
      ...(isPathInside(specificationsRoot, gemspecPath) && existsSync(gemspecPath)
        ? { gemspecPath }
        : {})
    };
  }

  return undefined;
}

function rubyGemInstallRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  for (const vendorRoot of globRubyVersionRoots(path.join(projectRoot, "vendor", "bundle", "ruby"))) {
    roots.push(vendorRoot);
  }

  const gemHome = process.env.GEM_HOME;
  if (gemHome) {
    roots.push(gemHome);
  }

  const gemPath = process.env.GEM_PATH;
  if (gemPath) {
    roots.push(...gemPath.split(path.delimiter).filter((entry) => entry.trim() !== ""));
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    for (const userGemRoot of globRubyVersionRoots(path.join(home, ".gem", "ruby"))) {
      roots.push(userGemRoot);
    }
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function globRubyVersionRoots(root: string): string[] {
  if (!existsSync(root) || !isReadableDirectory(root)) {
    return [];
  }

  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function readGemSpecLicenses(input: {
  packageId: string;
  gemspecPath: string;
  maxBytes: number;
}): Result<string[] | undefined, OhriskError> {
  const text = readTextFileWithLimit({
    filePath: input.gemspecPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "Ruby gemspec metadata exceeded the maximum supported size."
          : "Failed to read Ruby gemspec metadata.",
        details: {
          packageId: input.packageId,
          gemspecPath: input.gemspecPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseGemSpecLicenses(text.value));
}

function parseGemSpecLicenses(text: string): string[] | undefined {
  const listMatch = text.match(/\.licenses\s*=\s*\[([^\]]*)\]/);
  if (listMatch?.[1]) {
    const values = [...listMatch[1].matchAll(/["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((item): item is string => item !== undefined && item.trim() !== "");
    if (values.length > 0) {
      return values;
    }
  }

  const scalarMatch = text.match(/\.license\s*=\s*["']([^"']+)["']/);
  return scalarMatch?.[1] ? [scalarMatch[1]] : undefined;
}

function readRubyGemEvidenceFiles(input: {
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
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function evidenceFileCandidates(dir: string): Array<{
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
        relativePath: entry.name
      }));
  } catch {
    return [];
  }
}

function isReadableDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function evidenceFileReadWarning(fileName: string, error: TextFileReadError): string {
  return error.kind === "too_large"
    ? `Skipped ${fileName}: evidence file exceeded the maximum supported size (maxBytes: ${error.maxBytes}, observedBytes: ${error.observedBytes}).`
    : `Failed to read ${fileName}: ${error.cause}`;
}
