import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

import { createError, type OhriskError, type OhriskErrorCode } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type {
  ArchiveEntry,
  ArchiveFormat,
  ArchiveLimits,
  ArchiveSource,
  ArchiveWorkBudget,
  ReadArchiveBytesInput,
  ReadArchiveFileInput
} from "./types";

export type {
  ArchiveEntry,
  ArchiveFormat,
  ArchiveLimits,
  ArchiveSource,
  ArchiveWorkBudget,
  ReadArchiveBytesInput,
  ReadArchiveFileInput
} from "./types";

const BLOCK_BYTES = 512;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_EOCD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

export const DEFAULT_ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  inputBytes: 256 * 1024 * 1024,
  entries: 50_000,
  pathBytes: 4_096,
  pathSegments: 64,
  segmentBytes: 255,
  entryBytes: 50 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  materializedBytes: 128 * 1024 * 1024,
  compressionRatio: 200,
  compressionRatioMinBytes: 1024 * 1024,
  workDeadlineMs: 30_000
});

type InternalErrorDetails = {
  basename?: unknown;
  entryPath?: unknown;
  format?: unknown;
  limit?: unknown;
  max?: unknown;
  observed?: unknown;
  method?: unknown;
};

class ArchiveFailure extends Error {
  readonly code: OhriskErrorCode;
  readonly category: OhriskError["category"];
  readonly details?: InternalErrorDetails;

  constructor(input: {
    code: OhriskErrorCode;
    category: OhriskError["category"];
    message: string;
    details?: InternalErrorDetails;
  }) {
    super(input.message);
    this.name = "ArchiveFailure";
    this.code = input.code;
    this.category = input.category;
    this.details = input.details;
  }
}

type Budget = {
  limits: ArchiveLimits;
  now: () => number;
  startedAt: number;
  materializedBytes: number;
};

type IndexedEntry = ArchiveEntry & {
  materialize: (startedAt: number) => Buffer;
};

type ZipIndexedEntry = Omit<IndexedEntry, "materialize"> & {
  crc32: number;
  flags: number;
  method: number;
  dataStart: number;
  dataEnd: number;
  localOffset: number;
  recordEnd: number;
};

type ParsedPax = {
  path?: string;
  size?: number;
};

const CRC32_TABLE = buildCrc32Table();

export function readArchiveFile(
  input: ReadArchiveFileInput
): Result<ArchiveSource, OhriskError> {
  const safeName = safeBasename(input.archivePath);

  try {
    const limits = resolveLimits(input.limits);
    const cwd = realpathSync(resolve(input.cwd));
    const filePath = realpathSync(resolve(cwd, input.archivePath));
    const relativePath = relative(cwd, filePath);
    if (relativePath === "" || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      fail("ARCHIVE_READ_FAILED", "invalid_input", "Archive path is outside the working directory.", {
        basename: safeName
      });
    }

    const bytes = readFileBytesWithLimit(filePath, limits.inputBytes, safeName);
    return readOwnedArchiveBuffer({
      displayName: relativePath.split(sep).join("/"),
      bytes,
      limits,
      ...(input.now ? { now: input.now } : {})
    });
  } catch (cause) {
    return err(toOhriskError(cause, "ARCHIVE_READ_FAILED", "filesystem", safeName));
  }
}

export function readArchiveBytes(
  input: ReadArchiveBytesInput
): Result<ArchiveSource, OhriskError> {
  const safeName = safeBasename(input.displayName);

  try {
    const limits = resolveLimits(input.limits);
    enforceLimit("inputBytes", limits.inputBytes, input.bytes.byteLength, safeName);
    return readOwnedArchiveBuffer({
      ...input,
      limits,
      // Public callers retain ownership of their bytes. Snapshot them so later
      // caller mutation cannot change indexed offsets or lazy entry reads.
      bytes: Buffer.from(input.bytes)
    });
  } catch (cause) {
    return err(toOhriskError(cause, "ARCHIVE_MALFORMED", "invalid_input", safeName));
  }
}

type OwnedArchiveBufferInput = Omit<ReadArchiveBytesInput, "bytes"> & {
  bytes: Buffer;
};

function readOwnedArchiveBuffer(
  input: OwnedArchiveBufferInput
): Result<ArchiveSource, OhriskError> {
  const safeName = safeBasename(input.displayName);

  try {
    const limits = resolveLimits(input.limits);
    enforceLimit("inputBytes", limits.inputBytes, input.bytes.byteLength, safeName);

    const budget = createBudget(limits, input.now);
    checkDeadline(budget, safeName);
    const format = detectFormat(input.bytes, input.formatHint, safeName);
    const indexed = format === "zip"
      ? parseZip(input.bytes, budget, safeName)
      : parseTarContainer(input.bytes, format, budget, safeName);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    checkDeadline(budget, safeName);
    const source = createArchiveSource({
      format,
      displayPath: safeDisplayPath(input.displayName),
      sha256,
      indexed,
      budget,
      basename: safeName
    });
    return ok(source);
  } catch (cause) {
    return err(toOhriskError(cause, "ARCHIVE_MALFORMED", "invalid_input", safeName));
  }
}

