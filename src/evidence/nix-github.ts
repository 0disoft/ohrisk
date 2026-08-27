import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { XzReadableStream } from "xz-decompress";

import { createError, type OhriskError } from "../shared/errors";
import { isLockedNixosReleaseArchive } from "../shared/nixos-release-archive";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const NIX_GITHUB_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
const NIX_RELEASE_ARCHIVE_MAX_BYTES = 320 * 1024 * 1024;
const NIX_GITHUB_ARCHIVE_MAX_ENTRIES = 50_000;
const NIX_RELEASE_ARCHIVE_MAX_ENTRIES = 100_000;
const NIX_GITHUB_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const NIX_GITHUB_EVIDENCE_FILE_LIMIT = 50;
const NIX_GITHUB_MAX_COMPRESSION_RATIO = 200;
const NIX_XZ_EVENT_LOOP_YIELD_BYTES = 16 * 1024 * 1024;
const NIX_TAR_STREAM_CHUNK_BYTES = 1024 * 1024;
const NIX_TAR_EXTENSION_MAX_BYTES = 2 * 1024 * 1024;
export const NIX_GITHUB_ARCHIVE_HOSTS = new Set(["codeload.github.com"]);
export const NIX_RELEASE_ARCHIVE_HOSTS = new Set(["releases.nixos.org"]);

type ParsedTarEntry = {
  path: string;
  type: "directory" | "regular" | "symlink";
  dataOffset: number;
  size: number;
  executable: boolean;
  linkTarget?: string;
};

type TarSource = {
  byteLength: number;
  read: (offset: number, length: number) => Buffer;
};

export function collectNixGitHubArchiveEvidence(input: {
  packageId: string;
  tarball: Buffer | Uint8Array;
  expectedNarHash: string;
  unpackedMaxBytes?: number;
  maxEntries?: number;
}): Result<LicenseEvidence, OhriskError> {
  const expectedDigest = parseSha256Sri(input.expectedNarHash);
  if (!expectedDigest) {
    return ok(unavailableEvidence(
      input.packageId,
      "Nix GitHub input narHash is missing or malformed; remote source was not trusted."
    ));
  }

  const compressed = Buffer.from(input.tarball);
  const unpackedMaxBytes = input.unpackedMaxBytes ?? NIX_GITHUB_ARCHIVE_MAX_BYTES;
  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: unpackedMaxBytes });
  } catch (cause) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to decompress package tarball evidence.",
      details: {
        packageId: input.packageId,
        maxUnpackedBytes: unpackedMaxBytes,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }

  return collectVerifiedNixTarEvidence({
    packageId: input.packageId,
    source: bufferTarSource(tar),
    compressedBytes: compressed.byteLength,
    expectedDigest,
    expectedNarHash: input.expectedNarHash,
    maxEntries: input.maxEntries ?? NIX_GITHUB_ARCHIVE_MAX_ENTRIES,
    sourceLabel: "Nix GitHub"
  });
}

