import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const NIX_GITHUB_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
const NIX_GITHUB_ARCHIVE_MAX_ENTRIES = 50_000;
const NIX_GITHUB_EVIDENCE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const NIX_GITHUB_EVIDENCE_FILE_LIMIT = 50;
const NIX_GITHUB_MAX_COMPRESSION_RATIO = 200;
export const NIX_GITHUB_ARCHIVE_HOSTS = new Set(["codeload.github.com"]);

type NixTreeNode =
  | { type: "directory"; entries: Map<string, NixTreeNode> }
  | { type: "regular"; data: Buffer; executable: boolean }
  | { type: "symlink"; target: string };

type ParsedTarEntry = {
  path: string;
  type: "directory" | "regular" | "symlink";
  data: Buffer;
  executable: boolean;
  linkTarget?: string;
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

  try {
    if (
      tar.byteLength >= 1024 * 1024
      && tar.byteLength > compressed.byteLength * NIX_GITHUB_MAX_COMPRESSION_RATIO
    ) {
      throw new Error("Nix GitHub archive exceeded the supported compression ratio.");
    }

    const entries = parseGitHubTar({
      tar,
      maxEntries: input.maxEntries ?? NIX_GITHUB_ARCHIVE_MAX_ENTRIES
    });
    const tree = buildNixTree(entries);
    const actualDigest = hashNixArchive(tree);
    if (!timingSafeEqual(actualDigest, expectedDigest)) {
      return err(createError({
        code: "PACKAGE_INTEGRITY_CHECK_FAILED",
        category: "unsupported_input",
        message: "Nix GitHub source tree did not match the locked narHash.",
        details: {
          packageId: input.packageId,
          reason: "nix_nar_hash_mismatch",
          expected: input.expectedNarHash,
          actual: `sha256-${actualDigest.toString("base64")}`
        }
      }));
    }

    const files = collectRootEvidenceFiles(entries);
    return ok({
      packageId: input.packageId,
      files,
      source: "tarball",
      warnings: files.length === 0
        ? ["No supported root license, notice, attribution, or legal evidence file found in the verified Nix GitHub source tree."]
        : []
    });
  } catch (cause) {
    return err(createError({
      code: "TARBALL_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse or hash the Nix GitHub source archive.",
      details: {
        packageId: input.packageId,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }
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

function parseGitHubTar(input: { tar: Buffer; maxEntries: number }): ParsedTarEntry[] {
  if (input.tar.byteLength < 1024 || input.tar.byteLength % 512 !== 0) {
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

  while (offset + 512 <= input.tar.byteLength) {
    const header = input.tar.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      if (!isZeroBlock(input.tar.subarray(offset + 512, offset + 1024))) {
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
    if (!Number.isSafeInteger(paddedEnd) || dataEnd > input.tar.byteLength || paddedEnd > input.tar.byteLength) {
      throw new Error("Nix GitHub TAR entry extends beyond archive data.");
    }

    const data = input.tar.subarray(dataStart, dataEnd);
    if (type === "x" || type === "g") {
      const pax = parsePax(data);
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
      const value = decodeUtf8(stripTrailingNul(data), "GNU TAR extension");
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
      if (path !== "") entries.push({ path, type: "directory", data: Buffer.alloc(0), executable: false });
    } else if (type === "0") {
      if (path === "") throw new Error("Nix GitHub archive root must be a directory.");
      entries.push({ path, type: "regular", data, executable: (mode & 0o111) !== 0 });
    } else if (type === "2") {
      if (path === "" || size !== 0 || rawLinkTarget === "") {
        throw new Error("Nix GitHub TAR symlink is malformed.");
      }
      entries.push({
        path,
        type: "symlink",
        data: Buffer.alloc(0),
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

function buildNixTree(entries: ParsedTarEntry[]): NixTreeNode {
  const root: NixTreeNode = { type: "directory", entries: new Map() };
  for (const entry of entries) {
    const segments = entry.path.split("/");
    let directory = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const existing = directory.entries.get(segment);
      if (!existing) {
        const child: NixTreeNode = { type: "directory", entries: new Map() };
        directory.entries.set(segment, child);
        directory = child;
      } else if (existing.type === "directory") {
        directory = existing;
      } else {
        throw new Error("Nix GitHub archive contains a file-directory path collision.");
      }
    }

    const name = segments.at(-1)!;
    const node: NixTreeNode = entry.type === "directory"
      ? { type: "directory", entries: new Map() }
      : entry.type === "regular"
        ? { type: "regular", data: entry.data, executable: entry.executable }
        : { type: "symlink", target: entry.linkTarget! };
    const existing = directory.entries.get(name);
    if (existing) {
      if (existing.type === "directory" && node.type === "directory") continue;
      throw new Error("Nix GitHub archive contains a duplicate entry path.");
    }
    directory.entries.set(name, node);
  }
  return root;
}

function hashNixArchive(root: NixTreeNode): Buffer {
  const hash = createHash("sha256");
  const writeString = (value: string | Buffer): void => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(bytes.byteLength));
    hash.update(length);
    hash.update(bytes);
    const padding = (8 - (bytes.byteLength % 8)) % 8;
    if (padding > 0) hash.update(Buffer.alloc(padding));
  };
  const writeNode = (node: NixTreeNode): void => {
    writeString("(");
    writeString("type");
    writeString(node.type);
    if (node.type === "regular") {
      if (node.executable) {
        writeString("executable");
        writeString("");
      }
      writeString("contents");
      writeString(node.data);
    } else if (node.type === "symlink") {
      writeString("target");
      writeString(node.target);
    } else {
      const sorted = [...node.entries].sort(([left], [right]) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
      );
      for (const [name, child] of sorted) {
        writeString("entry");
        writeString("(");
        writeString("name");
        writeString(name);
        writeString("node");
        writeNode(child);
        writeString(")");
      }
    }
    writeString(")");
  };

  writeString("nix-archive-1");
  writeNode(root);
  return hash.digest();
}

function collectRootEvidenceFiles(entries: ParsedTarEntry[]): LicenseEvidenceFile[] {
  const files: LicenseEvidenceFile[] = [];
  for (const entry of entries) {
    if (entry.type !== "regular" || entry.path.includes("/")) continue;
    const kind = classifyEvidenceFile(entry.path);
    if (!kind) continue;
    if (files.length >= NIX_GITHUB_EVIDENCE_FILE_LIMIT) break;
    if (entry.data.byteLength > NIX_GITHUB_EVIDENCE_FILE_MAX_BYTES) continue;
    files.push({
      path: entry.path,
      kind,
      text: decodeUtf8(entry.data, entry.path)
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
