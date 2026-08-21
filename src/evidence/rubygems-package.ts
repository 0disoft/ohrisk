import { gunzipSync } from "node:zlib";

import { readArchiveBytes, type ArchiveSource } from "../archive/archive-reader";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import { sha256HexIntegrity, verifyPackageIntegrity } from "./package-integrity";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const GEM_METADATA_MAX_BYTES = 1024 * 1024;
const GEM_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const GEM_EVIDENCE_FILE_LIMIT = 50;

export type RubyGemsVersionMetadata = {
  gemUrl: string;
  sha256: string;
};

export function parseRubyGemsVersionMetadata(input: {
  packageId: string;
  packageName: string;
  version: string;
  registryUrl: string;
  text: string;
}): Result<RubyGemsVersionMetadata, OhriskError> {
  let document: unknown;
  try {
    document = JSON.parse(input.text) as unknown;
  } catch (cause) {
    return err(metadataError(input, "RubyGems version metadata was not valid JSON.", {
      cause: cause instanceof Error ? cause.message : String(cause)
    }));
  }

  if (!isRecord(document)) {
    return err(metadataError(input, "RubyGems version metadata did not have the expected shape."));
  }

  const name = document.name;
  const version = document.version;
  const platform = document.platform;
  const sha256 = document.sha;
  const gemUrl = document.gem_uri;
  const expectedGemUrl = rubyGemsArtifactUrl(input.packageName, input.version);
  if (
    !expectedGemUrl
    || name !== input.packageName
    || version !== input.version
    || platform !== "ruby"
    || typeof sha256 !== "string"
    || !/^[a-f0-9]{64}$/iu.test(sha256)
    || gemUrl !== expectedGemUrl
  ) {
    return err(metadataError(input, "RubyGems version metadata did not match the requested package identity and artifact.", {
      ...(typeof name === "string" ? { metadataName: name } : {}),
      ...(typeof version === "string" ? { metadataVersion: version } : {}),
      ...(typeof platform === "string" ? { metadataPlatform: platform } : {})
    }));
  }

  return ok({ gemUrl, sha256: sha256.toLowerCase() });
}