export async function collectNixTarXzArchiveEvidence(input: {
  packageId: string;
  tarball: Buffer | Uint8Array;
  expectedNarHash: string;
  unpackedMaxBytes?: number;
  maxEntries?: number;
  signal?: AbortSignal;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  const expectedDigest = parseSha256Sri(input.expectedNarHash);
  if (!expectedDigest) {
    return ok(unavailableEvidence(
      input.packageId,
      "Nix release input narHash is missing or malformed; remote source was not trusted."
    ));
  }

  const compressed = Buffer.from(input.tarball);
  const unpackedMaxBytes = input.unpackedMaxBytes ?? NIX_RELEASE_ARCHIVE_MAX_BYTES;
  return collectTemporaryNixTarXzEvidence({
    packageId: input.packageId,
    compressed,
    maxBytes: unpackedMaxBytes,
    compressedBytes: compressed.byteLength,
    expectedDigest,
    expectedNarHash: input.expectedNarHash,
    maxEntries: input.maxEntries ?? NIX_RELEASE_ARCHIVE_MAX_ENTRIES,
    ...(input.signal ? { signal: input.signal } : {})
  });
}

function collectVerifiedNixTarEvidence(input: {
  packageId: string;
  source: TarSource;
  compressedBytes: number;
  expectedDigest: Buffer;
  expectedNarHash: string;
  maxEntries: number;
  sourceLabel: string;
}): Result<LicenseEvidence, OhriskError> {
  try {
    if (
      input.source.byteLength >= 1024 * 1024
      && input.source.byteLength > input.compressedBytes * NIX_GITHUB_MAX_COMPRESSION_RATIO
    ) {
      throw new Error(`${input.sourceLabel} archive exceeded the supported compression ratio.`);
    }

    const entries = parseGitHubTar({ source: input.source, maxEntries: input.maxEntries });
    const actualDigest = hashNixArchive(input.source, entries);
    if (!timingSafeEqual(actualDigest, input.expectedDigest)) {
      return err(createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: `${input.sourceLabel} source tree did not match the locked narHash.`,
        details: {
          packageId: input.packageId,
          reason: "nix_nar_hash_mismatch",
          expected: input.expectedNarHash,
          actual: `sha256-${actualDigest.toString("base64")}`
        }
      }));
    }

    const files = collectRootEvidenceFiles(input.source, entries);
    return ok({
      packageId: input.packageId,
      files,
      source: "tarball",
      warnings: files.length === 0
        ? [`No supported root license, notice, attribution, or legal evidence file found in the verified ${input.sourceLabel} source tree.`]
        : []
    });
  } catch (cause) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: `Failed to parse or hash the ${input.sourceLabel} source archive.`,
      details: {
        packageId: input.packageId,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }
}

async function collectTemporaryNixTarXzEvidence(input: {
  packageId: string;
  compressed: Buffer;
  maxBytes: number;
  compressedBytes: number;
  expectedDigest: Buffer;
  expectedNarHash: string;
  maxEntries: number;
  signal?: AbortSignal;
}): Promise<Result<LicenseEvidence, OhriskError>> {
  let directory: string;
  try {
    directory = mkdtempSync(path.join(tmpdir(), "ohrisk-nix-xz-"));
  } catch {
    return err(temporaryNixArchiveError(input.packageId, "create"));
  }

  let descriptor: number | undefined;
  let result: Result<LicenseEvidence, OhriskError> = err(
    temporaryNixArchiveError(input.packageId, "process")
  );
  try {
    descriptor = openSync(path.join(directory, "archive.tar"), "wx+", 0o600);
    const decompressed = await decompressXzToFile({
      compressed: input.compressed,
      descriptor,
      maxBytes: input.maxBytes,
      ...(input.signal ? { signal: input.signal } : {})
    });
    result = decompressed.ok
      ? collectVerifiedNixTarEvidence({
          packageId: input.packageId,
          source: fileTarSource(descriptor, decompressed.bytesWritten),
          compressedBytes: input.compressedBytes,
          expectedDigest: input.expectedDigest,
          expectedNarHash: input.expectedNarHash,
          maxEntries: input.maxEntries,
          sourceLabel: "NixOS release"
        })
      : err(createError({
          code: "TARBALL_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to decompress package tarball evidence.",
          details: {
            packageId: input.packageId,
            maxUnpackedBytes: input.maxBytes,
            cause: decompressed.cause
          }
        }));
  } catch {
    result = err(temporaryNixArchiveError(input.packageId, "process"));
  }

  let cleanupFailed = false;
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    cleanupFailed = true;
  }
  return cleanupFailed
    ? err(temporaryNixArchiveError(input.packageId, "cleanup"))
    : result;
}