function createArchiveSource(input: {
  format: ArchiveFormat;
  displayPath: string;
  sha256: string;
  indexed: IndexedEntry[];
  budget: Budget;
  basename: string;
}): ArchiveSource {
  const sorted = [...input.indexed].sort((left, right) => comparePaths(left.path, right.path));
  const publicEntries = Object.freeze(
    sorted.map(({ path, type, size, compressedSize }) =>
      Object.freeze({ path, type, size, compressedSize })
    )
  );
  const byPath = new Map(sorted.map((entry) => [entry.path, entry]));
  const paths = Object.freeze(publicEntries.map((entry) => entry.path));

  const beginWork = (): ArchiveWorkBudget => {
    const startedAt = input.budget.now();
    return Object.freeze({
      checkpoint: (entryPath?: string): Result<void, OhriskError> => {
        try {
          checkDeadlineSince(input.budget, startedAt, input.basename, entryPath);
          return ok(undefined);
        } catch (cause) {
          return err(toOhriskError(
            cause,
            "ARCHIVE_LIMIT_EXCEEDED",
            "unsupported_input",
            input.basename
          ));
        }
      }
    });
  };

  const readEntry = (entryPath: string): Result<Buffer, OhriskError> => {
    try {
      const startedAt = input.budget.now();
      checkDeadlineSince(input.budget, startedAt, input.basename);
      const normalized = validateEntryPath(entryPath, input.budget.limits, false, input.basename);
      const entry = byPath.get(normalized);
      if (!entry || entry.type !== "file") {
        fail("ARCHIVE_READ_FAILED", "invalid_input", "Archive file entry was not found.", {
          basename: input.basename,
          entryPath: normalized
        });
      }
      chargeMaterialization(input.budget, entry.size, input.basename, entry.path);
      const data = entry.materialize(startedAt);
      checkDeadlineSince(input.budget, startedAt, input.basename, entry.path);
      return ok(data);
    } catch (cause) {
      return err(toOhriskError(cause, "ARCHIVE_READ_FAILED", "invalid_input", input.basename));
    }
  };

  return Object.freeze({
    format: input.format,
    displayPath: input.displayPath,
    sha256: input.sha256,
    entries: publicEntries,
    listPaths: () => paths,
    beginWork,
    readEntry,
    readText: (entryPath: string, maxBytes?: number): Result<string, OhriskError> => {
      if (maxBytes !== undefined) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
          return err(createError({
            code: "ARCHIVE_LIMIT_EXCEEDED",
            category: "invalid_input",
            message: "Archive text read limit is invalid.",
            details: {
              basename: input.basename,
              entryPath: safeEntryPathForError(entryPath),
              limit: "readTextBytes",
              max: maxBytes,
              observed: maxBytes
            }
          }));
        }
        const candidate = byPath.get(entryPath);
        if (candidate && candidate.type === "file" && candidate.size > maxBytes) {
          return err(createError({
            code: "ARCHIVE_LIMIT_EXCEEDED",
            category: "unsupported_input",
            message: "Archive text entry exceeds the caller limit.",
            details: {
              basename: input.basename,
              entryPath: candidate.path,
              limit: "readTextBytes",
              max: maxBytes,
              observed: candidate.size
            }
          }));
        }
      }
      const data = readEntry(entryPath);
      if (!data.ok) {
        return data;
      }
      try {
        return ok(decodeUtf8(data.value, entryPath, input.basename));
      } catch (cause) {
        return err(toOhriskError(cause, "ARCHIVE_INTEGRITY_FAILED", "invalid_input", input.basename));
      }
    }
  });
}

function parseZip(bytes: Buffer, budget: Budget, archiveName: string): IndexedEntry[] {
  const eocd = findZipEocd(bytes, archiveName);
  const diskNumber = readU16(bytes, eocd + 4, archiveName);
  const centralDisk = readU16(bytes, eocd + 6, archiveName);
  const entriesOnDisk = readU16(bytes, eocd + 8, archiveName);
  const totalEntries = readU16(bytes, eocd + 10, archiveName);
  const centralSize = readU32(bytes, eocd + 12, archiveName);
  const centralOffset = readU32(bytes, eocd + 16, archiveName);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Multi-disk ZIP archives are not supported.", {
      basename: archiveName,
      format: "zip"
    });
  }
  if (
    entriesOnDisk === ZIP64_UINT16
    || totalEntries === ZIP64_UINT16
    || centralSize === ZIP64_UINT32
    || centralOffset === ZIP64_UINT32
    || hasSignatureAt(bytes, eocd - 20, ZIP64_LOCATOR_SIGNATURE)
    || hasSignatureAt(bytes, eocd - 56, ZIP64_EOCD_SIGNATURE)
  ) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "ZIP64 archives are not supported.", {
      basename: archiveName,
      format: "zip"
    });
  }
  enforceLimit("entries", budget.limits.entries, totalEntries, archiveName);

  const centralEnd = safeAdd(centralOffset, centralSize, archiveName);
  if (centralEnd !== eocd || centralEnd > bytes.length) {
    malformed(archiveName, "ZIP central directory bounds are invalid.", "zip");
  }

  const entries: ZipIndexedEntry[] = [];
  const registry = new EntryRegistry(archiveName);
  let expanded = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    checkDeadline(budget, archiveName);
    if (readU32(bytes, offset, archiveName) !== ZIP_CENTRAL_SIGNATURE) {
      malformed(archiveName, "ZIP central directory entry has an invalid signature.", "zip");
    }
    requireRange(bytes, offset, 46, archiveName);
    const flags = readU16(bytes, offset + 8, archiveName);
    const method = readU16(bytes, offset + 10, archiveName);
    const crc = readU32(bytes, offset + 16, archiveName);
    const compressedSize = readU32(bytes, offset + 20, archiveName);
    const size = readU32(bytes, offset + 24, archiveName);
    const nameLength = readU16(bytes, offset + 28, archiveName);
    const extraLength = readU16(bytes, offset + 30, archiveName);
    const commentLength = readU16(bytes, offset + 32, archiveName);
    const diskStart = readU16(bytes, offset + 34, archiveName);
    const externalAttributes = readU32(bytes, offset + 38, archiveName);
    const localOffset = readU32(bytes, offset + 42, archiveName);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(bytes, offset, recordLength, archiveName);
    if (offset + recordLength > centralEnd) {
      malformed(archiveName, "ZIP central directory entry metadata is truncated.", "zip");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0) {
      fail("ARCHIVE_ENCRYPTED", "unsupported_input", "Encrypted ZIP entries are not supported.", {
        basename: archiveName,
        format: "zip"
      });
    }
    if ((flags & ~0x080e) !== 0) {
      fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "ZIP entry flags are not supported.", {
        basename: archiveName,
        format: "zip"
      });
    }
    if (diskStart !== 0) {
      fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Multi-disk ZIP entries are not supported.", {
        basename: archiveName,
        format: "zip"
      });
    }
    if (compressedSize === ZIP64_UINT32 || size === ZIP64_UINT32 || localOffset === ZIP64_UINT32) {
      fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "ZIP64 entries are not supported.", {
        basename: archiveName,
        format: "zip"
      });
    }
    if (method !== 0 && method !== 8) {
      fail("ARCHIVE_COMPRESSION_UNSUPPORTED", "unsupported_input", "ZIP compression method is not supported.", {
        basename: archiveName,
        format: "zip",
        method
      });
    }

    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const decodedName = decodeUtf8(rawName, undefined, archiveName);
    const directoryByName = decodedName.endsWith("/");
    const entryPath = validateEntryPath(decodedName, budget.limits, directoryByName, archiveName);
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & 0xf000;
    const directoryByDos = (externalAttributes & 0x10) !== 0;
    if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000) {
      unsupportedType(archiveName, entryPath, "zip");
    }
    const zeroLengthDirectoryWithRegularUnixMode = (directoryByName || directoryByDos)
      && unixType === 0x8000
      && size === 0;
    if (
      (directoryByName || directoryByDos)
      && unixType === 0x8000
      && !zeroLengthDirectoryWithRegularUnixMode
    ) {
      malformed(archiveName, "ZIP entry type metadata is inconsistent.", "zip", entryPath);
    }
    const type = directoryByName || directoryByDos || unixType === 0x4000 ? "directory" : "file";
    const emptyDirectoryEncoding = size === 0
      && (
        compressedSize === 0
        || (method === 8 && compressedSize === 2 && crc === 0)
      );
    if ((type === "directory" && !emptyDirectoryEncoding) || (type === "file" && directoryByName)) {
      malformed(archiveName, "ZIP entry type metadata is inconsistent.", "zip", entryPath);
    }
    enforceEntryLimits({ size, compressedSize, budget, archiveName, entryPath });
    expanded = safeAdd(expanded, size, archiveName);
    enforceLimit("expandedBytes", budget.limits.expandedBytes, expanded, archiveName, entryPath);

    const local = parseZipLocalHeader({
      bytes,
      localOffset,
      centralOffset,
      centralName: rawName,
      flags,
      method,
      crc,
      compressedSize,
      size,
      archiveName,
      entryPath
    });
    registry.add(entryPath, type);
    entries.push({
      path: entryPath,
      type,
      size,
      compressedSize,
      crc32: crc,
      flags,
      method,
      dataStart: local.dataStart,
      dataEnd: local.dataEnd,
      localOffset,
      recordEnd: local.recordEnd
    });
    offset += recordLength;
  }
  if (offset !== centralEnd) {
    malformed(archiveName, "ZIP central directory entry count does not match its size.", "zip");
  }
  validateZipLocalRecordLayout(entries, centralOffset, archiveName);

  return entries.map((entry): IndexedEntry => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    compressedSize: entry.compressedSize,
    materialize: (startedAt) => materializeZipEntry(bytes, entry, archiveName, budget, startedAt)
  }));
}

