import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ok, type Result } from "../shared/result";
import { collectLocalPackageEvidence } from "./local-package";
import type { LicenseEvidence } from "./types";
import type { OhriskError } from "../shared/errors";

export function collectUnityPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findUnityPackageDir(input);
  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Unity package source was not found in Packages/ or Library/PackageCache. Run Unity package restore before scanning for local license evidence."
      ]
    });
  }

  return collectLocalPackageEvidence({
    packageId: input.packageId,
    packageDir
  });
}

function findUnityPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const embeddedPackage = path.resolve(input.projectRoot, "Packages", input.packageName);
  const embeddedRoot = path.resolve(input.projectRoot, "Packages");
  if (
    isPathInside(embeddedRoot, embeddedPackage)
    && existsSync(embeddedPackage)
    && isReadableDirectory(embeddedPackage)
  ) {
    return embeddedPackage;
  }

  const packageCacheRoot = path.resolve(input.projectRoot, "Library", "PackageCache");
  const exactCachePackage = path.resolve(packageCacheRoot, `${input.packageName}@${input.version}`);
  if (
    isPathInside(packageCacheRoot, exactCachePackage)
    && existsSync(exactCachePackage)
    && isReadableDirectory(exactCachePackage)
  ) {
    return exactCachePackage;
  }

  for (const candidate of packageCacheCandidates({
    packageCacheRoot,
    packageName: input.packageName,
    version: input.version
  })) {
    return candidate;
  }

  return undefined;
}

function packageCacheCandidates(input: {
  packageCacheRoot: string;
  packageName: string;
  version: string;
}): string[] {
  let entries: string[];
  try {
    entries = readdirSync(input.packageCacheRoot);
  } catch {
    return [];
  }

  const prefix = `${input.packageName}@${input.version}`;
  return entries
    .filter((entry) => entry === prefix || entry.startsWith(`${prefix}-`))
    .map((entry) => path.resolve(input.packageCacheRoot, entry))
    .filter((candidate) =>
      isPathInside(input.packageCacheRoot, candidate)
      && existsSync(candidate)
      && isReadableDirectory(candidate)
    )
    .sort();
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
