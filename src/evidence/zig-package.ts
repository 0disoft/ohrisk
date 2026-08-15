import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import { createError, type OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import {
  gunzipTarballWithLimit,
  parseTarEntries,
  type TarEntry
} from "./tarball";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";
import { parseZigHash, extractZigManifestMetadata, type ZigManifestMetadata } from "../graph/zig-zon";

const ZIG_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ZIG_LICENSE_FILE_LIMIT = 50;
const ZIG_TARBALL_UNPACKED_MAX_BYTES = 100 * 1024 * 1024;
const ZIG_MANIFEST_DECODER = new TextDecoder("utf-8", { fatal: true });
const ZIG_TARBALL_MAX_ENTRIES = 50_000;

export function collectZigPackageEvidence(input: {
  packageId: string;
  packageName: string;
  projectRoot: string;
  resolved?: string;
  evidenceFileMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  if (!input.resolved) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Zig package has no resolved URL or path."]
    });
  }

  const localDir = resolveLocalZigPath({
    resolved: input.resolved,
    projectRoot: input.projectRoot
  });

  if (!localDir) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Zig package source was not found as a local path or was outside the project root."]
    });
  }

  const warnings: string[] = [];
  const files = readZigEvidenceFiles({
    packageDir: localDir,
    maxBytes: input.evidenceFileMaxBytes ?? ZIG_EVIDENCE_FILE_MAX_BYTES,
    warnings
  });

  if (files.length === 0) {
    warnings.push("No supported license, notice, attribution, or legal evidence file found in Zig package source.");
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "local",
    warnings
  });
}

export function collectRemoteZigTarballEvidence(input: {
  packageId: string;
  packageName: string;
  tarball: Buffer | Uint8Array;
  expectedHash: string;
  unpackedMaxBytes?: number;
  maxEntries?: number;
}): Result<LicenseEvidence, OhriskError> {
  const unpacked = gunzipTarballWithLimit({
    packageId: input.packageId,
    tarball: input.tarball,
    maxBytes: input.unpackedMaxBytes ?? ZIG_TARBALL_UNPACKED_MAX_BYTES
  });
  if (!unpacked.ok) {
    return err(unpacked.error);
  }

  let entries: TarEntry[];
  try {
    entries = parseTarEntries({
      tarball: unpacked.value,
      maxEntries: input.maxEntries ?? ZIG_TARBALL_MAX_ENTRIES,
      rejectNonRegular: true
    });
  } catch (cause) {
    return err(
      createError({
        code: "TARBALL_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse Zig package tarball entries.",
        details: {
          packageId: input.packageId,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  const rootPrefix = detectTarRootPrefix(entries);

  const normalizedEntries = entries
    .filter((entry) => entry.type === "0" || entry.type === "")
    .map((entry) => ({
      path: stripRootPrefix(entry.path, rootPrefix),
      data: entry.data
    }))
    .filter((entry) => entry.path.length > 0);

  const manifestLookup = findManifestMetadata(normalizedEntries);
  if (manifestLookup.status === "invalid") {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["Zig package hash is not verifiable because the tarball contains an invalid build.zig.zon."]
    });
  }
  const manifestMetadata = manifestLookup.status === "valid"
    ? manifestLookup.metadata
    : undefined;
  const pathFilter = manifestMetadata?.paths
    ? filterEntriesByPaths(normalizedEntries, manifestMetadata.paths)
    : { entries: normalizedEntries };
  if ("warning" in pathFilter) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [pathFilter.warning]
    });
  }
  const coveredEntries = pathFilter.entries;

  const computed = computeZigPackageHash(coveredEntries);
  const expectedHash = input.expectedHash;

  const verification = verifyZigHash({
    packageId: input.packageId,
    computed,
    expected: expectedHash,
    manifest: manifestMetadata
  });
  if (!verification.ok) {
    return err(verification.error);
  }
  if (verification.value.status === "unverifiable") {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [verification.value.warning]
    });
  }

  const warnings: string[] = [];
  const evidenceFiles = collectZigTarballEvidenceFiles(coveredEntries, warnings);

  if (evidenceFiles.length === 0) {
    warnings.push("No supported license, notice, attribution, or legal evidence file found in Zig package tarball.");
  }

  return ok({
    packageId: input.packageId,
    files: evidenceFiles,
    source: "tarball",
    warnings
  });
}

type ZigComputedHash = {
  digest: Buffer;
  totalSize: number;
};