function parseZipLocalHeader(input: {
  bytes: Buffer;
  localOffset: number;
  centralOffset: number;
  centralName: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  archiveName: string;
  entryPath: string;
}): { dataStart: number; dataEnd: number; recordEnd: number } {
  requireRange(input.bytes, input.localOffset, 30, input.archiveName, input.entryPath);
  if (readU32(input.bytes, input.localOffset, input.archiveName) !== ZIP_LOCAL_SIGNATURE) {
    integrity(input.archiveName, input.entryPath, "ZIP local header signature does not match.", "zip");
  }
  const localFlags = readU16(input.bytes, input.localOffset + 6, input.archiveName);
  const localMethod = readU16(input.bytes, input.localOffset + 8, input.archiveName);
  const localCrc = readU32(input.bytes, input.localOffset + 14, input.archiveName);
  const localCompressedSize = readU32(input.bytes, input.localOffset + 18, input.archiveName);
  const localSize = readU32(input.bytes, input.localOffset + 22, input.archiveName);
  const nameLength = readU16(input.bytes, input.localOffset + 26, input.archiveName);
  const extraLength = readU16(input.bytes, input.localOffset + 28, input.archiveName);
  requireRange(input.bytes, input.localOffset + 30, nameLength + extraLength, input.archiveName, input.entryPath);
  const localName = input.bytes.subarray(input.localOffset + 30, input.localOffset + 30 + nameLength);
  if (!localName.equals(input.centralName) || localFlags !== input.flags || localMethod !== input.method) {
    integrity(input.archiveName, input.entryPath, "ZIP central and local headers do not match.", "zip");
  }
  const usesDescriptor = (input.flags & 0x0008) !== 0;
  if (
    (!usesDescriptor && (localCrc !== input.crc || localCompressedSize !== input.compressedSize || localSize !== input.size))
    || (usesDescriptor
      && !((localCrc === 0 || localCrc === input.crc)
        && (localCompressedSize === 0 || localCompressedSize === input.compressedSize)
        && (localSize === 0 || localSize === input.size)))
  ) {
    integrity(input.archiveName, input.entryPath, "ZIP central and local size or CRC metadata do not match.", "zip");
  }
  const dataStart = safeAdd(input.localOffset + 30, nameLength + extraLength, input.archiveName);
  const dataEnd = safeAdd(dataStart, input.compressedSize, input.archiveName);
  if (dataEnd > input.centralOffset || dataEnd > input.bytes.length) {
    malformed(input.archiveName, "ZIP entry data extends beyond its data area.", "zip", input.entryPath);
  }
  const recordEnd = usesDescriptor
    ? parseZipDataDescriptor({
        bytes: input.bytes,
        offset: dataEnd,
        centralOffset: input.centralOffset,
        crc: input.crc,
        compressedSize: input.compressedSize,
        size: input.size,
        archiveName: input.archiveName,
        entryPath: input.entryPath
      })
    : dataEnd;
  return { dataStart, dataEnd, recordEnd };
}

