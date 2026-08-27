import { createHash, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import { readArchiveBytes } from "../archive/archive-reader";
import { parseGoModRecords } from "../graph/go-mod";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const GO_MODULE_ZIP_MAX_ENTRIES = 65_535;
const GO_MODULE_ZIP_ENTRY_MAX_BYTES = 50 * 1024 * 1024;
const GO_MODULE_ZIP_EXPANDED_MAX_BYTES = 512 * 1024 * 1024;
const GO_MODULE_ZIP_MATERIALIZED_MAX_BYTES = 34 * 1024 * 1024;
const GO_MODULE_LICENSE_MAX_BYTES = 2 * 1024 * 1024;
const GO_MODULE_LICENSE_FILE_LIMIT = 16;
const GO_MODULE_MOD_MAX_BYTES = 2 * 1024 * 1024;
const GO_H1_DIGEST_BYTES = 32;
const GO_MOD_DECODER = new TextDecoder("utf-8", { fatal: true });

export function collectGoModuleZipEvidence(input: {
  packageId: string;
  modulePath: string;
  version: string;
  checksum: string;
  zip: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const archive = readArchiveBytes({
    displayName: `${safeGoModuleDisplayName(input.modulePath)}@${input.version}.zip`,
    bytes: input.zip,
    formatHint: "zip",
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: GO_MODULE_ZIP_MAX_ENTRIES,
      entryBytes: GO_MODULE_ZIP_ENTRY_MAX_BYTES,
      expandedBytes: GO_MODULE_ZIP_EXPANDED_MAX_BYTES,
      materializedBytes: GO_MODULE_ZIP_MATERIALIZED_MAX_BYTES
    }
  });
  if (!archive.ok) {
    if (archive.error.code === "ARCHIVE_LIMIT_EXCEEDED") {
      return ok(unavailableGoModuleEvidence(
        input.packageId,
        `Checksum-identified Go module zip exceeded bounded archive limits (${archive.error.code}); its contents were not trusted.`
      ));
    }
    return err(archive.error);
  }

  const rootPrefix = `${input.modulePath}@${input.version}/`;
  const fileNames = archive.value.entries.map((entry) =>
    entry.type === "directory" ? `${entry.path}/` : entry.path
  );
  const unexpectedPath = fileNames.find((fileName) => !fileName.startsWith(rootPrefix));
  if (unexpectedPath) {
    return err(goModuleEvidenceError({
      packageId: input.packageId,
      message: "Go module zip did not use the requested module path and version prefix.",
      details: {
        reason: "go_module_zip_identity_mismatch",
        expectedPrefix: rootPrefix,
        observedPath: unexpectedPath
      }
    }));
  }

  const computedChecksum = hashGoModuleArchive({
    packageId: input.packageId,
    entries: archive.value.entries,
    hashEntrySha256: archive.value.hashEntrySha256
  });
  if (!computedChecksum.ok) {
    return computedChecksum;
  }
  if (!equalGoChecksums(input.checksum, computedChecksum.value)) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Go module zip checksum did not match go.sum.",
      details: {
        packageId: input.packageId,
        modulePath: input.modulePath,
        version: input.version,
        integrity: input.checksum,
        computed: computedChecksum.value
      }
    }));
  }

  const evidencePaths = archive.value.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path)
    .filter((entryPath) => isGoModuleRootEvidencePath(entryPath, rootPrefix))
    .slice(0, GO_MODULE_LICENSE_FILE_LIMIT);
  const files: LicenseEvidenceFile[] = [];
  for (const evidencePath of evidencePaths) {
    const kind = classifyEvidenceFile(evidencePath);
    if (!kind) {
      continue;
    }
    const text = archive.value.readText(evidencePath, GO_MODULE_LICENSE_MAX_BYTES);
    if (!text.ok) {
      return err(text.error);
    }
    files.push({
      path: evidencePath.slice(rootPrefix.length),
      kind,
      text: text.value
    });
  }

  const goModuleRequirements = readVerifiedGoModuleRequirements({
    goModPath: `${rootPrefix}go.mod`,
    entries: archive.value.entries,
    readText: archive.value.readText
  });

  return ok({
    packageId: input.packageId,
    ...(goModuleRequirements ? { goModuleRequirements } : {}),
    files,
    source: "tarball",
    warnings: files.length > 0
      ? []
      : ["Checksum-verified Go module zip did not contain a root license evidence file."]
  });
}