function computeZigPackageHash(
  entries: Array<{ path: string; data: Buffer }>
): ZigComputedHash {
  const sorted = entries
    .map((entry) => ({ ...entry, normalizedPath: normalizeZigPath(entry.path) }))
    .sort((left, right) => Buffer.compare(
      Buffer.from(left.normalizedPath, "latin1"),
      Buffer.from(right.normalizedPath, "latin1")
    ));

  const perFileHashes: Buffer[] = [];
  let totalSize = 0;

  for (const entry of sorted) {
    const hasher = createHash("sha256");
    hasher.update(Buffer.from(entry.normalizedPath, "latin1"));
    hasher.update(Buffer.from([0, 0]));
    hasher.update(entry.data);
    perFileHashes.push(hasher.digest());
    totalSize += entry.data.length;
  }

  const overallHasher = createHash("sha256");
  for (const fileHash of perFileHashes) {
    overallHasher.update(fileHash);
  }

  return {
    digest: overallHasher.digest(),
    totalSize
  };
}

function filterEntriesByPaths(
  entries: Array<{ path: string; data: Buffer }>,
  paths: string[]
):
  | { entries: Array<{ path: string; data: Buffer }> }
  | { warning: string } {
  if (paths.length === 0) {
    return { entries };
  }

  const normalizedPaths: string[] = [];
  for (const includePath of paths) {
    const normalizedPath = normalizeManifestIncludePath(includePath);
    if (normalizedPath === undefined) {
      return {
        warning: "Zig package hash is not verifiable because manifest .paths escapes the package root."
      };
    }
    normalizedPaths.push(normalizedPath);
  }

  // Paths resolving to the package root include everything.
  if (normalizedPaths.includes("")) {
    return { entries };
  }

  const includeSet = new Set(normalizedPaths);

  return { entries: entries.filter((entry) => {
    const normalized = normalizeZigPath(entry.path);

    // Direct match
    if (includeSet.has(normalized)) {
      return true;
    }

    // Check if any included path is a parent directory
    let dirname = normalized;
    while (dirname.includes("/")) {
      const lastSlash = dirname.lastIndexOf("/");
      dirname = dirname.slice(0, lastSlash);
      if (includeSet.has(dirname)) {
        return true;
      }
    }

    return false;
  }) };
}

function normalizeManifestIncludePath(includePath: string): string | undefined {
  const normalized = normalizeZigPath(includePath);
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

type ZigManifestLookup =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; metadata: ZigManifestMetadata };

function findManifestMetadata(
  entries: Array<{ path: string; data: Buffer }>
): ZigManifestLookup {
  const zonEntry = entries.find((entry) => entry.path === "build.zig.zon");
  if (!zonEntry) {
    return { status: "absent" };
  }

  let zonText: string;
  try {
    zonText = ZIG_MANIFEST_DECODER.decode(zonEntry.data);
  } catch {
    return { status: "invalid" };
  }
  const metadata = extractZigManifestMetadata(zonText);
  return metadata
    ? { status: "valid", metadata }
    : { status: "invalid" };
}

type ZigHashVerification =
  | { status: "verified" }
  | { status: "unverifiable"; warning: string };

function verifyZigHash(input: {
  packageId: string;
  computed: ZigComputedHash;
  expected: string;
  manifest: ZigManifestMetadata | undefined;
}): Result<ZigHashVerification, OhriskError> {
  const parsed = parseZigHash(input.expected);

  if (!parsed) {
    return ok({
      status: "unverifiable",
      warning: `Zig package hash format is not verifiable: ${input.expected.slice(0, 40)}…`
    });
  }

  if (parsed.format === "old") {
    const computedHex = input.computed.digest.toString("hex");
    const expectedHex = parsed.digestHex.toLowerCase();
    return computedHex === expectedHex
      ? ok({ status: "verified" })
      : zigHashMismatch(input);
  }

  // New format: name-version-base64url(id_le32 + size_le32 + digest[0:25])
  let name: string;
  let version: string;
  let id: number;

  if (!input.manifest) {
    if (parsed.name !== "N" || parsed.version !== "V") {
      return ok({
        status: "unverifiable",
        warning: "Zig package hash is not verifiable because build.zig.zon with fingerprint was not found in the tarball."
      });
    }

    // Zig uses this exact identity and ID for archives without build.zig.zon.
    name = "N";
    version = "V";
    id = 0xffff;
  } else if (!input.manifest.paths || input.manifest.paths.length === 0) {
    return ok({
      status: "unverifiable",
      warning: "Zig package hash is not verifiable because build.zig.zon has no non-empty .paths field."
    });
  } else if (input.manifest.fingerprint === undefined) {
    return ok({
      status: "unverifiable",
      warning: "Zig package hash is not verifiable because build.zig.zon with fingerprint was not found in the tarball."
    });
  } else {
    name = input.manifest.name;
    version = input.manifest.version;
    // Extract package ID from fingerprint (lower 32 bits of the u64, LE)
    id = Number(input.manifest.fingerprint & 0xFFFFFFFFn);
  }

  const saturatedSize = Math.min(input.computed.totalSize, 0xFFFFFFFF);

  // Build hashplus: id_le32 + size_le32 + digest[0:25]
  const hashplus = Buffer.alloc(33);
  hashplus.writeUInt32LE(id, 0);
  hashplus.writeUInt32LE(saturatedSize, 4);
  input.computed.digest.subarray(0, 25).copy(hashplus, 8);

  // base64url encode (no padding)
  const hashplusB64 = hashplus.toString("base64url");

  // Construct expected: name-version-hashplus
  const expectedHashString = `${name}-${version}-${hashplusB64}`;

  return expectedHashString === input.expected
    ? ok({ status: "verified" })
    : zigHashMismatch(input);
}