function parseZipDataDescriptor(input: {
  bytes: Buffer;
  offset: number;
  centralOffset: number;
  crc: number;
  compressedSize: number;
  size: number;
  archiveName: string;
  entryPath: string;
}): number {
  requireRange(input.bytes, input.offset, 16, input.archiveName, input.entryPath);
  if (input.offset + 16 > input.centralOffset) {
    malformed(input.archiveName, "ZIP data descriptor extends beyond its data area.", "zip", input.entryPath);
  }
  if (readU32(input.bytes, input.offset, input.archiveName) !== ZIP_DATA_DESCRIPTOR_SIGNATURE) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Unsigned ZIP data descriptors are not supported.", {
      basename: input.archiveName,
      entryPath: input.entryPath,
      format: "zip"
    });
  }
  const crc = readU32(input.bytes, input.offset + 4, input.archiveName);
  const compressedSize = readU32(input.bytes, input.offset + 8, input.archiveName);
  const size = readU32(input.bytes, input.offset + 12, input.archiveName);
  if (crc !== input.crc || compressedSize !== input.compressedSize || size !== input.size) {
    integrity(input.archiveName, input.entryPath, "ZIP data descriptor does not match central metadata.", "zip");
  }
  return input.offset + 16;
}

function validateZipLocalRecordLayout(
  entries: ZipIndexedEntry[],
  centralOffset: number,
  archiveName: string
): void {
  const sorted = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    if (!entry) {
      continue;
    }
    const nextOffset = sorted[index + 1]?.localOffset ?? centralOffset;
    if (entry.recordEnd > nextOffset) {
      malformed(archiveName, "ZIP local records overlap.", "zip", entry.path);
    }
  }
}

function materializeZipEntry(
  bytes: Buffer,
  entry: ZipIndexedEntry,
  archiveName: string,
  budget: Budget,
  startedAt: number
): Buffer {
  try {
    const compressed = bytes.subarray(entry.dataStart, entry.dataEnd);
    const output = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
    if (output.length !== entry.size) {
      integrity(archiveName, entry.path, "ZIP entry expanded size does not match metadata.", "zip");
    }
    if (crc32(output, budget, startedAt, archiveName, entry.path) !== entry.crc32) {
      integrity(archiveName, entry.path, "ZIP entry CRC32 does not match metadata.", "zip");
    }
    return output;
  } catch (cause) {
    if (cause instanceof ArchiveFailure) {
      throw cause;
    }
    integrity(archiveName, entry.path, "ZIP entry decompression failed.", "zip");
  }
}

function parseTarContainer(
  inputBytes: Buffer,
  format: "tar" | "tar.gz",
  budget: Budget,
  archiveName: string
): IndexedEntry[] {
  let tar = inputBytes;
  if (format === "tar.gz") {
    const outputLimit = Math.min(budget.limits.expandedBytes, budget.limits.materializedBytes);
    const outputLimitName = budget.limits.materializedBytes <= budget.limits.expandedBytes
      ? "materializedBytes"
      : "expandedBytes";
    const observedLimit = Math.min(Number.MAX_SAFE_INTEGER, outputLimit + 1);
    try {
      tar = gunzipSync(inputBytes, { maxOutputLength: observedLimit });
    } catch (cause) {
      if (cause instanceof ArchiveFailure) {
        throw cause;
      }
      if (isZlibOutputLimitError(cause)) {
        limitFailure(outputLimitName, outputLimit, observedLimit, archiveName);
      }
      malformed(archiveName, "Gzip-compressed TAR data is malformed or exceeds its expansion limit.", format);
    }
    enforceLimit(outputLimitName, outputLimit, tar.length, archiveName);
    enforceLimit("expandedBytes", budget.limits.expandedBytes, tar.length, archiveName);
    enforceRatio(tar.length, inputBytes.length, budget.limits, archiveName);
    // The expanded TAR remains reachable through every lazy entry closure, so
    // reserve its retained bytes before allowing entry copies to materialize.
    chargeMaterialization(budget, tar.length, archiveName);
  }
  checkDeadline(budget, archiveName);
  return parseTar(tar, format, budget, archiveName);
}

