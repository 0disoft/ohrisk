import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { readArchiveBytes } from "../archive/archive-reader";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { parseCargoManifestMetadata } from "./cargo-package";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const CARGO_CRATE_MAX_ENTRIES = 50_000;
const CARGO_CRATE_ENTRY_MAX_BYTES = 50 * 1024 * 1024;
const CARGO_CRATE_EXPANDED_MAX_BYTES = 256 * 1024 * 1024;
const CARGO_CRATE_MATERIALIZED_MAX_BYTES = 128 * 1024 * 1024;
const CARGO_CRATE_MANIFEST_MAX_BYTES = 1024 * 1024;
const CARGO_CRATE_LICENSE_MAX_BYTES = 2 * 1024 * 1024;
const CARGO_CRATE_LICENSE_FILE_LIMIT = 50;
const SHA256_DIGEST_BYTES = 32;

export function collectCargoCrateEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  integrity: string;
  crate: Buffer | Uint8Array;
  artifactMaxBytes: number;
}): Result<LicenseEvidence, OhriskError> {
  const verified = verifyCargoCrateIntegrity(input);
  if (!verified.ok) {
    return verified;
  }

  const archiveName = `${safeCargoDisplayPart(input.packageName)}-${safeCargoDisplayPart(input.version)}.crate`;
  const archive = readArchiveBytes({
    displayName: archiveName,
    bytes: input.crate,
    formatHint: "tar.gz",
    limits: {
      inputBytes: input.artifactMaxBytes,
      entries: CARGO_CRATE_MAX_ENTRIES,
      entryBytes: CARGO_CRATE_ENTRY_MAX_BYTES,
      expandedBytes: CARGO_CRATE_EXPANDED_MAX_BYTES,
      materializedBytes: CARGO_CRATE_MATERIALIZED_MAX_BYTES
    }
  });
  if (!archive.ok) {
    if (archive.error.code === "ARCHIVE_LIMIT_EXCEEDED") {
      return ok(unavailableCargoCrateEvidence(
        input.packageId,
        `Checksum-identified Cargo crate exceeded bounded archive limits (${archive.error.code}); its contents were not trusted.`
      ));
    }
    return err(archive.error);
  }

  const root = `${input.packageName}-${input.version}`;
  const rootPrefix = `${root}/`;
  const unexpectedEntry = archive.value.entries.find((entry) =>
    entry.path !== root && !entry.path.startsWith(rootPrefix)
  );
  if (unexpectedEntry) {
    return err(cargoCrateError(input, "Cargo crate archive did not use the requested package root.", {
      reason: "cargo_crate_root_mismatch",
      expectedRoot: root,
      observedPath: unexpectedEntry.path
    }));
  }

  const manifestPath = `${rootPrefix}Cargo.toml`;
  const manifestEntry = archive.value.entries.find((entry) =>
    entry.type === "file" && entry.path === manifestPath
  );
  if (!manifestEntry) {
    return err(cargoCrateError(input, "Cargo crate archive did not contain Cargo.toml.", {
      reason: "cargo_crate_manifest_missing"
    }));
  }
  const manifestText = archive.value.readText(manifestPath, CARGO_CRATE_MANIFEST_MAX_BYTES);
  if (!manifestText.ok) {
    return err(manifestText.error);
  }
  const manifest = parseCargoManifestMetadata(manifestText.value);
  if (manifest.name !== input.packageName || manifest.version !== input.version) {
    return err(cargoCrateError(input, "Cargo crate manifest identity did not match the requested package.", {
      reason: "cargo_crate_identity_mismatch",
      expectedName: input.packageName,
      expectedVersion: input.version,
      ...(manifest.name ? { observedName: manifest.name } : {}),
      ...(manifest.version ? { observedVersion: manifest.version } : {})
    }));
  }

  const evidencePaths = new Map<string, LicenseEvidenceFile["kind"]>();
  const declaredLicenseFile = normalizeDeclaredLicenseFile(manifest.licenseFile);
  if (declaredLicenseFile) {
    evidencePaths.set(declaredLicenseFile, "license");
  }
  for (const relativePath of archive.value.entries
    .filter((entry) => entry.type === "file" && entry.path.startsWith(rootPrefix))
    .map((entry) => entry.path.slice(rootPrefix.length))
    .filter((relativePath) => !relativePath.includes("/"))
    .sort()) {
    const kind = classifyEvidenceFile(relativePath);
    if (kind && !evidencePaths.has(relativePath)) {
      evidencePaths.set(relativePath, kind);
    }
  }

  const warnings: string[] = [];
  const files: LicenseEvidenceFile[] = [];
  for (const [relativePath, kind] of [...evidencePaths.entries()]
    .slice(0, CARGO_CRATE_LICENSE_FILE_LIMIT)) {
    const entryPath = `${rootPrefix}${relativePath}`;
    const entry = archive.value.entries.find((candidate) =>
      candidate.type === "file" && candidate.path === entryPath
    );
    if (!entry) {
      warnings.push(`Cargo.toml declared missing license-file ${relativePath}.`);
      continue;
    }
    const text = archive.value.readText(entryPath, CARGO_CRATE_LICENSE_MAX_BYTES);
    if (!text.ok) {
      warnings.push(`Skipped ${relativePath}: Cargo license evidence exceeded bounded text limits.`);
      continue;
    }
    files.push({ path: relativePath, kind, text: text.value });
  }

  if (files.length === 0) {
    warnings.push("Checksum-verified Cargo crate did not contain a package license evidence file.");
  }
  if (!manifest.license) {
    warnings.push("Cargo.toml did not declare a package license.");
  }

  return ok({
    packageId: input.packageId,
    ...(manifest.license
      ? { metadataLicense: manifest.license, metadataSource: "Cargo.toml" }
      : {}),
    files,
    source: "tarball",
    warnings
  });
}

function unavailableCargoCrateEvidence(packageId: string, warning: string): LicenseEvidence {
  return {
    packageId,
    files: [],
    source: "unavailable",
    warnings: [warning]
  };
}

function verifyCargoCrateIntegrity(input: {
  packageId: string;
  integrity: string;
  crate: Buffer | Uint8Array;
}): Result<void, OhriskError> {
  const expected = decodeSha256Integrity(input.integrity);
  const actual = createHash("sha256").update(input.crate).digest();
  if (
    !expected
    || expected.length !== actual.length
    || !timingSafeEqual(expected, actual)
  ) {
    return err(createError({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      category: "unsupported_input",
      message: "Cargo crate checksum did not match Cargo.lock.",
      details: {
        packageId: input.packageId,
        integrity: input.integrity,
        computed: `sha256-${actual.toString("base64")}`
      }
    }));
  }
  return ok(undefined);
}

function decodeSha256Integrity(integrity: string): Buffer | undefined {
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/u.test(integrity)) {
    return undefined;
  }
  const digest = Buffer.from(integrity.slice("sha256-".length), "base64");
  return digest.length === SHA256_DIGEST_BYTES ? digest : undefined;
}

function normalizeDeclaredLicenseFile(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
  ) {
    return undefined;
  }
  return normalized;
}

function safeCargoDisplayPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._+-]/g, "_").slice(0, 120) || "package";
}

function cargoCrateError(
  input: { packageId: string; packageName: string; version: string },
  message: string,
  details: Record<string, unknown>
): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message,
    details: {
      packageId: input.packageId,
      packageName: input.packageName,
      version: input.version,
      ...details
    }
  });
}