export function readChecksumVerifiedGoModuleRequirements(input: {
  checksum: string;
  goMod: Buffer | Uint8Array;
}): string[] | undefined {
  const computedChecksum = hashGoModBytes(input.goMod);
  if (!equalGoChecksums(input.checksum, computedChecksum)) {
    return undefined;
  }

  let text: string;
  try {
    text = GO_MOD_DECODER.decode(input.goMod);
  } catch {
    return undefined;
  }

  const parsed = parseGoModRecords(text, "go.mod", { strictEdges: true });
  return parsed.ok
    ? [...new Set(parsed.value.records.map((record) => record.modulePath))].sort()
    : undefined;
}


function readVerifiedGoModuleRequirements(input: {
  goModPath: string;
  entries: ReadonlyArray<{ path: string; type: "file" | "directory" }>;
  readText: (entryPath: string, maxBytes: number) => Result<string, OhriskError>;
}): string[] | undefined {
  if (!input.entries.some((entry) => entry.type === "file" && entry.path === input.goModPath)) {
    return undefined;
  }
  const goModText = input.readText(input.goModPath, GO_MODULE_MOD_MAX_BYTES);
  if (!goModText.ok) {
    return undefined;
  }
  const parsed = parseGoModRecords(goModText.value, input.goModPath, { strictEdges: true });
  if (!parsed.ok) {
    return undefined;
  }
  return [...new Set(parsed.value.records.map((record) => record.modulePath))].sort();
}

function hashGoModuleArchive(input: {
  packageId: string;
  entries: ReadonlyArray<{ path: string; type: "file" | "directory" }>;
  hashEntrySha256: (entryPath: string) => Result<string, OhriskError>;
}): Result<string, OhriskError> {
  const summary = createHash("sha256");
  const entries = [...input.entries].sort((left, right) => {
    const leftName = left.type === "directory" ? `${left.path}/` : left.path;
    const rightName = right.type === "directory" ? `${right.path}/` : right.path;
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });

  for (const entry of entries) {
    const fileName = entry.type === "directory" ? `${entry.path}/` : entry.path;
    if (fileName.includes("\n")) {
      return err(goModuleEvidenceError({
        packageId: input.packageId,
        message: "Go module zip contained a newline in an entry path.",
        details: { reason: "go_module_zip_newline_path" }
      }));
    }
    let fileDigest: string;
    if (entry.type === "directory") {
      fileDigest = createHash("sha256").digest("hex");
    } else {
      const hashed = input.hashEntrySha256(entry.path);
      if (!hashed.ok) {
        return hashed;
      }
      fileDigest = hashed.value;
    }
    summary.update(`${fileDigest}  ${fileName}\n`, "utf8");
  }

  return ok(`h1:${summary.digest("base64")}`);
}

function hashGoModBytes(goMod: Buffer | Uint8Array): string {
  const fileDigest = createHash("sha256").update(goMod).digest("hex");
  const summary = createHash("sha256")
    .update(`${fileDigest}  go.mod\n`, "utf8")
    .digest("base64");
  return `h1:${summary}`;
}

function equalGoChecksums(expected: string, computed: string): boolean {
  const expectedDigest = decodeGoChecksum(expected);
  const computedDigest = decodeGoChecksum(computed);
  return expectedDigest !== undefined
    && computedDigest !== undefined
    && expectedDigest.length === computedDigest.length
    && timingSafeEqual(expectedDigest, computedDigest);
}

function decodeGoChecksum(value: string): Buffer | undefined {
  if (!/^h1:[A-Za-z0-9+/]{43}=$/u.test(value)) {
    return undefined;
  }
  const digest = Buffer.from(value.slice("h1:".length), "base64");
  return digest.length === GO_H1_DIGEST_BYTES ? digest : undefined;
}

function isGoModuleRootEvidencePath(entryPath: string, rootPrefix: string): boolean {
  if (!entryPath.startsWith(rootPrefix)) {
    return false;
  }
  const relativePath = entryPath.slice(rootPrefix.length);
  return relativePath !== ""
    && !relativePath.includes("/")
    && classifyEvidenceFile(relativePath) !== undefined;
}

function unavailableGoModuleEvidence(packageId: string, warning: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [warning]
  };
}

function goModuleEvidenceError(input: {
  packageId: string;
  message: string;
  details: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: input.message,
    details: {
      packageId: input.packageId,
      ...input.details
    }
  });
}

function safeGoModuleDisplayName(modulePath: string): string {
  return modulePath.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(-120) || "go-module";
}