function parseTar(
  tar: Buffer,
  format: "tar" | "tar.gz",
  budget: Budget,
  archiveName: string
): IndexedEntry[] {
  if (tar.length < BLOCK_BYTES * 2 || tar.length % BLOCK_BYTES !== 0) {
    malformed(archiveName, "TAR length or end padding is invalid.", format);
  }

  const entries: IndexedEntry[] = [];
  const registry = new EntryRegistry(archiveName);
  let offset = 0;
  let headerCount = 0;
  let expanded = 0;
  let pendingPax: ParsedPax | undefined;
  let pendingLongName: string | undefined;
  let sawEnd = false;

  while (offset + BLOCK_BYTES <= tar.length) {
    checkDeadline(budget, archiveName);
    const header = tar.subarray(offset, offset + BLOCK_BYTES);
    if (isZeroBlock(header)) {
      requireRange(tar, offset, BLOCK_BYTES * 2, archiveName);
      if (!isZeroBlock(tar.subarray(offset + BLOCK_BYTES, offset + BLOCK_BYTES * 2))) {
        malformed(archiveName, "TAR end marker must contain two zero blocks.", format);
      }
      if (!isZeroBlock(tar.subarray(offset + BLOCK_BYTES * 2))) {
        malformed(archiveName, "TAR trailing padding contains non-zero bytes.", format);
      }
      sawEnd = true;
      break;
    }

    headerCount += 1;
    enforceLimit("entries", budget.limits.entries, headerCount, archiveName);
    validateTarHeader(header, archiveName, format);
    const typeByte = header[156] ?? 0;
    const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
    const headerSize = parseTarNumber(header.subarray(124, 136), archiveName, format, "size");
    const extension = type === "x" || type === "g" || type === "L";
    const effectiveSize = extension ? headerSize : (pendingPax?.size ?? headerSize);
    enforceLimit("entryBytes", budget.limits.entryBytes, effectiveSize, archiveName);
    const dataStart = offset + BLOCK_BYTES;
    const dataEnd = safeAdd(dataStart, effectiveSize, archiveName);
    const paddedEnd = safeAdd(dataStart, roundToTarBlock(effectiveSize), archiveName);
    if (dataEnd > tar.length || paddedEnd > tar.length) {
      malformed(archiveName, "TAR entry extends beyond archive data.", format);
    }
    if (!isZeroBlock(tar.subarray(dataEnd, paddedEnd))) {
      malformed(archiveName, "TAR entry padding contains non-zero bytes.", format);
    }

    const headerPath = readTarHeaderPath(header, archiveName, format);
    if (type === "x" || type === "g") {
      const pax = parsePax(
        tar.subarray(dataStart, dataEnd),
        archiveName,
        format,
        type === "g",
        budget
      );
      if (type === "x") {
        if (pendingPax !== undefined) {
          malformed(archiveName, "PAX extended headers cannot replace an unconsumed header.", format);
        }
        pendingPax = pax;
      }
      offset = paddedEnd;
      continue;
    }
    if (type === "L") {
      if (pendingLongName !== undefined) {
        malformed(archiveName, "GNU TAR longname headers cannot replace an unconsumed header.", format);
      }
      pendingLongName = parseGnuLongName(tar.subarray(dataStart, dataEnd), archiveName, format);
      offset = paddedEnd;
      continue;
    }

    if (pendingPax?.path !== undefined && pendingLongName !== undefined) {
      malformed(archiveName, "TAR path extension headers are ambiguous.", format);
    }
    const rawPath = pendingPax?.path ?? pendingLongName ?? headerPath;
    pendingPax = undefined;
    pendingLongName = undefined;
    const directory = type === "5";
    const regular = type === "0" || type === "\0";
    if (!directory && !regular) {
      unsupportedType(archiveName, safeEntryPathForError(rawPath), format);
    }
    const entryPath = validateEntryPath(rawPath, budget.limits, directory || rawPath.endsWith("/"), archiveName);
    if (directory && effectiveSize !== 0) {
      malformed(archiveName, "TAR directory entry has non-zero data size.", format, entryPath);
    }
    enforceLimit("entryBytes", budget.limits.entryBytes, effectiveSize, archiveName, entryPath);
    expanded = safeAdd(expanded, effectiveSize, archiveName);
    enforceLimit("expandedBytes", budget.limits.expandedBytes, expanded, archiveName, entryPath);
    registry.add(entryPath, directory ? "directory" : "file");
    const capturedStart = dataStart;
    const capturedEnd = dataEnd;
    entries.push({
      path: entryPath,
      type: directory ? "directory" : "file",
      size: effectiveSize,
      compressedSize: format === "tar" ? effectiveSize : 0,
      materialize: () => Buffer.from(tar.subarray(capturedStart, capturedEnd))
    });
    offset = paddedEnd;
  }

  if (!sawEnd || pendingPax || pendingLongName) {
    malformed(archiveName, "TAR archive is missing a complete end marker or extension target.", format);
  }
  return entries;
}

function validateTarHeader(
  header: Buffer,
  archiveName: string,
  format: "tar" | "tar.gz"
): void {
  const expected = parseTarNumber(header.subarray(148, 156), archiveName, format, "checksum");
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < header.length; index += 1) {
    const byte = index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  if (expected !== unsigned && expected !== signed) {
    integrity(archiveName, undefined, "TAR header checksum does not match.", format);
  }
  const magic = header.subarray(257, 263);
  const version = header.subarray(263, 265);
  const v7 = isZeroBlock(magic) && isZeroBlock(version);
  const ustar = magic.equals(Buffer.from("ustar\0", "ascii")) && version.equals(Buffer.from("00", "ascii"));
  const gnu = magic.equals(Buffer.from("ustar ", "ascii"));
  if (!v7 && !ustar && !gnu) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "TAR dialect is not supported.", {
      basename: archiveName,
      format
    });
  }
}

function readTarHeaderPath(
  header: Buffer,
  archiveName: string,
  format: "tar" | "tar.gz"
): string {
  const name = decodeTarField(header.subarray(0, 100), archiveName, format);
  const prefix = decodeTarField(header.subarray(345, 500), archiveName, format);
  return prefix === "" ? name : `${prefix}/${name}`;
}

function decodeTarField(bytes: Buffer, archiveName: string, format: ArchiveFormat): string {
  const nul = bytes.indexOf(0);
  const content = bytes.subarray(0, nul === -1 ? bytes.length : nul);
  if (nul !== -1 && !isZeroBlock(bytes.subarray(nul))) {
    malformed(archiveName, "TAR string field contains data after NUL.", format);
  }
  return decodeUtf8(content, undefined, archiveName);
}

function parseGnuLongName(bytes: Buffer, archiveName: string, format: ArchiveFormat): string {
  const nul = bytes.indexOf(0);
  const content = bytes.subarray(0, nul === -1 ? bytes.length : nul);
  if (content.length === 0 || (nul !== -1 && !isZeroBlock(bytes.subarray(nul)))) {
    malformed(archiveName, "GNU TAR longname record is malformed.", format);
  }
  return decodeUtf8(content, undefined, archiveName);
}

function parsePax(
  bytes: Buffer,
  archiveName: string,
  format: ArchiveFormat,
  global: boolean,
  budget: Budget
): ParsedPax {
  let offset = 0;
  const values = new Map<string, string>();
  while (offset < bytes.length) {
    checkDeadline(budget, archiveName);
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) {
      malformed(archiveName, "PAX record length is malformed.", format);
    }
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(lengthText)) {
      malformed(archiveName, "PAX record length is malformed.", format);
    }
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length <= space - offset + 2 || offset + length > bytes.length) {
      malformed(archiveName, "PAX record extends beyond metadata data.", format);
    }
    const record = bytes.subarray(space + 1, offset + length);
    if (record[record.length - 1] !== 0x0a) {
      malformed(archiveName, "PAX record is missing its newline terminator.", format);
    }
    const body = record.subarray(0, -1);
    const equals = body.indexOf(0x3d);
    if (equals <= 0) {
      malformed(archiveName, "PAX record key/value is malformed.", format);
    }
    const key = body.subarray(0, equals).toString("ascii");
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || values.has(key)) {
      malformed(archiveName, "PAX record key is invalid or duplicated.", format);
    }
    if (
      key === "linkpath"
      || key.startsWith("GNU.sparse")
      || key.startsWith("SCHILY.dev")
      || key === "SCHILY.filetype"
      || key === "SCHILY.realsize"
    ) {
      unsupportedType(archiveName, undefined, format);
    }
    values.set(key, decodeUtf8(body.subarray(equals + 1), undefined, archiveName));
    offset += length;
  }

  const pathValue = values.get("path");
  const sizeValue = values.get("size");
  if (global && (pathValue !== undefined || sizeValue !== undefined)) {
    malformed(archiveName, "Global PAX path or size metadata is not safe to apply.", format);
  }
  let size: number | undefined;
  if (sizeValue !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(sizeValue)) {
      malformed(archiveName, "PAX size metadata is invalid.", format);
    }
    size = Number(sizeValue);
    if (!Number.isSafeInteger(size)) {
      malformed(archiveName, "PAX size metadata exceeds the safe integer range.", format);
    }
  }
  return {
    ...(pathValue !== undefined ? { path: pathValue } : {}),
    ...(size !== undefined ? { size } : {})
  };
}

