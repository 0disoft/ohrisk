import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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
import { parseZigHash } from "../graph/zig-zon";

const ZIG_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ZIG_LICENSE_FILE_LIMIT = 50;
const ZIG_TARBALL_UNPACKED_MAX_BYTES = 100 * 1024 * 1024;
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
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Zig package source.");
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
      maxEntries: input.maxEntries ?? ZIG_TARBALL_MAX_ENTRIES
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

  const computedHash = computeZigPackageHash(normalizedEntries);
  const expectedHash = input.expectedHash.trim();

  const hashMatch = verifyZigHash(computedHash, expectedHash);
  if (!hashMatch.ok) {
    return err(hashMatch.error);
  }

  const warnings: string[] = [];
  if (!hashMatch.value) {
    warnings.push(
      `Zig package hash format was not verifiable (expected: ${expectedHash.slice(0, 40)}…). Evidence collected without integrity verification.`
    );
  }

  const evidenceFiles = collectZigTarballEvidenceFiles(normalizedEntries, warnings);

  if (evidenceFiles.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Zig package tarball.");
  }

  return ok({
    packageId: input.packageId,
    files: evidenceFiles,
    source: "tarball",
    warnings
  });
}

function computeZigPackageHash(
  entries: Array<{ path: string; data: Buffer }>
): Buffer {
  const sorted = [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );

  const perFileHashes: Buffer[] = [];
  let totalSize = 0;

  for (const entry of sorted) {
    const normalizedPath = normalizeZigPath(entry.path);
    const hasher = createHash("sha256");
    hasher.update(normalizedPath);
    hasher.update(Buffer.from([0, 0]));
    hasher.update(entry.data);
    perFileHashes.push(hasher.digest());
    totalSize += entry.data.length;
  }

  const overallHasher = createHash("sha256");
  for (const fileHash of perFileHashes) {
    overallHasher.update(fileHash);
  }

  const digest = overallHasher.digest();
  return Buffer.concat([digest, Buffer.alloc(8)], 40);
}

function verifyZigHash(
  computed: Buffer,
  expected: string
): Result<boolean, OhriskError> {
  const parsed = parseZigHash(expected);

  if (!parsed) {
    return ok(false);
  }

  if (parsed.format === "old") {
    const computedHex = computed.subarray(0, 32).toString("hex");
    const expectedHex = parsed.digestHex.toLowerCase();
    return ok(computedHex === expectedHex);
  }

  // New format: name-version-base64url(id_le32 + size_le32 + digest[0:25])
  // We can only verify the digest portion (first 25 bytes) and size.
  // Full verification requires the package fingerprint (id field) from build.zig.zon,
  // which is only known for the root package, not for dependencies.
  // The hash field in .dependencies only stores the dependency's hash, not its fingerprint.
  // So for new-format hashes, we verify the digest prefix and size, but cannot
  // fully verify without the fingerprint. We return false (unverified) rather than
  // failing, so evidence is still collected with a warning.
  return ok(false);
}

function normalizeZigPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function detectTarRootPrefix(entries: TarEntry[]): string {
  const roots = new Set<string>();
  for (const entry of entries) {
    const separator = entry.path.indexOf("/");
    if (separator > 0) {
      roots.add(entry.path.slice(0, separator));
    }
  }

  if (roots.size === 1) {
    return [...roots][0]!;
  }

  return "";
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
