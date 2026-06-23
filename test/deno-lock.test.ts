import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseDenoLockfile, parseDenoLockText } from "../src/graph/deno-lock";

describe("parseDenoLockfile", () => {
  test("parses npm direct and transitive dependencies from a Deno v4 lockfile", () => {
    const result = parseDenoLockText(
      JSON.stringify({
        version: "4",
        specifiers: {
          "npm:permissive-parent@1.0.0": "1.0.0",
          "npm:gpl-package@5.0.0": "5.0.0"
        },
        npm: {
          "permissive-parent@1.0.0": {
            integrity: "sha512-parent",
            dependencies: {
              "agpl-child": "0.1.0"
            }
          },
          "agpl-child@0.1.0": {
            integrity: "sha512-child"
          },
          "gpl-package@5.0.0": {
            integrity: "sha512-gpl"
          }
        },
        workspace: {
          dependencies: [
            "npm:permissive-parent@1.0.0",
            "npm:gpl-package@5.0.0"
          ]
        }
      }),
      path.join("fixtures", "deno-project", "deno.lock")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("deno-project");
    expect(result.value.lockfilePath).toBe(path.join("fixtures", "deno-project", "deno.lock"));
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "gpl-package@5.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0")).toMatchObject({
      direct: true,
      dependencyType: "production",
      integrity: "sha512-parent",
      paths: [["deno-project", "permissive-parent@1.0.0"]]
    });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0")).toMatchObject({
      direct: false,
      dependencyType: "production",
      integrity: "sha512-child",
      paths: [["deno-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]]
    });
  });

  test("parses nested npm packages from a Deno v3 lockfile", () => {
    const result = parseDenoLockText(
      JSON.stringify({
        version: "3",
        packages: {
          specifiers: {
            "npm:permissive-parent@1.0.0": "npm:permissive-parent@1.0.0"
          },
          npm: {
            "permissive-parent@1.0.0": {
              dependencies: ["agpl-child@0.1.0"]
            },
            "agpl-child@0.1.0": {}
          },
          workspace: {
            dependencies: ["npm:permissive-parent@1.0.0"]
          }
        }
      }),
      path.join("fixtures", "deno-range-project", "deno.lock")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "permissive-parent@1.0.0"
    ]);
  });

  test("resolves object-form npm dependency ranges to locked package records", () => {
    const result = parseDenoLockText(
      JSON.stringify({
        version: "4",
        specifiers: {
          "npm:permissive-parent@1.0.0": "1.0.0"
        },
        npm: {
          "permissive-parent@1.0.0": {
            dependencies: {
              "agpl-child": "^4.3.0"
            }
          },
          "agpl-child@4.3.4": {}
        },
        workspace: {
          dependencies: ["npm:permissive-parent@1.0.0"]
        }
      }),
      path.join("fixtures", "deno-range-project", "deno.lock")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@4.3.4",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "agpl-child@4.3.4")).toMatchObject({
      direct: false,
      dependencyType: "production",
      paths: [["deno-range-project", "permissive-parent@1.0.0", "agpl-child@4.3.4"]]
    });
  });

  test("does not guess when a Deno object-form dependency range has multiple matching records", () => {
    const result = parseDenoLockText(
      JSON.stringify({
        version: "4",
        specifiers: {
          "npm:permissive-parent@1.0.0": "1.0.0"
        },
        npm: {
          "permissive-parent@1.0.0": {
            dependencies: {
              "agpl-child": "^4.3.0"
            }
          },
          "agpl-child@4.3.4": {},
          "agpl-child@4.4.0": {}
        },
        workspace: {
          dependencies: ["npm:permissive-parent@1.0.0"]
        }
      }),
      "deno.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual(["permissive-parent@1.0.0"]);
  });

  test("rejects root non-npm Deno lockfile entries instead of partial scanning", () => {
    const result = parseDenoLockText(
      JSON.stringify({
        version: "4",
        specifiers: {
          "npm:permissive-parent@1.0.0": "1.0.0",
          "jsr:@std/path@1": "1.0.0",
          "https://deno.land/std/path/mod.ts": "https://deno.land/std/path/mod.ts"
        },
        npm: {
          "permissive-parent@1.0.0": {}
        }
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseDenoLockText to fail.");
    }

    expect(result.error.code).toBe("DENO_LOCK_UNSUPPORTED_ROOT_SPECIFIER");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.details?.unsupportedRootSpecifiers).toEqual([
      "https://deno.land/std/path/mod.ts",
      "jsr:@std/path@1"
    ]);
    expect(result.error.details?.jsrRootSpecifiers).toEqual(["jsr:@std/path@1"]);
    expect(result.error.details?.remoteUrlRootSpecifiers).toEqual([
      "https://deno.land/std/path/mod.ts"
    ]);
    expect(result.error.details?.otherUnsupportedRootSpecifiers).toEqual([]);
  });

  test("reports malformed Deno lockfiles as typed errors", () => {
    const result = parseDenoLockText("{", "deno.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseDenoLockText to fail.");
    }

    expect(result.error.code).toBe("DENO_LOCK_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
  });

  test("rejects oversized Deno lockfiles before parsing", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-deno-lock-"));
    const lockfilePath = path.join(projectDir, "deno.lock");
    writeFileSync(lockfilePath, "{}");

    const result = parseDenoLockfile(lockfilePath, { maxBytes: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseDenoLockfile to fail.");
    }

    expect(result.error.code).toBe("DENO_LOCK_READ_FAILED");
    expect(result.error.category).toBe("unsupported_input");
  });
});