async function decompressXzToFile(input: {
  compressed: Buffer;
  descriptor: number;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; bytesWritten: number } | { ok: false; cause: string }> {
  const compressedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input.compressed);
      controller.close();
    }
  });
  const stream = new XzReadableStream(compressedStream);
  const reader = stream.getReader();
  let total = 0;
  let nextYieldAt = NIX_XZ_EVENT_LOOP_YIELD_BYTES;
  try {
    while (true) {
      if (input.signal?.aborted) {
        await reader.cancel(input.signal.reason);
        return { ok: false, cause: "Nix archive decompression was cancelled." };
      }
      const next = await reader.read();
      if (next.done) break;
      const previousTotal = total;
      total += next.value.byteLength;
      if (!Number.isSafeInteger(total) || total > input.maxBytes) {
        await reader.cancel("expanded archive limit exceeded");
        return { ok: false, cause: "Nix archive exceeded the expanded size limit." };
      }
      writeAllSync(input.descriptor, next.value, previousTotal);
      if (total >= nextYieldAt) {
        await yieldToEventLoop();
        nextYieldAt = total + NIX_XZ_EVENT_LOOP_YIELD_BYTES;
      }
    }
    return { ok: true, bytesWritten: total };
  } catch (cause) {
    return { ok: false, cause: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    reader.releaseLock();
  }
}

function writeAllSync(descriptor: number, bytes: Uint8Array, fileOffset: number): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(
      descriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      fileOffset + offset
    );
    if (written <= 0) throw new Error("Nix archive temporary write made no progress.");
    offset += written;
  }
}

function temporaryNixArchiveError(
  packageId: string,
  operation: "create" | "process" | "cleanup"
): OhriskError {
  return createError({
    code: "TARBALL_PARSE_FAILED",
    category: "filesystem",
    message: "Failed to process the NixOS release archive in bounded temporary storage.",
    details: { packageId, operation }
  });
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function isVerifiedNixGitHubNode(input: {
  name: string;
  version: string;
  resolved?: string;
  integrity?: string;
}): boolean {
  if (!/^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u.test(input.name)) {
    return false;
  }
  if (!/^[0-9a-f]{40}$/u.test(input.version) || !parseSha256Sri(input.integrity)) {
    return false;
  }
  const [, ownerRepo] = input.name.split(":", 2);
  const repo = ownerRepo?.split("/")[1];
  if (repo === "." || repo === "..") return false;
  return input.resolved === `https://codeload.github.com/${ownerRepo}/tar.gz/${input.version}`;
}

export function isVerifiedNixReleaseTarballNode(input: {
  name: string;
  version: string;
  resolved?: string;
  integrity?: string;
}): boolean {
  if (!/^[0-9a-f]{40}$/u.test(input.version) || !parseSha256Sri(input.integrity)) {
    return false;
  }
  if (input.resolved === undefined || input.name !== `tarball:${input.resolved}`) {
    return false;
  }
  return isLockedNixosReleaseArchive(input.resolved, input.version);
}

function bufferTarSource(tar: Buffer): TarSource {
  return {
    byteLength: tar.byteLength,
    read(offset, length) {
      assertTarReadBounds(tar.byteLength, offset, length);
      return tar.subarray(offset, offset + length);
    }
  };
}

function fileTarSource(descriptor: number, byteLength: number): TarSource {
  return {
    byteLength,
    read(offset, length) {
      assertTarReadBounds(byteLength, offset, length);
      const bytes = Buffer.allocUnsafe(length);
      let completed = 0;
      while (completed < length) {
        const count = readSync(
          descriptor,
          bytes,
          completed,
          length - completed,
          offset + completed
        );
        if (count <= 0) throw new Error("Nix TAR temporary file ended unexpectedly.");
        completed += count;
      }
      return bytes;
    }
  };
}

function assertTarReadBounds(byteLength: number, offset: number, length: number): void {
  const end = offset + length;
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || !Number.isSafeInteger(end)
    || offset < 0
    || length < 0
    || end > byteLength
  ) {
    throw new Error("Nix TAR read exceeded the bounded archive source.");
  }
}