class EntryRegistry {
  private readonly entries = new Map<string, "file" | "directory">();
  private readonly foldedEntries = new Map<string, "file" | "directory">();
  private readonly parentPrefixes = new Set<string>();
  private readonly foldedParentPrefixes = new Set<string>();
  private readonly archiveName: string;

  constructor(archiveName: string) {
    this.archiveName = archiveName;
  }

  add(entryPath: string, type: "file" | "directory"): void {
    const foldedPath = foldEntryPath(entryPath);
    if (this.entries.has(entryPath) || this.foldedEntries.has(foldedPath)) {
      duplicate(this.archiveName, entryPath);
    }
    const segments = entryPath.split("/");
    const foldedSegments = foldedPath.split("/");
    const prefixes: string[] = [];
    const foldedPrefixes: string[] = [];
    let prefix = "";
    let foldedPrefix = "";
    for (let index = 1; index < segments.length; index += 1) {
      prefix = prefix === "" ? segments[index - 1] ?? "" : `${prefix}/${segments[index - 1]}`;
      foldedPrefix = foldedPrefix === ""
        ? foldedSegments[index - 1] ?? ""
        : `${foldedPrefix}/${foldedSegments[index - 1]}`;
      if (this.entries.get(prefix) === "file" || this.foldedEntries.get(foldedPrefix) === "file") {
        duplicate(this.archiveName, entryPath);
      }
      prefixes.push(prefix);
      foldedPrefixes.push(foldedPrefix);
    }
    if (
      type === "file"
      && (this.parentPrefixes.has(entryPath) || this.foldedParentPrefixes.has(foldedPath))
    ) {
      duplicate(this.archiveName, entryPath);
    }
    this.entries.set(entryPath, type);
    this.foldedEntries.set(foldedPath, type);
    for (const value of prefixes) {
      this.parentPrefixes.add(value);
    }
    for (const value of foldedPrefixes) {
      this.foldedParentPrefixes.add(value);
    }
  }
}

function validateEntryPath(
  rawPath: string,
  limits: ArchiveLimits,
  allowDirectorySlash: boolean,
  archiveName: string
): string {
  const path = allowDirectorySlash && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const invalidRoot = path === ""
    || rawPath.includes("\\")
    || rawPath.startsWith("/")
    || rawPath.startsWith("//")
    || /^[A-Za-z]:/u.test(rawPath)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(rawPath)
    || rawPath !== rawPath.normalize("NFC");
  if (invalidRoot || (!allowDirectorySlash && rawPath.endsWith("/"))) {
    invalidPath(archiveName, safeEntryPathForError(rawPath));
  }
  const segments = path.split("/");
  const encodedPathBytes = Buffer.byteLength(path, "utf8");
  if (encodedPathBytes > limits.pathBytes) {
    limitFailure("pathBytes", limits.pathBytes, encodedPathBytes, archiveName, safeEntryPathForError(path));
  }
  if (segments.length > limits.pathSegments) {
    limitFailure("pathSegments", limits.pathSegments, segments.length, archiveName, safeEntryPathForError(path));
  }
  for (const segment of segments) {
    const base = segment.split(".", 1)[0]?.toUpperCase() ?? "";
    if (
      segment === ""
      || segment === "."
      || segment === ".."
      || segment.includes(":")
      || /[. ]$/u.test(segment)
      || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)
    ) {
      invalidPath(archiveName, safeEntryPathForError(path));
    }
    const segmentBytes = Buffer.byteLength(segment, "utf8");
    if (segmentBytes > limits.segmentBytes) {
      limitFailure("segmentBytes", limits.segmentBytes, segmentBytes, archiveName, safeEntryPathForError(path));
    }
  }
  return path;
}

function resolveLimits(overrides: Partial<ArchiveLimits> | undefined): ArchiveLimits {
  const resolved = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail("ARCHIVE_LIMIT_EXCEEDED", "invalid_input", "Archive limit configuration is invalid.", {
        limit: name,
        max: value,
        observed: value
      });
    }
  }
  return resolved;
}

function readFileBytesWithLimit(filePath: string, maxBytes: number, archiveName: string): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "r");
    const initial = fstatSync(descriptor, { bigint: true });
    if (!initial.isFile()) {
      fail("ARCHIVE_READ_FAILED", "filesystem", "Archive path is not a regular file.", {
        basename: archiveName
      });
    }
    if (initial.size > BigInt(maxBytes)) {
      limitFailure("inputBytes", maxBytes, maxBytes + 1, archiveName);
    }

    const expectedBytes = Number(initial.size);
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const bytesRead = readSync(descriptor, bytes, offset, expectedBytes - offset, offset);
      if (bytesRead === 0) {
        archiveFileChanged(archiveName);
      }
      offset += bytesRead;
    }

    const growthProbe = Buffer.allocUnsafe(1);
    const additionalBytes = readSync(descriptor, growthProbe, 0, 1, expectedBytes);
    const final = fstatSync(descriptor, { bigint: true });
    const currentPath = statSync(filePath, { bigint: true });
    if (final.size > BigInt(maxBytes) || currentPath.size > BigInt(maxBytes)) {
      limitFailure("inputBytes", maxBytes, maxBytes + 1, archiveName);
    }
    if (
      additionalBytes !== 0
      || initial.dev !== final.dev
      || initial.ino !== final.ino
      || initial.size !== final.size
      || initial.mtimeNs !== final.mtimeNs
      || initial.ctimeNs !== final.ctimeNs
      || final.dev !== currentPath.dev
      || final.ino !== currentPath.ino
      || final.size !== currentPath.size
      || final.mtimeNs !== currentPath.mtimeNs
      || final.ctimeNs !== currentPath.ctimeNs
      || final.birthtimeNs !== currentPath.birthtimeNs
    ) {
      archiveFileChanged(archiveName);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the primary read or limit result.
      }
    }
  }
}