export function collectRubyGemArchiveEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  sha256: string;
  gem: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const gemBytes = Buffer.from(input.gem);
  const integrity = verifyPackageIntegrity({
    packageId: input.packageId,
    resolvedDetail: rubyGemsArtifactUrl(input.packageName, input.version),
    integrity: sha256HexIntegrity(input.sha256),
    artifact: gemBytes
  });
  if (!integrity.ok) return integrity;

  const outer = readArchiveBytes({
    displayName: `${input.packageName}-${input.version}.gem`,
    bytes: gemBytes,
    formatHint: "tar",
    limits: { inputBytes: input.artifactMaxBytes }
  });
  if (!outer.ok) return outer;

  const metadataEntry = outer.value.readEntry("metadata.gz");
  const dataEntry = outer.value.readEntry("data.tar.gz");
  if (!metadataEntry.ok || !dataEntry.ok) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Ruby gem archive is missing metadata.gz or data.tar.gz.",
      details: { packageId: input.packageId }
    }));
  }

  const metadata = readGemMetadata({ packageId: input.packageId, bytes: metadataEntry.value });
  if (!metadata.ok) return metadata;
  if (metadata.value.name !== input.packageName || metadata.value.version !== input.version) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Ruby gem archive metadata did not match the requested package identity.",
      details: {
        packageId: input.packageId,
        expectedName: input.packageName,
        expectedVersion: input.version,
        metadataName: metadata.value.name,
        metadataVersion: metadata.value.version
      }
    }));
  }

  const data = readArchiveBytes({
    displayName: "data.tar.gz",
    bytes: dataEntry.value,
    formatHint: "tar.gz",
    limits: { inputBytes: input.artifactMaxBytes }
  });
  if (!data.ok) return data;

  const warnings: string[] = [];
  const files = collectGemEvidenceFiles(data.value, warnings);
  if (files.length === 0) {
    warnings.push("No supported license, notice, attribution, or legal evidence file found in the checksum-verified Ruby gem archive.");
  }
  if (metadata.value.licenses.length === 0) {
    warnings.push("Checksum-verified Ruby gem metadata did not declare license metadata.");
  }

  return ok({
    packageId: input.packageId,
    ...(metadata.value.licenses.length === 1
      ? { metadataLicense: metadata.value.licenses[0], metadataSource: "metadata.gz" }
      : {}),
    ...(metadata.value.licenses.length > 1
      ? { metadataLicenses: metadata.value.licenses, metadataSource: "metadata.gz" }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

export function rubyGemsVersionMetadataUrl(name: string, version: string): string | undefined {
  if (!isSafeGemCoordinate(name) || !isSafeGemCoordinate(version)) return undefined;
  return `https://rubygems.org/api/v2/rubygems/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}.json?platform=ruby`;
}

function rubyGemsArtifactUrl(name: string, version: string): string | undefined {
  if (!isSafeGemCoordinate(name) || !isSafeGemCoordinate(version)) return undefined;
  return `https://rubygems.org/gems/${name}-${version}.gem`;
}

function isSafeGemCoordinate(value: string): boolean {
  return value.length > 0 && value.length <= 255 && /^[A-Za-z0-9_.+-]+$/u.test(value);
}

function readGemMetadata(input: {
  packageId: string;
  bytes: Buffer;
}): Result<{ name: string; version: string; licenses: string[] }, OhriskError> {
  let text: string;
  try {
    text = gunzipSync(input.bytes, { maxOutputLength: GEM_METADATA_MAX_BYTES }).toString("utf8");
  } catch (cause) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Ruby gem metadata.gz was malformed or exceeded the maximum supported size.",
      details: {
        packageId: input.packageId,
        maxBytes: GEM_METADATA_MAX_BYTES,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }

  const name = readMetadataScalar(text, "name");
  const rawVersion = text.match(/^version:\s*!ruby\/object:Gem::Version\s*\r?\n\s+version:\s*([^\r\n]+)$/mu)?.[1]?.trim();
  const version = rawVersion ? unquoteYamlScalar(rawVersion) : undefined;
  if (!name || !version || !isSafeGemCoordinate(name) || !isSafeGemCoordinate(version)) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Ruby gem metadata.gz did not contain a safe name and version.",
      details: { packageId: input.packageId }
    }));
  }

  const licenses: string[] = [];
  const licenseBlock = text.match(/^licenses:\s*\r?\n((?:-\s*[^\r\n]*\r?\n?)*)/mu)?.[1] ?? "";
  for (const match of licenseBlock.matchAll(/^-\s*([^\r\n]+)$/gmu)) {
    const license = unquoteYamlScalar(match[1]?.trim() ?? "");
    if (license) licenses.push(license);
  }
  return ok({ name, version, licenses: [...new Set(licenses)] });
}

function readMetadataScalar(text: string, name: string): string | undefined {
  const value = text.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, "mu"))?.[1]?.trim();
  return value ? unquoteYamlScalar(value) : undefined;
}

function unquoteYamlScalar(value: string): string | undefined {
  if (value === "" || value === "null" || value.startsWith("!")) return undefined;
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1).trim() || undefined;
  }
  return value.trim() || undefined;
}

function collectGemEvidenceFiles(archive: ArchiveSource, warnings: string[]): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  const candidates = archive.entries
    .filter((entry) => entry.type === "file" && !entry.path.includes("/") && classifyEvidenceFile(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, GEM_EVIDENCE_FILE_LIMIT);

  for (const candidate of candidates) {
    const text = archive.readText(candidate.path, GEM_EVIDENCE_FILE_MAX_BYTES);
    if (!text.ok) {
      warnings.push(`Skipped ${candidate.path}: Ruby gem evidence file could not be read within the supported bounds.`);
      continue;
    }
    const kind = classifyEvidenceFile(candidate.path);
    if (kind) files.push({ path: candidate.path, kind, text: text.value });
  }
  return files;
}

function metadataError(
  input: { packageId: string; packageName: string; version: string; registryUrl: string },
  message: string,
  details: Record<string, unknown> = {}
): OhriskError {
  return createError({
    code: "REGISTRY_METADATA_FETCH_FAILED",
    category: "unsupported_input",
    message,
    details: {
      packageId: input.packageId,
      packageName: input.packageName,
      version: input.version,
      registryUrl: input.registryUrl,
      ...details
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