function parseGitHubTar(input: { source: TarSource; maxEntries: number }): ParsedTarEntry[] {
  if (input.source.byteLength < 1024 || input.source.byteLength % 512 !== 0) {
    throw new Error("Nix GitHub TAR length or end padding is invalid.");
  }

  const entries: ParsedTarEntry[] = [];
  let offset = 0;
  let headers = 0;
  let pendingPath: string | undefined;
  let pendingLinkPath: string | undefined;
  let pendingSize: number | undefined;
  let pendingLocalHeader = false;
  let rootPrefix: string | undefined;
  let sawEnd = false;
  const observedPaths = new Set<string>();

  while (offset + 512 <= input.source.byteLength) {
    const header = input.source.read(offset, 512);
    if (isZeroBlock(header)) {
      if (!isZeroBlock(input.source.read(offset + 512, 512))) {
        throw new Error("Nix GitHub TAR end marker is incomplete.");
      }
      sawEnd = true;
      break;
    }

    headers += 1;
    if (headers > input.maxEntries) {
      throw new Error(`Nix GitHub archive exceeded the maximum entry count (${input.maxEntries}).`);
    }
    assertTarChecksum(header);

    const typeByte = header[156] ?? 0;
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const headerSize = readTarOctal(header.subarray(124, 136), "size");
    const extension = type === "x" || type === "g" || type === "L" || type === "K";
    const size = extension ? headerSize : (pendingSize ?? headerSize);
    if (size > NIX_GITHUB_ARCHIVE_MAX_BYTES) {
      throw new Error("Nix GitHub archive entry exceeded the supported size.");
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(paddedEnd) || dataEnd > input.source.byteLength || paddedEnd > input.source.byteLength) {
      throw new Error("Nix GitHub TAR entry extends beyond archive data.");
    }

    if (type === "x" || type === "g") {
      if (size > NIX_TAR_EXTENSION_MAX_BYTES) {
        throw new Error("Nix GitHub TAR extension exceeded the supported size.");
      }
      const pax = parsePax(input.source.read(dataStart, size));
      if (type === "x") {
        if (pendingLocalHeader) throw new Error("Nix GitHub PAX header has no target entry.");
        pendingPath = pax.path;
        pendingLinkPath = pax.linkpath;
        pendingSize = pax.size;
        pendingLocalHeader = true;
      }
      offset = paddedEnd;
      continue;
    }
    if (type === "L" || type === "K") {
      if (size > NIX_TAR_EXTENSION_MAX_BYTES) {
        throw new Error("Nix GitHub TAR extension exceeded the supported size.");
      }
      const value = decodeUtf8(stripTrailingNul(input.source.read(dataStart, size)), "GNU TAR extension");
      if (type === "L") pendingPath = value;
      else pendingLinkPath = value;
      pendingLocalHeader = true;
      offset = paddedEnd;
      continue;
    }

    const headerPath = readTarPath(header);
    const rawPath = pendingPath ?? headerPath;
    const rawLinkTarget = pendingLinkPath ?? readTarString(header.subarray(157, 257));
    pendingPath = undefined;
    pendingLinkPath = undefined;
    pendingSize = undefined;
    pendingLocalHeader = false;

    const normalizedRawPath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
    const separator = normalizedRawPath.indexOf("/");
    const candidateRoot = separator === -1 ? normalizedRawPath : normalizedRawPath.slice(0, separator);
    if (!candidateRoot) throw new Error("Nix GitHub archive contains an empty root path.");
    rootPrefix ??= candidateRoot;
    if (candidateRoot !== rootPrefix) {
      throw new Error("Nix GitHub archive contains multiple top-level roots.");
    }
    const path = separator === -1 ? "" : normalizedRawPath.slice(separator + 1);

    if (path !== "") validateTreePath(path);
    if (path !== "" && observedPaths.has(path)) {
      throw new Error("Nix GitHub archive contains a duplicate entry path.");
    }
    if (path !== "") observedPaths.add(path);
    const mode = readTarOctal(header.subarray(100, 108), "mode");
    if (type === "5") {
      if (size !== 0) throw new Error("Nix GitHub TAR directory contains data.");
      if (path !== "") entries.push({ path, type: "directory", dataOffset: dataStart, size: 0, executable: false });
    } else if (type === "0") {
      if (path === "") throw new Error("Nix GitHub archive root must be a directory.");
      entries.push({ path, type: "regular", dataOffset: dataStart, size, executable: (mode & 0o111) !== 0 });
    } else if (type === "2") {
      if (path === "" || size !== 0 || rawLinkTarget === "") {
        throw new Error("Nix GitHub TAR symlink is malformed.");
      }
      entries.push({
        path,
        type: "symlink",
        dataOffset: dataStart,
        size: 0,
        executable: false,
        linkTarget: rawLinkTarget
      });
    } else {
      throw new Error(`Nix GitHub TAR contains unsupported entry type ${type}.`);
    }

    offset = paddedEnd;
  }

  if (
    !sawEnd
    || pendingLocalHeader
    || pendingPath !== undefined
    || pendingLinkPath !== undefined
    || pendingSize !== undefined
  ) {
    throw new Error("Nix GitHub TAR is missing a complete end marker or extension target.");
  }
  if (!rootPrefix || entries.length === 0) {
    throw new Error("Nix GitHub archive contains no source tree entries.");
  }
  return entries;
}

