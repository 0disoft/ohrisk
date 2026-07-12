import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
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
import type { LicenseEvidence } from "./types";

const HACKAGE_PACKAGE_CONF_MAX_BYTES = 1024 * 1024;
const HACKAGE_PACKAGE_DB_SEARCH_MAX_DEPTH = 8;
const HACKAGE_PACKAGE_DB_SEARCH_MAX_DIRS = 4000;

type HackagePackageConf = {
  name?: string;
  version?: string;
  license?: string;
};

export function collectHackagePackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  packageConfMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageConfPath = findHackagePackageConf({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot,
    packageConfMaxBytes: input.packageConfMaxBytes ?? HACKAGE_PACKAGE_CONF_MAX_BYTES
  });

  if (!packageConfPath.ok) {
    return err(packageConfPath.error);
  }

  if (!packageConfPath.value) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Hackage package metadata was not found in the local Stack package database."]
    });
  }

  const packageConf = readHackagePackageConf({
    packageId: input.packageId,
    packageConfPath: packageConfPath.value,
    maxBytes: input.packageConfMaxBytes ?? HACKAGE_PACKAGE_CONF_MAX_BYTES
  });
  if (!packageConf.ok) {
    return err(packageConf.error);
  }

  return ok({
    packageId: input.packageId,
    ...(packageConf.value.license
      ? {
          metadataLicense: packageConf.value.license,
          metadataSource: "ghc-pkg"
        }
      : {}),
    files: [],
    source: "local",
    warnings: packageConf.value.license
      ? []
      : ["Hackage package metadata did not declare license metadata."]
  });
}

function findHackagePackageConf(input: {
  packageName: string;
  version: string;
  projectRoot: string;
  packageConfMaxBytes: number;
}): Result<string | undefined, OhriskError> {
  const root = path.join(input.projectRoot, ".stack-work", "install");
  if (!isReadableDirectory(root)) {
    return ok(undefined);
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < HACKAGE_PACKAGE_DB_SEARCH_MAX_DIRS) {
    const item = queue.shift();
    if (!item) {
      continue;
    }

    visited += 1;
    if (path.basename(item.dir) === "pkgdb") {
      const found = findHackagePackageConfInDb(input, item.dir);
      if (!found.ok || found.value) {
        return found;
      }
    }

    if (item.depth >= HACKAGE_PACKAGE_DB_SEARCH_MAX_DEPTH) {
      continue;
    }

    for (const child of childDirectories(item.dir)) {
      queue.push({ dir: child, depth: item.depth + 1 });
    }
  }

  return ok(undefined);
}

function findHackagePackageConfInDb(
  input: { packageName: string; version: string; packageConfMaxBytes: number },
  packageDbDir: string
): Result<string | undefined, OhriskError> {
  const prefix = `${input.packageName}-${input.version}`;
  for (const entry of readDirectoryEntries(packageDbDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".conf") || !entry.name.startsWith(prefix)) {
      continue;
    }

    const packageConfPath = path.join(packageDbDir, entry.name);
    const packageConf = readHackagePackageConf({
      packageId: `${input.packageName}@${input.version}`,
      packageConfPath,
      maxBytes: input.packageConfMaxBytes
    });
    if (!packageConf.ok) {
      return err(packageConf.error);
    }

    if (packageConf.value.name === input.packageName && packageConf.value.version === input.version) {
      return ok(packageConfPath);
    }
  }

  return ok(undefined);
}

function readHackagePackageConf(input: {
  packageId: string;
  packageConfPath: string;
  maxBytes: number;
}): Result<HackagePackageConf, OhriskError> {
  const text = readTextFileWithLimit({ filePath: input.packageConfPath, maxBytes: input.maxBytes });
  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: hackagePackageConfReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          packageConfPath: input.packageConfPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  const fields = parsePackageConfFields(text.value);
  return ok(omitUndefined({
    name: fields.get("name"),
    version: fields.get("version"),
    license: fields.get("license")
  }));
}

function parsePackageConfFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      currentKey = undefined;
      continue;
    }

    if (/^\s/.test(line) && currentKey) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ""} ${line.trim()}`.trim());
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      currentKey = undefined;
      continue;
    }

    currentKey = line.slice(0, separatorIndex).trim().toLowerCase();
    fields.set(currentKey, line.slice(separatorIndex + 1).trim());
  }

  return fields;
}

function childDirectories(dir: string): string[] {
  return readDirectoryEntries(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name));
}

function readDirectoryEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return existsSync(pathname) && statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function hackagePackageConfReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Hackage package metadata exceeded the maximum supported size."
    : "Failed to read Hackage package metadata.";
}
