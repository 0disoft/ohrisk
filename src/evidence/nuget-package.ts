import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { parseXmlDocument, type XmlNode } from "../graph/xml";
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

const NUGET_NUSPEC_MAX_BYTES = 1024 * 1024;
const NUGET_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const NUGET_LICENSE_FILE_LIMIT = 50;

export type NuspecMetadata = {
  id?: string;
  version?: string;
  license?: string;
  licenseType?: string;
  licenseUrl?: string;
};

export function collectNugetPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  nuspecMaxBytes?: number;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const packageDir = findNugetPackageDir({
    packageName: input.packageName,
    version: input.version,
    projectRoot: input.projectRoot
  });

  if (!packageDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["NuGet package metadata was not found in a local NuGet package cache."]
    });
  }

  const nuspecPath = findNuspecPath(packageDir, input.packageName, input.version);
  const metadata = nuspecPath
    ? readNuspecMetadata({
        packageId: input.packageId,
        nuspecPath,
        maxBytes: input.nuspecMaxBytes ?? NUGET_NUSPEC_MAX_BYTES
      })
    : (ok({}) as Result<NuspecMetadata, OhriskError>);

  if (!metadata.ok) {
    return err(metadata.error);
  }

  const warnings: string[] = [];
  const files = readNugetEvidenceFiles({
    packageDir,
    metadata: metadata.value,
    maxBytes: input.evidenceFileMaxBytes ?? NUGET_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No supported license, notice, attribution, or legal evidence file found in NuGet package source.");
  }

  if (!metadata.value.license && metadata.value.licenseUrl) {
    warnings.push(`NuGet nuspec declared only a licenseUrl: ${metadata.value.licenseUrl}`);
  }

  if (!metadata.value.license && !metadata.value.licenseUrl) {
    warnings.push("NuGet nuspec did not declare a package license.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadata.value.license && metadata.value.licenseType !== "file"
      ? {
          metadataLicense: metadata.value.license,
          metadataSource: "nuspec"
        }
      : {}),
    files,
    source: "local",
    warnings
  });
}

function findNugetPackageDir(input: {
  packageName: string;
  version: string;
  projectRoot: string;
}): string | undefined {
  const normalizedName = input.packageName.toLowerCase();
  const normalizedVersion = input.version.toLowerCase();

  for (const root of nugetPackageRoots(input.projectRoot)) {
    const packageRoot = path.resolve(root);
    const globalCandidate = path.resolve(root, normalizedName, normalizedVersion);
    if (
      isPathInside(packageRoot, globalCandidate)
      && existsSync(globalCandidate)
      && isReadableDirectory(globalCandidate)
    ) {
      return globalCandidate;
    }

    const packagesCandidate = path.resolve(root, `${input.packageName}.${input.version}`);
    if (
      isPathInside(packageRoot, packagesCandidate)
      && existsSync(packagesCandidate)
      && isReadableDirectory(packagesCandidate)
    ) {
      return packagesCandidate;
    }
  }

  return undefined;
}

