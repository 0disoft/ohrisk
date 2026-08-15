import { describe, expect, test } from "bun:test";

import {
  SPDX_ACTIVE_EXCEPTION_ID_COUNT,
  SPDX_ACTIVE_LICENSE_ID_COUNT,
  SPDX_DEPRECATED_EXCEPTION_ID_COUNT,
  SPDX_DEPRECATED_LICENSE_ID_COUNT,
  SPDX_EXCEPTION_LIST_BLOB_SHA,
  SPDX_LICENSE_LIST_BLOB_SHA,
  SPDX_LICENSE_LIST_SOURCE_COMMIT,
  SPDX_LICENSE_LIST_VERSION,
  spdxExceptionIdStatus,
  spdxLicenseIdStatus
} from "../src/license/spdx-catalog";

describe("SPDX catalog", () => {
  test("pins the reviewed official license-list-data build", () => {
    expect({
      version: SPDX_LICENSE_LIST_VERSION,
      sourceCommit: SPDX_LICENSE_LIST_SOURCE_COMMIT,
      licenseBlob: SPDX_LICENSE_LIST_BLOB_SHA,
      exceptionBlob: SPDX_EXCEPTION_LIST_BLOB_SHA,
      activeLicenses: SPDX_ACTIVE_LICENSE_ID_COUNT,
      deprecatedLicenses: SPDX_DEPRECATED_LICENSE_ID_COUNT,
      activeExceptions: SPDX_ACTIVE_EXCEPTION_ID_COUNT,
      deprecatedExceptions: SPDX_DEPRECATED_EXCEPTION_ID_COUNT
    }).toEqual({
      version: "e4c1f27",
      sourceCommit: "5bf6d9610255540bfbee6890765a616042bf1e11",
      licenseBlob: "becdf59af417b31717b4139e5b65e089548fdb4a",
      exceptionBlob: "b177ea5ea17e42377ff8edfb1a3d2b1db34b764b",
      activeLicenses: 701,
      deprecatedLicenses: 32,
      activeExceptions: 85,
      deprecatedExceptions: 1
    });
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