function zigHashMismatch(input: {
  packageId: string;
  computed: ZigComputedHash;
  expected: string;
}): Result<never, OhriskError> {
  return err(createError({
    code: "PACKAGE_INTEGRITY_CHECK_FAILED",
    category: "unsupported_input",
    message: "Zig package hash did not match build.zig.zon.",
    details: {
      packageId: input.packageId,
      integrity: input.expected,
      computedDigest: input.computed.digest.toString("hex"),
      computedSize: input.computed.totalSize
    }
  }));
}

function normalizeZigPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function detectTarRootPrefix(entries: TarEntry[]): string {
  let root: string | undefined;
  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/\\/g, "/");
    const separator = normalizedPath.indexOf("/");
    if (separator <= 0) {
      return "";
    }
    const candidate = normalizedPath.slice(0, separator);
    if (root !== undefined && candidate !== root) {
      return "";
    }
    root = candidate;
  }

  return root ?? "";
}

function stripRootPrefix(tarPath: string, rootPrefix: string): string {
  if (!rootPrefix) {
    return tarPath;
  }

  const prefix = rootPrefix + "/";
  if (tarPath.startsWith(prefix)) {
    return tarPath.slice(prefix.length);
  }

  if (tarPath === rootPrefix) {
    return "";
  }

  return tarPath;
}

function collectZigTarballEvidenceFiles(
  entries: Array<{ path: string; data: Buffer }>,
  warnings: string[]
): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];

  for (const entry of entries) {
    const kind = classifyEvidenceFile(entry.path);
    if (!kind) {
      continue;
    }

    if (files.length >= ZIG_LICENSE_FILE_LIMIT) {
      warnings.push(`Zig package evidence file limit reached at ${ZIG_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    if (entry.data.length > ZIG_EVIDENCE_FILE_MAX_BYTES) {
      warnings.push(`Skipped Zig evidence file ${entry.path}: file exceeded ${ZIG_EVIDENCE_FILE_MAX_BYTES} bytes.`);
      continue;
    }

    files.push({
      path: entry.path,
      kind,
      text: entry.data.toString("utf8")
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveLocalZigPath(input: {
  resolved: string;
  projectRoot: string;
}): string | undefined {
  if (looksRemote(input.resolved)) {
    return undefined;
  }

  const candidate = path.resolve(input.projectRoot, input.resolved);
  if (!isPathInside(input.projectRoot, candidate) || !isReadableDirectory(candidate)) {
    return undefined;
  }

  return candidate;
}

function readZigEvidenceFiles(input: {
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

    if (files.length >= ZIG_LICENSE_FILE_LIMIT) {
      input.warnings.push(`Zig package evidence file limit reached at ${ZIG_LICENSE_FILE_LIMIT} files.`);
      break;
    }

    const text = readTextFileWithLimit({
      filePath: candidate.absolutePath,
      maxBytes: input.maxBytes
    });

    if (!text.ok) {
      input.warnings.push(`Skipped Zig evidence file ${candidate.relativePath}: ${evidenceReadError(text.error)}.`);
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

function evidenceReadError(error: TextFileReadError): string {
  switch (error.kind) {
    case "too_large":
      return `file exceeded ${error.maxBytes} bytes`;
    case "filesystem":
      return error.cause;
  }
}

function looksRemote(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isReadableDirectory(pathname: string): boolean {
  try {
    return existsSync(pathname) && statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
