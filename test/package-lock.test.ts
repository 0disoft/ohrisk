import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePackageLockfile, parsePackageLockText } from "../src/graph/npm-package-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parsePackageLockfile", () => {
  test("parses direct and transitive dependencies from a package-lock.json", () => {
    const result = parsePackageLockfile(
      path.join(fixturesDir, "package-lock-project", "package-lock.json")
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-package-lock-project");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "dual-license@2.0.0",
      "gpl-package@5.0.0",
      "missing-license@4.0.0",
      "permissive-parent@1.0.0"
    ]);

    const parent = result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0");
    expect(parent?.direct).toBe(true);
    expect(parent?.dependencyType).toBe("production");
    expect(parent?.resolved).toBe("file:../bun-project/.registry/permissive-parent");
    expect(parent?.paths).toEqual([
      ["fixture-package-lock-project", "permissive-parent@1.0.0"]
    ]);

    const child = result.value.nodes.find((node) => node.id === "agpl-child@0.1.0");
    expect(child?.direct).toBe(false);
    expect(child?.dependencyType).toBe("production");
    expect(child?.paths).toEqual([
      ["fixture-package-lock-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]
    ]);

    const devRisk = result.value.nodes.find((node) => node.id === "dev-risk@3.0.0");
    expect(devRisk?.direct).toBe(true);
    expect(devRisk?.dependencyType).toBe("development");
  });

  test("reports malformed package-lock files as typed errors", () => {
    const result = parsePackageLockText("{ this is not json", "broken-package-lock.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("PACKAGE_LOCK_PARSE_FAILED");
  });

  test("rejects old package-lock shapes without package records", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "old-lock",
        lockfileVersion: 1,
        dependencies: {}
      }),
      "package-lock-v1.json"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unsupported old lockfile to fail.");
    }

    expect(result.error.code).toBe("PACKAGE_LOCK_PARSE_FAILED");
  });
});
