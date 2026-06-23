import { describe, expect, test } from "bun:test";

import { parseConanLockText } from "../src/graph/conan-lock";

describe("parseConanLockText", () => {
  test("parses Conan 2 recipe references from requires arrays", () => {
    const result = parseConanLockText(JSON.stringify({
      version: "0.5",
      requires: [
        "openssl/3.0.3#recipe-revision%1670000000",
        "zlib/1.2.13@conan/stable#another-revision"
      ],
      build_requires: [
        "cmake/3.27.0#tool-revision"
      ],
      python_requires: [
        "pyreq/1.0.0"
      ]
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("conan.lock");
    expect(result.value.nodes).toEqual([
      {
        id: "cmake@3.27.0",
        name: "cmake",
        version: "3.27.0",
        ecosystem: "conan",
        dependencyType: "development",
        direct: true,
        paths: [[".", "cmake@3.27.0"]]
      },
      {
        id: "openssl@3.0.3",
        name: "openssl",
        version: "3.0.3",
        ecosystem: "conan",
        dependencyType: "production",
        direct: true,
        paths: [[".", "openssl@3.0.3"]]
      },
      {
        id: "pyreq@1.0.0",
        name: "pyreq",
        version: "1.0.0",
        ecosystem: "conan",
        dependencyType: "development",
        direct: true,
        paths: [[".", "pyreq@1.0.0"]]
      },
      {
        id: "zlib@1.2.13",
        name: "zlib",
        version: "1.2.13",
        ecosystem: "conan",
        dependencyType: "production",
        direct: true,
        paths: [[".", "zlib@1.2.13"]]
      }
    ]);
  });

  test("keeps production type when a recipe appears in multiple sections", () => {
    const result = parseConanLockText(JSON.stringify({
      version: "0.5",
      requires: ["risklib/1.0.0"],
      build_requires: ["risklib/1.0.0#build-revision"]
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "risklib@1.0.0",
        name: "risklib",
        version: "1.0.0",
        ecosystem: "conan",
        dependencyType: "production",
        direct: true,
        paths: [[".", "risklib@1.0.0"]]
      }
    ]);
  });

  test("reports malformed Conan recipe references as typed errors", () => {
    const result = parseConanLockText(JSON.stringify({
      version: "0.5",
      requires: ["risklib"]
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("CONAN_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "conan.lock",
      field: "requires",
      index: 0,
      reason: "entry_not_recipe_reference",
      entry: "risklib"
    });
  });

  test("reports lockfiles without supported require arrays as typed errors", () => {
    const result = parseConanLockText(JSON.stringify({
      version: "0.5"
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("CONAN_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "conan.lock",
      reason: "no_supported_requires"
    });
  });
});