function hashNixArchive(source: TarSource, entries: ParsedTarEntry[]): Buffer {
  const nodesByPath = new Map<string, ParsedTarEntry>(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    let parentPath = parentTreePath(entry.path);
    while (parentPath !== "") {
      const existing = nodesByPath.get(parentPath);
      if (existing && existing.type !== "directory") {
        throw new Error("Nix GitHub archive contains a file-directory path collision.");
      }
      if (!existing) {
        nodesByPath.set(parentPath, {
          path: parentPath,
          type: "directory",
          dataOffset: 0,
          size: 0,
          executable: false
        });
      }
      parentPath = parentTreePath(parentPath);
    }
  }

  const root: ParsedTarEntry = {
    path: "",
    type: "directory",
    dataOffset: 0,
    size: 0,
    executable: false
  };
  nodesByPath.set("", root);
  const childrenByParent = new Map<string, Array<{
    node: ParsedTarEntry;
    nameBytes: Buffer;
  }>>();
  for (const node of nodesByPath.values()) {
    if (node.path === "") continue;
    const parentPath = parentTreePath(node.path);
    const children = childrenByParent.get(parentPath) ?? [];
    const name = treeBaseName(node.path);
    children.push({ node, nameBytes: Buffer.from(name, "utf8") });
    childrenByParent.set(parentPath, children);
  }

  const hash = createHash("sha256");
  const encodedStrings = new Map<string, Buffer>();
  const lengthBytes = Buffer.allocUnsafe(8);
  const paddingBytes = Buffer.alloc(7);
  const writeLength = (length: number): void => {
    lengthBytes.writeBigUInt64LE(BigInt(length));
    hash.update(lengthBytes);
  };
  const writePadding = (length: number): void => {
    const padding = (8 - (length % 8)) % 8;
    if (padding > 0) hash.update(paddingBytes.subarray(0, padding));
  };
  const writeString = (value: string | Buffer): void => {
    let bytes: Buffer;
    if (typeof value === "string") {
      bytes = encodedStrings.get(value) ?? Buffer.from(value, "utf8");
      encodedStrings.set(value, bytes);
    } else {
      bytes = value;
    }
    writeLength(bytes.byteLength);
    hash.update(bytes);
    writePadding(bytes.byteLength);
  };
  const writeFileContents = (node: ParsedTarEntry): void => {
    writeLength(node.size);
    let completed = 0;
    while (completed < node.size) {
      const length = Math.min(NIX_TAR_STREAM_CHUNK_BYTES, node.size - completed);
      hash.update(source.read(node.dataOffset + completed, length));
      completed += length;
    }
    writePadding(node.size);
  };
  const writeNode = (node: ParsedTarEntry): void => {
    writeString("(");
    writeString("type");
    writeString(node.type);
    if (node.type === "regular") {
      if (node.executable) {
        writeString("executable");
        writeString("");
      }
      writeString("contents");
      writeFileContents(node);
    } else if (node.type === "symlink") {
      writeString("target");
      writeString(node.linkTarget!);
    } else {
      const sorted = (childrenByParent.get(node.path) ?? []).sort((left, right) =>
        Buffer.compare(left.nameBytes, right.nameBytes)
      );
      for (const child of sorted) {
        writeString("entry");
        writeString("(");
        writeString("name");
        writeString(child.nameBytes);
        writeString("node");
        writeNode(child.node);
        writeString(")");
      }
    }
    writeString(")");
  };

  writeString("nix-archive-1");
  writeNode(root);
  return hash.digest();
}