function archiveFileChanged(archiveName: string): never {
  fail("ARCHIVE_READ_FAILED", "filesystem", "Archive file changed while it was being read.", {
    basename: archiveName
  });
}

function createBudget(limits: ArchiveLimits, now: (() => number) | undefined): Budget {
  const clock = now ?? Date.now;
  return {
    limits,
    now: clock,
    startedAt: clock(),
    materializedBytes: 0
  };
}

function checkDeadline(budget: Budget, archiveName: string, entryPath?: string): void {
  checkDeadlineSince(budget, budget.startedAt, archiveName, entryPath);
}

function checkDeadlineSince(
  budget: Budget,
  startedAt: number,
  archiveName: string,
  entryPath?: string
): void {
  const observed = Math.max(0, budget.now() - startedAt);
  if (observed > budget.limits.workDeadlineMs) {
    limitFailure("workDeadlineMs", budget.limits.workDeadlineMs, observed, archiveName, entryPath);
  }
}

function chargeMaterialization(
  budget: Budget,
  amount: number,
  archiveName: string,
  entryPath?: string
): void {
  const observed = safeAdd(budget.materializedBytes, amount, archiveName);
  enforceLimit("materializedBytes", budget.limits.materializedBytes, observed, archiveName, entryPath);
  budget.materializedBytes = observed;
}

function enforceEntryLimits(input: {
  size: number;
  compressedSize: number;
  budget: Budget;
  archiveName: string;
  entryPath: string;
}): void {
  enforceLimit("entryBytes", input.budget.limits.entryBytes, input.size, input.archiveName, input.entryPath);
  if (input.size >= input.budget.limits.compressionRatioMinBytes) {
    const ratio = input.size / Math.max(1, input.compressedSize);
    if (ratio > input.budget.limits.compressionRatio) {
      limitFailure(
        "compressionRatio",
        input.budget.limits.compressionRatio,
        ratio,
        input.archiveName,
        input.entryPath
      );
    }
  }
}

function enforceRatio(size: number, compressed: number, limits: ArchiveLimits, archiveName: string): void {
  if (size >= limits.compressionRatioMinBytes) {
    const ratio = size / Math.max(1, compressed);
    if (ratio > limits.compressionRatio) {
      limitFailure("compressionRatio", limits.compressionRatio, ratio, archiveName);
    }
  }
}

function enforceLimit(
  limit: string,
  max: number,
  observed: number,
  archiveName: string,
  entryPath?: string
): void {
  if (observed > max) {
    limitFailure(limit, max, observed, archiveName, entryPath);
  }
}

function limitFailure(
  limit: string,
  max: number,
  observed: number,
  archiveName: string,
  entryPath?: string
): never {
  fail("ARCHIVE_LIMIT_EXCEEDED", "unsupported_input", "Archive resource limit was exceeded.", {
    basename: archiveName,
    ...(entryPath !== undefined ? { entryPath } : {}),
    limit,
    max,
    observed
  });
}

function detectFormat(bytes: Buffer, hint: ArchiveFormat | undefined, archiveName: string): ArchiveFormat {
  const detected = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
    ? "tar.gz"
    : bytes.length >= 4 && (
      bytes.readUInt32LE(0) === ZIP_LOCAL_SIGNATURE
      || bytes.readUInt32LE(0) === ZIP_EOCD_SIGNATURE
    )
      ? "zip"
      : looksLikeTar(bytes)
        ? "tar"
        : undefined;
  if (hint !== undefined) {
    if (detected !== undefined && detected !== hint) {
      fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Archive format hint does not match its bytes.", {
        basename: archiveName,
        format: hint
      });
    }
    return hint;
  }
  if (detected === undefined) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Archive format is not supported.", {
      basename: archiveName
    });
  }
  return detected;
}

function looksLikeTar(bytes: Buffer): boolean {
  if (bytes.length < BLOCK_BYTES * 2 || bytes.length % BLOCK_BYTES !== 0) {
    return false;
  }
  if (isZeroBlock(bytes.subarray(0, BLOCK_BYTES))) {
    return true;
  }
  const magic = bytes.subarray(257, 263);
  return magic.equals(Buffer.from("ustar\0", "ascii"))
    || magic.equals(Buffer.from("ustar ", "ascii"))
    || isZeroBlock(magic);
}

function findZipEocd(bytes: Buffer, archiveName: string): number {
  if (bytes.length < ZIP_EOCD_BYTES) {
    malformed(archiveName, "ZIP end of central directory is missing.", "zip");
  }
  const minimum = Math.max(0, bytes.length - ZIP_EOCD_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = bytes.length - ZIP_EOCD_BYTES; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      const commentLength = bytes.readUInt16LE(offset + 20);
      if (offset + ZIP_EOCD_BYTES + commentLength === bytes.length) {
        return offset;
      }
    }
  }
  malformed(archiveName, "ZIP end of central directory is missing or malformed.", "zip");
}

