import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createSpdxCatalogModel,
  gitBlobSha,
  parseExactSourceCommit,
  renderSpdxCatalog
} from "../scripts/spdx-catalog";
import { updateSpdxCatalog } from "../scripts/update-spdx-catalog";

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RELEASE_DATE = "2026-07-16T00:00:00Z";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function licenseBytes(entries: unknown[]): Uint8Array {
  return jsonBytes({
    licenseListVersion: "test-version",
    licenses: entries,
    releaseDate: RELEASE_DATE
  });
}

function exceptionBytes(entries: unknown[]): Uint8Array {
  return jsonBytes({
    licenseListVersion: "test-version",
    exceptions: entries,
    releaseDate: RELEASE_DATE
  });
}

describe("SPDX catalog updater", () => {
  test("requires an exact source commit", () => {
    expect(parseExactSourceCommit(SOURCE_COMMIT.toUpperCase())).toBe(SOURCE_COMMIT);
    expect(() => parseExactSourceCommit("main")).toThrow("exact 40-character");
    expect(() => parseExactSourceCommit(undefined)).toThrow("exact 40-character");
  });

  test("computes Git blob identities from the exact bytes", () => {
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a"
    );
  });

  test("splits, sorts, and renders official identifiers deterministically", () => {
    const model = createSpdxCatalogModel({
      sourceCommit: SOURCE_COMMIT,
      licenseBytes: licenseBytes([
        { licenseId: "zlib-acknowledgement", isDeprecatedLicenseId: false },
        { licenseId: "MIT", isDeprecatedLicenseId: false },
        { licenseId: "GPL-2.0", isDeprecatedLicenseId: true },
        { licenseId: "Apache-2.0", isDeprecatedLicenseId: false }
      ]),
      exceptionBytes: exceptionBytes([
        {
          licenseExceptionId: "Nokia-Qt-exception-1.1",
          isDeprecatedLicenseId: true
        },
        {
          licenseExceptionId: "Classpath-exception-2.0",
          isDeprecatedLicenseId: false
        }
      ])
    });

    expect(model.activeLicenseIds).toEqual([
      "Apache-2.0",
      "MIT",
      "zlib-acknowledgement"
    ]);
    expect(model.deprecatedLicenseIds).toEqual(["GPL-2.0"]);
    expect(model.activeExceptionIds).toEqual(["Classpath-exception-2.0"]);
    expect(model.deprecatedExceptionIds).toEqual(["Nokia-Qt-exception-1.1"]);

    const rendered = renderSpdxCatalog(model);
    expect(rendered).toContain("export const SPDX_ACTIVE_LICENSE_ID_COUNT = 3;");
    expect(rendered).toContain(
      'const ACTIVE_SPDX_LICENSE_IDS = new Set([\n  "Apache-2.0",\n  "MIT",'
    );
    expect(rendered).toContain("export function spdxLicenseIdStatus");
    expect(rendered).toBe(renderSpdxCatalog(model));
    expect(rendered.endsWith("\n")).toBe(true);
  });

  test("verifies source blob identities and updates the catalog idempotently", async () => {
    const licenses = licenseBytes([
      { licenseId: "MIT", isDeprecatedLicenseId: false }
    ]);
    const exceptions = exceptionBytes([
      {
        licenseExceptionId: "Classpath-exception-2.0",
        isDeprecatedLicenseId: false
      }
    ]);
    const sourceFiles = new Map([
      ["json/licenses.json", licenses],
      ["json/exceptions.json", exceptions]
    ]);
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes("/contents/json?ref=")) {
        return Response.json([...sourceFiles].map(([sourcePath, bytes]) => ({
          path: sourcePath,
          type: "file",
          sha: gitBlobSha(bytes),
          size: bytes.byteLength
        })));
      }
      for (const [sourcePath, bytes] of sourceFiles) {
        if (url.endsWith(`/${SOURCE_COMMIT}/${sourcePath}`)) {
          return new Response(new TextDecoder().decode(bytes), {
            headers: { "Content-Length": String(bytes.byteLength) }
          });
        }
      }
      return new Response("not found", { status: 404 });
    };

    const root = await mkdtemp(path.join(tmpdir(), "ohrisk-spdx-update-"));
    try {
      await mkdir(path.join(root, "src", "license"), { recursive: true });
      const first = await updateSpdxCatalog({
        sourceCommit: SOURCE_COMMIT,
        workingDirectory: root,
        fetchImpl
      });
      const second = await updateSpdxCatalog({
        sourceCommit: SOURCE_COMMIT,
        workingDirectory: root,
        fetchImpl
      });
      const output = await readFile(
        path.join(root, "src", "license", "spdx-catalog.ts"),
        "utf8"
      );

      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(output).toBe(renderSpdxCatalog(first.model));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects mismatched source metadata", () => {
    const mismatchedExceptions = jsonBytes({
      licenseListVersion: "different-version",
      exceptions: [
        {
          licenseExceptionId: "Classpath-exception-2.0",
          isDeprecatedLicenseId: false
        }
      ],
      releaseDate: RELEASE_DATE
    });
    expect(() => createSpdxCatalogModel({
      sourceCommit: SOURCE_COMMIT,
      licenseBytes: licenseBytes([
        { licenseId: "MIT", isDeprecatedLicenseId: false }
      ]),
      exceptionBytes: mismatchedExceptions
    })).toThrow("versions do not match");
  });

  test("rejects duplicate identifiers instead of silently deduplicating", () => {
    expect(() => createSpdxCatalogModel({
      sourceCommit: SOURCE_COMMIT,
      licenseBytes: licenseBytes([
        { licenseId: "MIT", isDeprecatedLicenseId: false },
        { licenseId: "MIT", isDeprecatedLicenseId: false }
      ]),
      exceptionBytes: exceptionBytes([
        {
          licenseExceptionId: "Classpath-exception-2.0",
          isDeprecatedLicenseId: false
        }
      ])
    })).toThrow("duplicate identifier MIT");
  });
});
