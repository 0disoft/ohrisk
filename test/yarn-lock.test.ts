import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseYarnLockfile, parseYarnLockText } from "../src/graph/npm-yarn-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const yarnProjectDir = path.join(fixturesDir, "yarn-project");

describe("parseYarnLockfile", () => {
  test("parses direct and transitive dependencies from a Yarn v1 lockfile", () => {
    const result = parseYarnLockfile(path.join(yarnProjectDir, "yarn.lock"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-yarn-project");
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
      ["fixture-yarn-project", "permissive-parent@1.0.0"]
    ]);

    const child = result.value.nodes.find((node) => node.id === "agpl-child@0.1.0");
    expect(child?.direct).toBe(false);
    expect(child?.dependencyType).toBe("production");
    expect(child?.resolved).toBe("file:../bun-project/.registry/agpl-child");
    expect(child?.paths).toEqual([
      ["fixture-yarn-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]
    ]);

    const devRisk = result.value.nodes.find((node) => node.id === "dev-risk@3.0.0");
    expect(devRisk?.direct).toBe(true);
    expect(devRisk?.dependencyType).toBe("development");
  });

  test("reports malformed yarn lockfiles as typed errors", () => {
    const result = parseYarnLockText({
      lockfileText: "<<<<<<< HEAD\nleft-pad@^1.0.0:\n=======\nright-pad@^1.0.0:\n>>>>>>> branch\n",
      packageJsonText: readFileSync(path.join(yarnProjectDir, "package.json"), "utf8"),
      lockfilePath: "broken-yarn.lock"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("YARN_LOCK_PARSE_FAILED");
  });

  test("reports malformed package manifests as typed errors", () => {
    const result = parseYarnLockText({
      lockfileText: readFileSync(path.join(yarnProjectDir, "yarn.lock"), "utf8"),
      packageJsonText: "{ this is not json",
      packageJsonPath: "broken-package.json"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed package.json to fail.");
    }

    expect(result.error.code).toBe("YARN_PACKAGE_JSON_PARSE_FAILED");
  });

  test("resolves npm alias dependencies to the actual package identity", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-alias-project",
        dependencies: {
          "compat-parent": "npm:permissive-parent@1.0.0"
        }
      }),
      lockfileText: [
        "\"compat-parent@npm:permissive-parent@1.0.0\":",
        "  version \"1.0.0\"",
        "  resolved \"file:../bun-project/.registry/permissive-parent\"",
        "  dependencies:",
        "    compat-child \"npm:agpl-child@0.1.0\"",
        "",
        "\"compat-child@npm:agpl-child@0.1.0\":",
        "  version \"0.1.0\"",
        "  resolved \"file:../bun-project/.registry/agpl-child\""
      ].join("\n"),
      lockfilePath: "alias-yarn.lock"
    });

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
        paths: [["fixture-yarn-alias-project", "compat-parent -> permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        name: "agpl-child",
        installNames: ["compat-child"],
        direct: false,
        paths: [[
          "fixture-yarn-alias-project",
          "compat-parent -> permissive-parent@1.0.0",
          "compat-child -> agpl-child@0.1.0"
        ]]
      });
  });

  test("keeps nested optional dependency edges from Yarn v1 entries", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-nested-optional-project",
        dependencies: {
          "prod-parent": "1.0.0"
        }
      }),
      lockfileText: [
        "prod-parent@1.0.0:",
        "  version \"1.0.0\"",
        "  dependencies:",
        "    regular-child \"1.0.0\"",
        "  optionalDependencies:",
        "    optional-child \"1.0.0\"",
        "",
        "regular-child@1.0.0:",
        "  version \"1.0.0\"",
        "",
        "optional-child@1.0.0:",
        "  version \"1.0.0\""
      ].join("\n"),
      lockfilePath: "nested-optional-yarn.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "optional-child@1.0.0",
      "prod-parent@1.0.0",
      "regular-child@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "regular-child@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [[
          "fixture-yarn-nested-optional-project",
          "prod-parent@1.0.0",
          "regular-child@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "optional-child@1.0.0"))
      .toMatchObject({
        dependencyType: "optional",
        direct: false,
        paths: [[
          "fixture-yarn-nested-optional-project",
          "prod-parent@1.0.0",
          "optional-child@1.0.0"
        ]]
      });
  });

  test("uses every provided Yarn workspace package manifest as a dependency graph root", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-workspaces",
        private: true,
        workspaces: [
          "apps/*",
          "packages/*"
        ]
      }),
      workspacePackageJsonTexts: [
        {
          packageJsonPath: "apps/web/package.json",
          workspacePath: "apps/web",
          packageJsonText: JSON.stringify({
            name: "workspace-web",
            dependencies: {
              "workspace-prod": "1.0.0"
            }
          })
        },
        {
          packageJsonPath: "packages/tools/package.json",
          workspacePath: "packages/tools",
          packageJsonText: JSON.stringify({
            name: "workspace-tools",
            devDependencies: {
              "workspace-dev": "2.0.0"
            }
          })
        }
      ],
      lockfileText: yarnWorkspaceLockfileText(),
      lockfilePath: "workspace-yarn.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-yarn-workspaces");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "workspace-child@0.1.0",
      "workspace-dev@2.0.0",
      "workspace-prod@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "workspace-prod@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["workspace-web", "workspace-prod@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-child@0.1.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["workspace-web", "workspace-prod@1.0.0", "workspace-child@0.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-dev@2.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["workspace-tools", "workspace-dev@2.0.0"]]
      });
  });

  test("reads Yarn workspace package manifests from disk", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-workspace-"));

    try {
      mkdirSync(path.join(projectDir, "apps", "web"), { recursive: true });
      mkdirSync(path.join(projectDir, "packages", "tools"), { recursive: true });
      mkdirSync(path.join(projectDir, "packages", "skip"), { recursive: true });
      writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({
          name: "fixture-yarn-workspaces",
          private: true,
          workspaces: {
            packages: [
              "apps/*",
              "packages/*",
              "!packages/skip"
            ]
          }
        })
      );
      writeFileSync(
        path.join(projectDir, "apps", "web", "package.json"),
        JSON.stringify({
          name: "workspace-web",
          dependencies: {
            "workspace-prod": "1.0.0"
          }
        })
      );
      writeFileSync(
        path.join(projectDir, "packages", "tools", "package.json"),
        JSON.stringify({
          name: "workspace-tools",
          devDependencies: {
            "workspace-dev": "2.0.0"
          }
        })
      );
      writeFileSync(
        path.join(projectDir, "packages", "skip", "package.json"),
        JSON.stringify({
          name: "workspace-skip",
          dependencies: {
            "skipped-risk": "9.9.9"
          }
        })
      );
      writeFileSync(path.join(projectDir, "yarn.lock"), yarnWorkspaceLockfileText());

      const result = parseYarnLockfile(path.join(projectDir, "yarn.lock"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes.map((node) => node.id)).toEqual([
        "workspace-child@0.1.0",
        "workspace-dev@2.0.0",
        "workspace-prod@1.0.0"
      ]);
      expect(result.value.nodes.find((node) => node.id === "workspace-prod@1.0.0"))
        .toMatchObject({
          direct: true,
          paths: [["workspace-web", "workspace-prod@1.0.0"]]
        });
      expect(result.value.nodes.find((node) => node.id === "workspace-dev@2.0.0"))
        .toMatchObject({
          dependencyType: "development",
          direct: true,
          paths: [["workspace-tools", "workspace-dev@2.0.0"]]
        });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function yarnWorkspaceLockfileText(): string {
  return [
    "workspace-prod@1.0.0:",
    "  version \"1.0.0\"",
    "  dependencies:",
    "    workspace-child \"0.1.0\"",
    "",
    "workspace-child@0.1.0:",
    "  version \"0.1.0\"",
    "",
    "workspace-dev@2.0.0:",
    "  version \"2.0.0\""
  ].join("\n");
}