function parseTarNumber(
  bytes: Buffer,
  archiveName: string,
  format: ArchiveFormat,
  field: "size" | "checksum"
): number {
  if ((bytes[0] ?? 0) & 0x80) {
    fail("ARCHIVE_FORMAT_UNSUPPORTED", "unsupported_input", "Base-256 TAR numeric fields are not supported.", {
      basename: archiveName,
      format
    });
  }
  const text = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  if (text === "") {
    return 0;
  }
  if (!/^[0-7]+$/u.test(text)) {
    malformed(archiveName, `TAR ${field} field is malformed.`, format);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) {
    malformed(archiveName, `TAR ${field} field exceeds the safe integer range.`, format);
  }
  return value;
}

function decodeUtf8(bytes: Buffer | Uint8Array, entryPath: string | undefined, archiveName: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("ARCHIVE_INTEGRITY_FAILED", "invalid_input", "Archive text is not valid UTF-8.", {
      basename: archiveName,
      ...(entryPath !== undefined ? { entryPath: safeEntryPathForError(entryPath) } : {})
    });
  }
}

function readU16(bytes: Buffer, offset: number, archiveName: string): number {
  requireRange(bytes, offset, 2, archiveName);
  return bytes.readUInt16LE(offset);
}

function readU32(bytes: Buffer, offset: number, archiveName: string): number {
  requireRange(bytes, offset, 4, archiveName);
  return bytes.readUInt32LE(offset);
}

function requireRange(
  bytes: Buffer,
  offset: number,
  length: number,
  archiveName: string,
  entryPath?: string
): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    malformed(archiveName, "Archive structure is truncated.", undefined, entryPath);
  }
}

function safeAdd(left: number, right: number, archiveName: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < left) {
    malformed(archiveName, "Archive numeric field overflows the safe integer range.");
  }
  return value;
}

function roundToTarBlock(size: number): number {
  return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
}

function isZeroBlock(bytes: Buffer): boolean {
  return bytes.every((byte) => byte === 0);
}

function hasSignatureAt(bytes: Buffer, offset: number, signature: number): boolean {
  return offset >= 0 && offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === signature;
}

function isZlibOutputLimitError(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false;
  }
  const code = "code" in cause && typeof cause.code === "string" ? cause.code : "";
  return code === "ERR_BUFFER_TOO_LARGE"
    || cause.message.includes("maxOutputLength")
    || cause.message.includes("larger than");
}

function foldEntryPath(entryPath: string): string {
  return entryPath.normalize("NFC").toLowerCase();
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(
  bytes: Buffer,
  budget: Budget,
  startedAt: number,
  archiveName: string,
  entryPath: string
): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    if ((index & 0xffff) === 0) {
      checkDeadlineSince(budget, startedAt, archiveName, entryPath);
    }
    const byte = bytes[index] ?? 0;
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  let name = basename(normalized)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f:]/gu, "_")
    .replace(/[. ]+$/u, "");
  if (name === "" || name === "." || name === "/" || isWindowsDeviceName(name)) {
    name = "archive";
  }
  while (Buffer.byteLength(name, "utf8") > 255) {
    name = name.slice(0, -1);
  }
  return name || "archive";
}

function safeDisplayPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:/u.test(normalized)
    || normalized.startsWith("//")
    || normalized !== normalized.normalize("NFC")
    || Buffer.byteLength(normalized, "utf8") > 4_096
    || /[\u0000-\u001f\u007f-\u009f:]/u.test(normalized)
    || segments.some((segment) =>
      segment === ""
      || segment === "."
      || segment === ".."
      || /[. ]$/u.test(segment)
      || Buffer.byteLength(segment, "utf8") > 255
      || isWindowsDeviceName(segment)
    )
  ) {
    return safeBasename(normalized);
  }
  return normalized;
}

function isWindowsDeviceName(segment: string): boolean {
  const base = segment.split(".", 1)[0]?.toUpperCase() ?? "";
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base);
}

function safeEntryPathForError(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const withoutControls = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "?");
  return withoutControls.slice(0, 4_096);
}

function invalidPath(archiveName: string, entryPath: string | undefined): never {
  fail("ARCHIVE_ENTRY_PATH_INVALID", "invalid_input", "Archive entry path is invalid.", {
    basename: archiveName,
    ...(entryPath !== undefined ? { entryPath } : {})
  });
}

function unsupportedType(
  archiveName: string,
  entryPath: string | undefined,
  format: ArchiveFormat
): never {
  fail("ARCHIVE_ENTRY_TYPE_UNSUPPORTED", "unsupported_input", "Archive entry type is not supported.", {
    basename: archiveName,
    ...(entryPath !== undefined ? { entryPath } : {}),
    format
  });
}

function duplicate(archiveName: string, entryPath: string): never {
  fail("ARCHIVE_DUPLICATE_ENTRY", "invalid_input", "Archive entries duplicate or collide by path.", {
    basename: archiveName,
    entryPath
  });
}

function integrity(
  archiveName: string,
  entryPath: string | undefined,
  message: string,
  format?: ArchiveFormat
): never {
  fail("ARCHIVE_INTEGRITY_FAILED", "invalid_input", message, {
    basename: archiveName,
    ...(entryPath !== undefined ? { entryPath } : {}),
    ...(format !== undefined ? { format } : {})
  });
}

function malformed(
  archiveName: string,
  message: string,
  format?: ArchiveFormat,
  entryPath?: string
): never {
  fail("ARCHIVE_MALFORMED", "invalid_input", message, {
    basename: archiveName,
    ...(entryPath !== undefined ? { entryPath } : {}),
    ...(format !== undefined ? { format } : {})
  });
}

function fail(
  code: OhriskErrorCode,
  category: OhriskError["category"],
  message: string,
  details?: InternalErrorDetails
): never {
  throw new ArchiveFailure({ code, category, message, ...(details ? { details } : {}) });
}

function toOhriskError(
  cause: unknown,
  fallbackCode: OhriskErrorCode,
  fallbackCategory: OhriskError["category"],
  archiveName: string
): OhriskError {
  if (cause instanceof ArchiveFailure) {
    return createError({
      code: cause.code,
      category: cause.category,
      message: cause.message,
      ...(cause.details ? { details: cause.details } : {})
    });
  }
  return createError({
    code: fallbackCode,
    category: fallbackCategory,
    message: "Archive operation failed.",
    details: { basename: archiveName }
  });
}
