import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SPDX_CATALOG_OUTPUT_PATH = path.join(
  "src",
  "license",
  "spdx-catalog.ts"
);

export type SpdxCatalogModel = {
  licenseListVersion: string;
  releaseDate: string;
  sourceCommit: string;
  licenseBlobSha: string;
  exceptionBlobSha: string;
  activeLicenseIds: string[];
  deprecatedLicenseIds: string[];
  activeExceptionIds: string[];
  deprecatedExceptionIds: string[];
};

type CatalogDocument = {
  licenseListVersion: string;
  releaseDate: string;
  activeIds: string[];
  deprecatedIds: string[];
};

export function parseExactSourceCommit(value: string | undefined): string {
  if (value === undefined || !/^[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("SPDX source must be an exact 40-character Git commit SHA.");
  }
  return value.toLowerCase();
}

export function gitBlobSha(bytes: Uint8Array): string {
  // Git object IDs use SHA-1; this verifies repository identity, not signatures.
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

export function createSpdxCatalogModel(input: {
  sourceCommit: string;
  licenseBytes: Uint8Array;
  exceptionBytes: Uint8Array;
  licenseBlobSha?: string;
  exceptionBlobSha?: string;
}): SpdxCatalogModel {
  const sourceCommit = parseExactSourceCommit(input.sourceCommit);
  const licenses = parseCatalogDocument({
    bytes: input.licenseBytes,
    documentName: "license list",
    entriesKey: "licenses",
    identifierKey: "licenseId"
  });
  const exceptions = parseCatalogDocument({
    bytes: input.exceptionBytes,
    documentName: "exception list",
    entriesKey: "exceptions",
    identifierKey: "licenseExceptionId"
  });

  if (licenses.licenseListVersion !== exceptions.licenseListVersion) {
    throw new Error("SPDX license and exception list versions do not match.");
  }
  if (licenses.releaseDate !== exceptions.releaseDate) {
    throw new Error("SPDX license and exception release dates do not match.");
  }

  const licenseBlobSha = input.licenseBlobSha ?? gitBlobSha(input.licenseBytes);
  const exceptionBlobSha = input.exceptionBlobSha ?? gitBlobSha(input.exceptionBytes);
  requireGitObjectSha(licenseBlobSha, "license list blob SHA");
  requireGitObjectSha(exceptionBlobSha, "exception list blob SHA");

  return {
    licenseListVersion: licenses.licenseListVersion,
    releaseDate: licenses.releaseDate,
    sourceCommit,
    licenseBlobSha,
    exceptionBlobSha,
    activeLicenseIds: licenses.activeIds,
    deprecatedLicenseIds: licenses.deprecatedIds,
    activeExceptionIds: exceptions.activeIds,
    deprecatedExceptionIds: exceptions.deprecatedIds
  };
}

export function renderSpdxCatalog(model: SpdxCatalogModel): string {
  return [
    "// Generated from spdx/license-list-data. Update only from an exact reviewed source commit.",
    `export const SPDX_LICENSE_LIST_VERSION = ${quote(model.licenseListVersion)};`,
    `export const SPDX_LICENSE_LIST_RELEASE_DATE = ${quote(model.releaseDate)};`,
    `export const SPDX_LICENSE_LIST_SOURCE_COMMIT = ${quote(model.sourceCommit)};`,
    `export const SPDX_LICENSE_LIST_BLOB_SHA = ${quote(model.licenseBlobSha)};`,
    `export const SPDX_EXCEPTION_LIST_BLOB_SHA = ${quote(model.exceptionBlobSha)};`,
    `export const SPDX_ACTIVE_LICENSE_ID_COUNT = ${model.activeLicenseIds.length};`,
    `export const SPDX_DEPRECATED_LICENSE_ID_COUNT = ${model.deprecatedLicenseIds.length};`,
    `export const SPDX_ACTIVE_EXCEPTION_ID_COUNT = ${model.activeExceptionIds.length};`,
    `export const SPDX_DEPRECATED_EXCEPTION_ID_COUNT = ${model.deprecatedExceptionIds.length};`,
    "",
    'export type SpdxCatalogStatus = "active" | "deprecated" | "unlisted";',
    "",
    renderIdentifierSet("ACTIVE_SPDX_LICENSE_IDS", model.activeLicenseIds),
    "",
    renderIdentifierSet("DEPRECATED_SPDX_LICENSE_IDS", model.deprecatedLicenseIds),
    "",
    renderIdentifierSet("ACTIVE_SPDX_EXCEPTION_IDS", model.activeExceptionIds),
    "",
    renderIdentifierSet("DEPRECATED_SPDX_EXCEPTION_IDS", model.deprecatedExceptionIds),
    "",
    "export function spdxLicenseIdStatus(value: string): SpdxCatalogStatus {",
    "  const exact = catalogStatus(value, ACTIVE_SPDX_LICENSE_IDS, DEPRECATED_SPDX_LICENSE_IDS);",
    '  if (exact !== "unlisted" || !value.endsWith("+")) {',
    "    return exact;",
    "  }",
    "",
    (
      "  return catalogStatus(value.slice(0, -1), "
      + "ACTIVE_SPDX_LICENSE_IDS, DEPRECATED_SPDX_LICENSE_IDS);"
    ),
    "}",
    "",
    "export function spdxExceptionIdStatus(value: string): SpdxCatalogStatus {",
    "  return catalogStatus(value, ACTIVE_SPDX_EXCEPTION_IDS, DEPRECATED_SPDX_EXCEPTION_IDS);",
    "}",
    "",
    "function catalogStatus(",
    "  value: string,",
    "  active: ReadonlySet<string>,",
    "  deprecated: ReadonlySet<string>",
    "): SpdxCatalogStatus {",
    "  if (active.has(value)) {",
    '    return "active";',
    "  }",
    "  if (deprecated.has(value)) {",
    '    return "deprecated";',
    "  }",
    '  return "unlisted";',
    "}",
    ""
  ].join("\n");
}

export async function writeSpdxCatalog(input: {
  model: SpdxCatalogModel;
  workingDirectory?: string;
}): Promise<{ changed: boolean; outputPath: string }> {
  const absolutePath = path.resolve(
    input.workingDirectory ?? process.cwd(),
    SPDX_CATALOG_OUTPUT_PATH
  );
  const changed = await replaceTextFileAtomically(
    absolutePath,
    renderSpdxCatalog(input.model)
  );
  return { changed, outputPath: SPDX_CATALOG_OUTPUT_PATH };
}

function parseCatalogDocument(input: {
  bytes: Uint8Array;
  documentName: string;
  entriesKey: "licenses" | "exceptions";
  identifierKey: "licenseId" | "licenseExceptionId";
}): CatalogDocument {
  const document = parseJsonObject(input.bytes, input.documentName);
  const licenseListVersion = requiredString(
    document,
    "licenseListVersion",
    input.documentName
  );
  const releaseDate = requiredString(document, "releaseDate", input.documentName);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(releaseDate)) {
    throw new Error(`${input.documentName} releaseDate must be an exact UTC timestamp.`);
  }
  if (Number.isNaN(Date.parse(releaseDate))) {
    throw new Error(`${input.documentName} releaseDate is not a valid UTC timestamp.`);
  }

  const entries = document[input.entriesKey];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${input.documentName} must contain a non-empty ${input.entriesKey} array.`);
  }
  const activeIds: string[] = [];
  const deprecatedIds: string[] = [];
  const seen = new Set<string>();
  for (const [index, entryValue] of entries.entries()) {
    if (!isJsonObject(entryValue)) {
      throw new Error(`${input.documentName} entry ${index} must be an object.`);
    }
    const identifier = requiredString(
      entryValue,
      input.identifierKey,
      `${input.documentName} entry ${index}`
    );
    if (identifier.trim() !== identifier || /[\u0000-\u001f\u007f]/.test(identifier)) {
      throw new Error(`${input.documentName} entry ${index} has an invalid identifier.`);
    }
    if (seen.has(identifier)) {
      throw new Error(`${input.documentName} contains duplicate identifier ${identifier}.`);
    }
    seen.add(identifier);
    const deprecated = entryValue.isDeprecatedLicenseId;
    if (typeof deprecated !== "boolean") {
      throw new Error(
        `${input.documentName} entry ${index} must contain isDeprecatedLicenseId.`
      );
    }
    (deprecated ? deprecatedIds : activeIds).push(identifier);
  }
  activeIds.sort(compareIdentifiers);
  deprecatedIds.sort(compareIdentifiers);
  return {
    licenseListVersion,
    releaseDate,
    activeIds,
    deprecatedIds
  };
}

function parseJsonObject(bytes: Uint8Array, name: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${name} is not valid UTF-8.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
  if (!isJsonObject(value)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  object: Record<string, unknown>,
  key: string,
  name: string
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must contain a non-empty ${key} string.`);
  }
  return value;
}

function requireGitObjectSha(value: string, name: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${name} must be a lowercase 40-character Git object SHA.`);
  }
}

function compareIdentifiers(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function renderIdentifierSet(name: string, identifiers: readonly string[]): string {
  const entries = identifiers.map((identifier) => `  ${quote(identifier)},`);
  return [`const ${name} = new Set([`, ...entries, "]);"].join("\n");
}

async function replaceTextFileAtomically(
  outputPath: string,
  content: string
): Promise<boolean> {
  let current: string | undefined;
  try {
    current = await readFile(outputPath, "utf8");
  } catch (error) {
    if (readErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  if (current === content) {
    return false;
  }

  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx"
    });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return true;
}

function readErrorCode(error: unknown): unknown {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  return Reflect.get(error, "code");
}
