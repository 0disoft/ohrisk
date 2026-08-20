import {
  createSpdxCatalogModel,
  gitBlobSha,
  parseExactSourceCommit,
  writeSpdxCatalog,
  type SpdxCatalogModel
} from "./spdx-catalog";

const SPDX_SOURCE_REPOSITORY = "spdx/license-list-data";
const SPDX_CONTENTS_API_BASE_URL =
  `https://api.github.com/repos/${SPDX_SOURCE_REPOSITORY}/contents`;
const SPDX_RAW_BASE_URL =
  `https://raw.githubusercontent.com/${SPDX_SOURCE_REPOSITORY}`;
const LICENSE_LIST_PATH = "json/licenses.json";
const EXCEPTION_LIST_PATH = "json/exceptions.json";
const GITHUB_METADATA_MAX_BYTES = 256 * 1024;
const SPDX_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type OfficialSourceFileMetadata = {
  sourcePath: string;
  blobSha: string;
  size: number;
};

export async function updateSpdxCatalog(input: {
  sourceCommit: string;
  workingDirectory?: string;
  fetchImpl?: FetchFunction;
}): Promise<{ changed: boolean; outputPath: string; model: SpdxCatalogModel }> {
  const sourceCommit = parseExactSourceCommit(input.sourceCommit);
  const fetchImpl = input.fetchImpl ?? fetch;
  const metadata = await fetchOfficialSourceMetadata({ sourceCommit, fetchImpl });
  const [licenseBytes, exceptionBytes] = await Promise.all([
    fetchOfficialSourceFile({
      sourceCommit,
      metadata: metadata.licenses,
      fetchImpl
    }),
    fetchOfficialSourceFile({
      sourceCommit,
      metadata: metadata.exceptions,
      fetchImpl
    })
  ]);
  const model = createSpdxCatalogModel({
    sourceCommit,
    licenseBytes,
    exceptionBytes,
    licenseBlobSha: metadata.licenses.blobSha,
    exceptionBlobSha: metadata.exceptions.blobSha
  });
  const written = await writeSpdxCatalog({
    model,
    ...(input.workingDirectory === undefined
      ? {}
      : { workingDirectory: input.workingDirectory })
  });
  return { ...written, model };
}

async function fetchOfficialSourceMetadata(input: {
  sourceCommit: string;
  fetchImpl: FetchFunction;
}): Promise<{
  licenses: OfficialSourceFileMetadata;
  exceptions: OfficialSourceFileMetadata;
}> {
  const metadataUrl = `${SPDX_CONTENTS_API_BASE_URL}/json?ref=${input.sourceCommit}`;
  const metadataBytes = await fetchBoundedBytes({
    url: metadataUrl,
    maxBytes: GITHUB_METADATA_MAX_BYTES,
    fetchImpl: input.fetchImpl,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ohrisk-spdx-catalog-updater",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  const entries = parseJsonArray(metadataBytes, "SPDX json directory metadata");
  return {
    licenses: findOfficialSourceMetadata(entries, LICENSE_LIST_PATH),
    exceptions: findOfficialSourceMetadata(entries, EXCEPTION_LIST_PATH)
  };
}

function findOfficialSourceMetadata(
  entries: readonly unknown[],
  sourcePath: string
): OfficialSourceFileMetadata {
  const matching = entries.filter(
    (entry) => isJsonObject(entry) && entry.path === sourcePath
  );
  if (matching.length !== 1 || !isJsonObject(matching[0])) {
    throw new Error(`GitHub metadata must contain exactly one ${sourcePath} file.`);
  }
  const metadata = matching[0];
  const metadataType = requiredString(metadata, "type", `${sourcePath} metadata`);
  const blobSha = requiredString(metadata, "sha", `${sourcePath} metadata`);
  const size = requiredSafeInteger(metadata, "size", `${sourcePath} metadata`);
  if (metadataType !== "file") {
    throw new Error(`GitHub metadata did not identify ${sourcePath} as a file.`);
  }
  requireGitObjectSha(blobSha, `${sourcePath} blob SHA`);
  if (size > SPDX_DOCUMENT_MAX_BYTES) {
    throw new Error(`${sourcePath} exceeds the ${SPDX_DOCUMENT_MAX_BYTES}-byte limit.`);
  }
  return { sourcePath, blobSha, size };
}

async function fetchOfficialSourceFile(input: {
  sourceCommit: string;
  metadata: OfficialSourceFileMetadata;
  fetchImpl: FetchFunction;
}): Promise<Buffer> {
  const rawUrl =
    `${SPDX_RAW_BASE_URL}/${input.sourceCommit}/${input.metadata.sourcePath}`;
  const bytes = await fetchBoundedBytes({
    url: rawUrl,
    maxBytes: SPDX_DOCUMENT_MAX_BYTES,
    fetchImpl: input.fetchImpl,
    headers: { Accept: "application/json" }
  });
  if (bytes.byteLength !== input.metadata.size) {
    throw new Error(`${input.metadata.sourcePath} size does not match GitHub metadata.`);
  }
  if (gitBlobSha(bytes) !== input.metadata.blobSha) {
    throw new Error(
      `${input.metadata.sourcePath} Git blob SHA does not match GitHub metadata.`
    );
  }
  return bytes;
}

async function fetchBoundedBytes(input: {
  url: string;
  maxBytes: number;
  fetchImpl: FetchFunction;
  headers: Record<string, string>;
}): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await input.fetchImpl(input.url, {
      headers: input.headers,
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${input.url} returned HTTP ${response.status}.`);
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
        throw new Error(`${input.url} returned an invalid Content-Length header.`);
      }
      if (parsedLength > input.maxBytes) {
        throw new Error(`${input.url} exceeds the ${input.maxBytes}-byte limit.`);
      }
    }
    if (response.body === null) {
      throw new Error(`${input.url} returned no readable response body.`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > input.maxBytes) {
          await reader.cancel();
          throw new Error(`${input.url} exceeds the ${input.maxBytes}-byte limit.`);
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${input.url} timed out after ${FETCH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonArray(bytes: Uint8Array, name: string): unknown[] {
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
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be a JSON array.`);
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

function requiredSafeInteger(
  object: Record<string, unknown>,
  key: string,
  name: string
): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must contain a non-negative integer ${key}.`);
  }
  return value;
}

function requireGitObjectSha(value: string, name: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${name} must be a lowercase 40-character Git object SHA.`);
  }
}

async function runCli(args: readonly string[]): Promise<void> {
  try {
    if (args.length !== 1) {
      throw new Error("Usage: bun scripts/update-spdx-catalog.ts <40-character-commit>");
    }
    const result = await updateSpdxCatalog({ sourceCommit: args[0] ?? "" });
    const action = result.changed ? "Updated" : "Verified";
    process.stdout.write(
      `${action} ${result.outputPath} from ${result.model.sourceCommit}.\n`
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown SPDX update failure.";
    process.stderr.write(`spdx:update failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await runCli(process.argv.slice(2));
}
