import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBunLockfile, parseBunLockText } from "../src/graph/npm-bun-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseBunLockfile", () => {
  test("parses direct and transitive dependencies from a Bun lockfile", () => {
    const result = parseBunLockfile(path.join(fixturesDir, "bun-project", "bun.lock"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-bun-project");
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
    expect(parent?.paths).toEqual([["fixture-bun-project", "permissive-parent@1.0.0"]]);

    const child = result.value.nodes.find((node) => node.id === "agpl-child@0.1.0");
    expect(child?.direct).toBe(false);
    expect(child?.dependencyType).toBe("production");
    expect(child?.paths).toEqual([
      ["fixture-bun-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]
    ]);

    const devRisk = result.value.nodes.find((node) => node.id === "dev-risk@3.0.0");
    expect(devRisk?.dependencyType).toBe("development");

    const missingLicense = result.value.nodes.find((node) => node.id === "missing-license@4.0.0");
    expect(missingLicense?.direct).toBe(true);
    expect(missingLicense?.dependencyType).toBe("production");
    expect(missingLicense?.paths).toEqual([["fixture-bun-project", "missing-license@4.0.0"]]);

    const gplPackage = result.value.nodes.find((node) => node.id === "gpl-package@5.0.0");
    expect(gplPackage?.direct).toBe(true);
    expect(gplPackage?.dependencyType).toBe("production");
    expect(gplPackage?.paths).toEqual([["fixture-bun-project", "gpl-package@5.0.0"]]);
  });

  test("reports malformed Bun lockfiles as typed errors", () => {
    const result = parseBunLockText("{ this is not json", "broken-bun.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("BUN_LOCK_PARSE_FAILED");
  });

  test("resolves npm alias dependencies to the actual package identity", () => {
    const result = parseBunLockText(
      JSON.stringify({
        workspaces: {
          "": {
            name: "fixture-bun-alias-project",
            dependencies: {
              "compat-parent": "npm:permissive-parent@1.0.0"
            }
          }
        },
        packages: {
          "compat-parent": [
            "npm:permissive-parent@1.0.0",
            "file:../bun-project/.registry/permissive-parent",
            {
              dependencies: {
                "compat-child": "npm:agpl-child@0.1.0"
              }
            }
          ],
          "compat-child": [
            "npm:agpl-child@0.1.0",
            "file:../bun-project/.registry/agpl-child",
            {}
          ]
        }
      }),
      "alias-bun.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        name: "permissive-parent",
        installNames: ["compat-parent"],
        direct: true,
        paths: [["fixture-bun-alias-project", "compat-parent -> permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        name: "agpl-child",
        installNames: ["compat-child"],
        direct: false,
        paths: [[
          "fixture-bun-alias-project",
          "compat-parent -> permissive-parent@1.0.0",
          "compat-child -> agpl-child@0.1.0"
        ]]
      });
  });

  test("preserves nested optional and peer dependency edge types", () => {
    const result = parseBunLockText(
      JSON.stringify({
        workspaces: {
          "": {
            name: "fixture-bun-nested-edges",
            dependencies: {
              "prod-parent": "1.0.0"
            }
          }
        },
        packages: {
          "prod-parent": [
            "prod-parent@1.0.0",
            "",
            {
              dependencies: {
                "regular-child": "1.0.0"
              },
              optionalDependencies: {
                "optional-child": "1.0.0"
              },
              peerDependencies: {
                "peer-child": "1.0.0"
              }
            }
          ],
          "regular-child": [
            "regular-child@1.0.0",
            "",
            {}
          ],
          "optional-child": [
            "optional-child@1.0.0",
            "",
            {}
          ],
          "peer-child": [
            "peer-child@1.0.0",
            "",
            {}
          ]
        }
      }),
      "nested-edges-bun.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "optional-child@1.0.0",
      "peer-child@1.0.0",
      "prod-parent@1.0.0",
      "regular-child@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "prod-parent@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["fixture-bun-nested-edges", "prod-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "regular-child@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [[
          "fixture-bun-nested-edges",
          "prod-parent@1.0.0",
          "regular-child@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "optional-child@1.0.0"))
      .toMatchObject({
        dependencyType: "optional",
        direct: false,
        paths: [[
          "fixture-bun-nested-edges",
          "prod-parent@1.0.0",
          "optional-child@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "peer-child@1.0.0"))
      .toMatchObject({
        dependencyType: "peer",
        direct: false,
        paths: [[
          "fixture-bun-nested-edges",
          "prod-parent@1.0.0",
          "peer-child@1.0.0"
        ]]
      });
  });

  test("uses every Bun workspace as a dependency graph root", () => {
    const result = parseBunLockText(
      JSON.stringify({
        workspaces: {
          "apps/web": {
            name: "web-app",
            dependencies: {
              "workspace-prod": "1.0.0"
            }
          },
          "packages/tools": {
            name: "tooling",
            devDependencies: {
              "workspace-dev": "2.0.0"
            }
          }
        },
        packages: {
          "workspace-prod": [
            "workspace-prod@1.0.0",
            "",
            {
              dependencies: {
                "workspace-child": "0.1.0"
              }
            }
          ],
          "workspace-child": [
            "workspace-child@0.1.0",
            "",
            {}
          ],
          "workspace-dev": [
            "workspace-dev@2.0.0",
            "",
            {}
          ]
        }
      }),
      "multi-workspace-bun.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBeUndefined();
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "workspace-child@0.1.0",
      "workspace-dev@2.0.0",
      "workspace-prod@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "workspace-prod@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["web-app", "workspace-prod@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-child@0.1.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["web-app", "workspace-prod@1.0.0", "workspace-child@0.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-dev@2.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["tooling", "workspace-dev@2.0.0"]]
      });
  });
});
