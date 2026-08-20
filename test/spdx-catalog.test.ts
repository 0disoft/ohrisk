import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  SPDX_ACTIVE_EXCEPTION_ID_COUNT,
  SPDX_ACTIVE_LICENSE_ID_COUNT,
  SPDX_DEPRECATED_EXCEPTION_ID_COUNT,
  SPDX_DEPRECATED_LICENSE_ID_COUNT,
  SPDX_EXCEPTION_LIST_BLOB_SHA,
  SPDX_LICENSE_LIST_BLOB_SHA,
  SPDX_LICENSE_LIST_RELEASE_DATE,
  SPDX_LICENSE_LIST_SOURCE_COMMIT,
  SPDX_LICENSE_LIST_VERSION,
  spdxExceptionIdStatus,
  spdxLicenseIdStatus
} from "../src/license/spdx-catalog";

const catalogSource = readFileSync(
  new URL("../src/license/spdx-catalog.ts", import.meta.url),
  "utf8"
);

describe("SPDX catalog", () => {
  test("records reviewed source identities and self-consistent identifier counts", () => {
    expect(SPDX_LICENSE_LIST_VERSION).toMatch(/^[0-9A-Za-z.-]+$/);
    expect(SPDX_LICENSE_LIST_RELEASE_DATE).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
    );
    expect(Number.isNaN(Date.parse(SPDX_LICENSE_LIST_RELEASE_DATE))).toBe(false);
    expect(SPDX_LICENSE_LIST_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(SPDX_LICENSE_LIST_BLOB_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(SPDX_EXCEPTION_LIST_BLOB_SHA).toMatch(/^[0-9a-f]{40}$/);

    expect(countIdentifierSet("ACTIVE_SPDX_LICENSE_IDS")).toBe(
      SPDX_ACTIVE_LICENSE_ID_COUNT
    );
    expect(countIdentifierSet("DEPRECATED_SPDX_LICENSE_IDS")).toBe(
      SPDX_DEPRECATED_LICENSE_ID_COUNT
    );
    expect(countIdentifierSet("ACTIVE_SPDX_EXCEPTION_IDS")).toBe(
      SPDX_ACTIVE_EXCEPTION_ID_COUNT
    );
    expect(countIdentifierSet("DEPRECATED_SPDX_EXCEPTION_IDS")).toBe(
      SPDX_DEPRECATED_EXCEPTION_ID_COUNT
    );
    expect(SPDX_ACTIVE_LICENSE_ID_COUNT).toBeGreaterThan(0);
    expect(SPDX_ACTIVE_EXCEPTION_ID_COUNT).toBeGreaterThan(0);
  });

  test("distinguishes active, deprecated, and unlisted identifiers", () => {
    expect(spdxLicenseIdStatus("3D-Slicer-1.0")).toBe("active");
    expect(spdxLicenseIdStatus("GPL-2.0")).toBe("deprecated");
    expect(spdxLicenseIdStatus("MIT+")).toBe("active");
    expect(spdxLicenseIdStatus("Definitely-Not-A-License-1.0")).toBe("unlisted");
    expect(spdxExceptionIdStatus("Classpath-exception-2.0")).toBe("active");
    expect(spdxExceptionIdStatus("Nokia-Qt-exception-1.1")).toBe("deprecated");
    expect(spdxExceptionIdStatus("Imaginary-exception")).toBe("unlisted");
  });
});

function countIdentifierSet(name: string): number {
  const match = new RegExp(
    `const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`
  ).exec(catalogSource);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`Missing generated SPDX identifier set ${name}.`);
  }
  const entries = body.trim();
  if (entries.length === 0) {
    return 0;
  }
  const parsed: unknown = JSON.parse(`[${entries.replace(/,\s*$/, "")}]`);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Generated SPDX identifier set ${name} is invalid.`);
  }
  return parsed.length;
}