function nugetPackageRoots(projectRoot: string): string[] {
  const roots = [
    path.join(projectRoot, ".nuget", "packages"),
    path.join(projectRoot, "packages")
  ];

  const nugetPackages = process.env.NUGET_PACKAGES;
  if (nugetPackages) {
    roots.push(nugetPackages);
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".nuget", "packages"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function findNuspecPath(packageDir: string, packageName: string, version: string): string | undefined {
  const expected = path.join(packageDir, `${packageName}.nuspec`);
  if (existsSync(expected)) {
    return expected;
  }

  const expectedWithVersion = path.join(packageDir, `${packageName}.${version}.nuspec`);
  if (existsSync(expectedWithVersion)) {
    return expectedWithVersion;
  }

  try {
    const nuspec = readdirSync(packageDir)
      .find((entry) => entry.toLowerCase().endsWith(".nuspec"));
    return nuspec ? path.join(packageDir, nuspec) : undefined;
  } catch {
    return undefined;
  }
}

function readNuspecMetadata(input: {
  packageId: string;
  nuspecPath: string;
  maxBytes: number;
}): Result<NuspecMetadata, OhriskError> {
  const text = readTextFileWithLimit({
    filePath: input.nuspecPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: text.error.kind === "too_large"
          ? "NuGet nuspec metadata exceeded the maximum supported size."
          : "Failed to read NuGet nuspec metadata.",
        details: {
          packageId: input.packageId,
          nuspecPath: input.nuspecPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return parseNuspecMetadata({
    packageId: input.packageId,
    text: text.value
  });
}

export function parseNuspecMetadata(input: {
  packageId: string;
  text: string;
}): Result<NuspecMetadata, OhriskError> {
  const document = parseXmlDocument(
    input.text,
    "<NuGet package nuspec>",
    (_path, cause) => err(createError({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      message: "NuGet nuspec metadata was malformed.",
      details: { packageId: input.packageId, cause }
    }))
  );
  if (!document.ok) {
    return document;
  }
  if (document.value.name.toLowerCase() !== "package") {
    return err(nuspecStructureError(input.packageId, "NuGet nuspec root element was not package.", {
      reason: "nuspec_root_invalid"
    }));
  }
  const metadataNodes = childNodesCaseInsensitive(document.value, "metadata");
  if (metadataNodes.length !== 1) {
    return err(nuspecStructureError(input.packageId, "NuGet nuspec did not contain exactly one metadata element.", {
      reason: metadataNodes.length === 0 ? "nuspec_metadata_missing" : "nuspec_metadata_ambiguous",
      metadataCount: metadataNodes.length
    }));
  }
  const metadata = metadataNodes[0] as XmlNode;
  const id = readUniqueChildText(metadata, "id", input.packageId);
  if (!id.ok) return id;
  const version = readUniqueChildText(metadata, "version", input.packageId);
  if (!version.ok) return version;
  const license = readUniqueChild(metadata, "license", input.packageId);
  if (!license.ok) return license;
  const licenseUrl = readUniqueChildText(metadata, "licenseUrl", input.packageId);
  if (!licenseUrl.ok) return licenseUrl;
  const licenseText = license.value?.text.trim();
  const licenseType = readAttributeCaseInsensitive(license.value, "type")?.trim().toLowerCase();

  return ok({
    ...(id.value ? { id: id.value } : {}),
    ...(version.value ? { version: version.value } : {}),
    ...(licenseText ? { license: licenseText } : {}),
    ...(licenseType ? { licenseType } : {}),
    ...(licenseUrl.value ? { licenseUrl: licenseUrl.value } : {})
  });
}

function readUniqueChildText(
  parent: XmlNode,
  name: string,
  packageId: string
): Result<string | undefined, OhriskError> {
  const child = readUniqueChild(parent, name, packageId);
  return child.ok ? ok(child.value?.text.trim() || undefined) : child;
}

function readUniqueChild(
  parent: XmlNode,
  name: string,
  packageId: string
): Result<XmlNode | undefined, OhriskError> {
  const children = childNodesCaseInsensitive(parent, name);
  if (children.length > 1) {
    return err(nuspecStructureError(packageId, `NuGet nuspec metadata contained duplicate ${name} elements.`, {
      reason: "nuspec_metadata_element_ambiguous",
      element: name,
      count: children.length
    }));
  }
  return ok(children[0]);
}

function childNodesCaseInsensitive(node: XmlNode, name: string): XmlNode[] {
  const normalized = name.toLowerCase();
  return node.children.filter((child) => child.name.toLowerCase() === normalized);
}

function readAttributeCaseInsensitive(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const normalized = name.toLowerCase();
  return Object.entries(node.attributes)
    .find(([key]) => key.toLowerCase() === normalized)?.[1];
}

function nuspecStructureError(
  packageId: string,
  message: string,
  details: Record<string, unknown>
): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message,
    details: { packageId, ...details }
  });
}

function readNugetEvidenceFiles(input: {
  packageDir: string;
  metadata: NuspecMetadata;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const candidates = evidenceFileCandidates(input.packageDir);

  if (input.metadata.license && input.metadata.licenseType === "file") {
    candidates.unshift({
      absolutePath: path.resolve(input.packageDir, input.metadata.license),
      relativePath: input.metadata.license
    });
  }

  return readEvidenceFiles({
    packageDir: input.packageDir,
    candidates,
    maxBytes: input.maxBytes,
    warnings: input.warnings
  });
}

function readEvidenceFiles(input: {
  packageDir: string;
  candidates: Array<{ absolutePath: string; relativePath: string }>;
  maxBytes: number;
  warnings: string[];
}): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  const seen = new Set<string>();
  const packageRoot = path.resolve(input.packageDir);

  for (const candidate of input.candidates.slice(0, NUGET_LICENSE_FILE_LIMIT)) {
    if (seen.has(candidate.absolutePath)) {
      continue;
    }

    seen.add(candidate.absolutePath);
    const kind = classifyEvidenceFile(candidate.relativePath);
    if (!kind || !isPathInside(packageRoot, candidate.absolutePath)) {
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
