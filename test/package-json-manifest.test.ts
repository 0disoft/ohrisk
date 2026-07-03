import { describe, expect, test } from "bun:test";

import { parsePackageJsonManifestText } from "../src/graph/npm-package-json";

describe("parsePackageJsonManifestText", () => {
  test("parses dependency-free package.json manifests as an empty dependency graph", () => {
    const result = parsePackageJsonManifestText(
      JSON.stringify({
        name: "fixture-empty-manifest",
        private: true,
        scripts: {
          check: "echo ok"
        }
      }),
      "package.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toEqual({
      rootName: "fixture-empty-manifest",
      lockfilePath: "package.json",
      nodes: []
    });
  });

  test("rejects package.json dependency projects without a supported lockfile", () => {
    const result = parsePackageJsonManifestText(
      JSON.stringify({
        name: "fixture-needs-lockfile",
        dependencies: {
          leftpad: "1.3.0"
        }
      }),
      "package.json"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected package.json dependency manifest to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
    expect(result.error.message).toContain("package.json declares dependencies");
    expect(result.error.details).toMatchObject({
      dependencyFields: ["dependencies"]
    });
  });

  test("treats workspaces as requiring a supported lockfile", () => {
    const result = parsePackageJsonManifestText(
      JSON.stringify({
        name: "fixture-workspace-manifest",
        private: true,
        workspaces: ["apps/*"]
      }),
      "package.json"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected package.json workspace manifest to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
    expect(result.error.details).toMatchObject({
      dependencyFields: ["workspaces"]
    });
  });
});