function parentTreePath(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator === -1 ? "" : value.slice(0, separator);
}

function treeBaseName(value: string): string {
  const separator = value.lastIndexOf("/");
  return separator === -1 ? value : value.slice(separator + 1);
}

function collectRootEvidenceFiles(source: TarSource, entries: ParsedTarEntry[]): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  for (const entry of entries) {
    if (entry.type !== "regular" || entry.path.includes("/")) continue;
    const kind = classifyEvidenceFile(entry.path);
    if (!kind) continue;
    if (files.length >= NIX_GITHUB_EVIDENCE_FILE_LIMIT) break;
    if (entry.size > NIX_GITHUB_EVIDENCE_FILE_MAX_BYTES) continue;
    files.push({
      path: entry.path,
      kind,
      text: decodeUtf8(source.read(entry.dataOffset, entry.size), entry.path)
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parsePax(data: Buffer): { path?: string; linkpath?: string; size?: number } {
  const result: { path?: string; linkpath?: string; size?: number } = {};
  let offset = 0;
  while (offset < data.byteLength) {
    const space = data.indexOf(0x20, offset);
    if (space <= offset) throw new Error("Nix GitHub PAX record length is malformed.");
    const lengthText = data.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) throw new Error("Nix GitHub PAX record length is malformed.");
    const length = Number(lengthText);
    const end = offset + length;
    if (!Number.isSafeInteger(end) || end > data.byteLength || data[end - 1] !== 0x0a) {
      throw new Error("Nix GitHub PAX record is truncated.");
    }
    const record = decodeUtf8(data.subarray(space + 1, end - 1), "PAX record");
    const equals = record.indexOf("=");
    if (equals <= 0) throw new Error("Nix GitHub PAX record is malformed.");
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (key === "path") result.path = value;
    else if (key === "linkpath") result.linkpath = value;
    else if (key === "size") {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error("Nix GitHub PAX size is malformed.");
      result.size = Number(value);
    }
    offset = end;
  }
  return result;
}

function validateTreePath(value: string): void {
  const bytes = Buffer.byteLength(value, "utf8");
  const segments = value.split("/");
  if (
    value !== value.normalize("NFC")
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("//")
    || bytes > 4096
    || segments.length > 64
    || segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." || Buffer.byteLength(segment, "utf8") > 255
    )
  ) {
    throw new Error("Nix GitHub archive contains an unsafe or unsupported path.");
  }
}

function parseSha256Sri(value: string | undefined): Buffer | undefined {
  if (!value || !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(value)) return undefined;
  const digest = Buffer.from(value.slice("sha256-".length), "base64");
  return digest.byteLength === 32 ? digest : undefined;
}

function readTarPath(header: Buffer): string {
  const name = readTarString(header.subarray(0, 100));
  const prefix = readTarString(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function readTarString(bytes: Buffer): string {
  const nul = bytes.indexOf(0);
  return decodeUtf8(bytes.subarray(0, nul === -1 ? bytes.byteLength : nul), "TAR field");
}

function readTarOctal(bytes: Buffer, field: string): number {
  const value = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]+$/u.test(value)) throw new Error(`Nix GitHub TAR ${field} is malformed.`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Nix GitHub TAR ${field} is invalid.`);
  return parsed;
}

function assertTarChecksum(header: Buffer): void {
  const expected = readTarOctal(header.subarray(148, 156), "checksum");
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  if (actual !== expected) throw new Error("Nix GitHub TAR header checksum does not match.");
}

function stripTrailingNul(data: Buffer): Buffer {
  let end = data.byteLength;
  while (end > 0 && data[end - 1] === 0) end -= 1;
  return data.subarray(0, end);
}

function decodeUtf8(data: Buffer, field: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error(`Nix GitHub ${field} is not valid UTF-8.`);
  }
}

function isZeroBlock(bytes: Buffer): boolean {
  for (const byte of bytes) if (byte !== 0) return false;
  return true;
}

function unavailableEvidence(packageId: string, warning: string): LicenseEvidence {
  return { packageId, files: [], source: "unavailable", warnings: [warning] };
}
