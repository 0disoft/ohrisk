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

  test("rejects oversized Yarn lockfiles before parsing", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-lock-size-"));
    const lockfilePath = path.join(projectRoot, "yarn.lock");
    const packageJsonPath = path.join(projectRoot, "package.json");

    try {
      writeFileSync(lockfilePath, Buffer.alloc(9));
      writeFileSync(packageJsonPath, JSON.stringify({ name: "fixture-yarn-size" }), "utf8");

      const result = parseYarnLockfile(lockfilePath, packageJsonPath, {
        lockfileMaxBytes: 8
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized Yarn lockfile to fail.");
      }

      expect(result.error.code).toBe("YARN_LOCK_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe("yarn.lock exceeded the maximum supported size.");
      expect(result.error.details).toMatchObject({
        lockfilePath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects oversized Yarn root package manifests before parsing", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-root-package-size-"));
    const lockfilePath = path.join(projectRoot, "yarn.lock");
    const packageJsonPath = path.join(projectRoot, "package.json");

    try {
      writeFileSync(lockfilePath, "", "utf8");
      writeFileSync(packageJsonPath, Buffer.alloc(9));

      const result = parseYarnLockfile(lockfilePath, packageJsonPath, {
        packageJsonMaxBytes: 8
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized Yarn package.json to fail.");
      }

      expect(result.error.code).toBe("YARN_PACKAGE_JSON_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe(
        "package.json for yarn.lock root dependencies exceeded the maximum supported size."
      );
      expect(result.error.details).toMatchObject({
        lockfilePath,
        packageJsonPath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects oversized Yarn workspace package manifests before parsing", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-workspace-size-"));
    const workspaceDir = path.join(projectRoot, "packages", "app");
    const lockfilePath = path.join(projectRoot, "yarn.lock");
    const packageJsonPath = path.join(projectRoot, "package.json");
    const workspacePackageJsonPath = path.join(workspaceDir, "package.json");

    try {
      mkdirSync(workspaceDir, { recursive: true });
      writeFileSync(lockfilePath, "", "utf8");
      writeFileSync(
        packageJsonPath,
        JSON.stringify({
          workspaces: ["packages/*"]
        }),
        "utf8"
      );
      writeFileSync(workspacePackageJsonPath, Buffer.alloc(81));

      const result = parseYarnLockfile(lockfilePath, packageJsonPath, {
        packageJsonMaxBytes: 80
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized Yarn workspace package.json to fail.");
      }

      expect(result.error.code).toBe("YARN_WORKSPACE_PACKAGE_JSON_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe(
        "package.json for a Yarn workspace dependency root exceeded the maximum supported size."
      );
      expect(result.error.details).toMatchObject({
        lockfilePath,
        packageJsonPath: workspacePackageJsonPath,
        maxBytes: 80,
        observedBytes: 81
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
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

  test("does not link ambiguous Yarn dependency ranges by package name fallback", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-ambiguous-project",
        dependencies: {
          ambiguous: "^3.0.0"
        }
      }),
      lockfileText: [
        "ambiguous@1.0.0:",
        "  version \"1.0.0\"",
        "  resolved \"file:../bun-project/.registry/ambiguous-1\"",
        "",
        "ambiguous@2.0.0:",
        "  version \"2.0.0\"",
        "  resolved \"file:../bun-project/.registry/ambiguous-2\""
      ].join("\n"),
      lockfilePath: "ambiguous-yarn.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([]);
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

  test("parses npm, alias, and patch records from a Yarn Berry lockfile", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-berry-project",
        dependencies: {
          "prod-parent": "^1.0.0",
          "patched-child": "patch:patched-child@npm%3A2.0.0#./patched-child.patch",
          "alias-parent": "npm:actual-parent@^3.0.0"
        },
        devDependencies: {
          "dev-tool": "^4.0.0"
        }
      }),
      lockfileText: [
        "__metadata:",
        "  version: 8",
        "  cacheKey: 10",
        "",
        "\"prod-parent@npm:^1.0.0\":",
        "  version: 1.0.1",
        "  resolution: \"prod-parent@npm:1.0.1\"",
        "  dependencies:",
        "    regular-child: \"npm:^0.5.0\"",
        "",
        "\"regular-child@npm:^0.5.0\":",
        "  version: 0.5.1",
        "  resolution: \"regular-child@npm:0.5.1\"",
        "",
        "\"patched-child@patch:patched-child@npm%3A2.0.0#./patched-child.patch\":",
        "  version: 2.0.0",
        "  resolution: \"patched-child@patch:patched-child@npm%3A2.0.0#./patched-child.patch::version=2.0.0&hash=abc123\"",
        "",
        "\"alias-parent@npm:actual-parent@^3.0.0\":",
        "  version: 3.1.0",
        "  resolution: \"actual-parent@npm:3.1.0\"",
        "",
        "\"dev-tool@npm:^4.0.0\":",
        "  version: 4.2.0",
        "  resolution: \"dev-tool@npm:4.2.0\"",
        "",
        "\"workspace-local@workspace:*\":",
        "  version: 0.0.0-use.local",
        "  resolution: \"workspace-local@workspace:packages/local\""
      ].join("\n"),
      lockfilePath: "berry-yarn.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "actual-parent@3.1.0",
      "dev-tool@4.2.0",
      "patched-child@2.0.0",
      "prod-parent@1.0.1",
      "regular-child@0.5.1"
    ]);
    expect(result.value.nodes.find((node) => node.id === "actual-parent@3.1.0"))
      .toMatchObject({
        name: "actual-parent",
        installNames: ["alias-parent"],
        direct: true,
        paths: [["fixture-yarn-berry-project", "alias-parent -> actual-parent@3.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "regular-child@0.5.1"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [[
          "fixture-yarn-berry-project",
          "prod-parent@1.0.1",
          "regular-child@0.5.1"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "dev-tool@4.2.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true
      });
  });

  test("uses Yarn Berry workspace manifests as roots without scanning workspace packages as npm packages", () => {
    const result = parseYarnLockText({
      packageJsonText: JSON.stringify({
        name: "fixture-yarn-berry-workspaces",
        private: true,
        workspaces: [
          "packages/*"
        ],
        dependencies: {
          "root-prod": "^1.0.0"
        }
      }),
      workspacePackageJsonTexts: [
        {
          packageJsonPath: "packages/web/package.json",
          workspacePath: "packages/web",
          packageJsonText: JSON.stringify({
            name: "workspace-web",
            dependencies: {
              "workspace-prod": "^2.0.0",
              "workspace-local": "workspace:*"
            }
          })
        }
      ],
      lockfileText: [
        "__metadata:",
        "  version: 8",
        "  cacheKey: 10",
        "",
        "\"root-prod@npm:^1.0.0\":",
        "  version: 1.0.1",
        "  resolution: \"root-prod@npm:1.0.1\"",
        "",
        "\"workspace-prod@npm:^2.0.0\":",
        "  version: 2.0.1",
        "  resolution: \"workspace-prod@npm:2.0.1\"",
        "",
        "\"workspace-local@workspace:*, workspace-local@workspace:packages/local\":",
        "  version: 0.0.0-use.local",
        "  resolution: \"workspace-local@workspace:packages/local\"",
        "  dependencies:",
        "    hidden-workspace-dep: \"npm:^9.0.0\"",
        "",
        "\"hidden-workspace-dep@npm:^9.0.0\":",
        "  version: 9.0.1",
        "  resolution: \"hidden-workspace-dep@npm:9.0.1\""
      ].join("\n"),
      lockfilePath: "berry-workspace-yarn.lock"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "root-prod@1.0.1",
      "workspace-prod@2.0.1"
    ]);
    expect(result.value.nodes.find((node) => node.id === "root-prod@1.0.1"))
      .toMatchObject({
        direct: true,
        paths: [["fixture-yarn-berry-workspaces", "root-prod@1.0.1"]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-prod@2.0.1"))
      .toMatchObject({
        direct: true,
        paths: [["workspace-web", "workspace-prod@2.0.1"]]
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

  test("ignores Yarn workspace patterns that resolve outside the project root", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-yarn-outside-workspace-"));
    const projectDir = path.join(tempRoot, "project");
    const outsideDir = path.join(tempRoot, "outside");

    try {
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({
          name: "fixture-yarn-outside-workspace",
          private: true,
          workspaces: [
            "../outside"
          ]
        })
      );
      writeFileSync(
        path.join(outsideDir, "package.json"),
        JSON.stringify({
          name: "outside-workspace",
          dependencies: {
            "outside-risk": "9.9.9"
          }
        })
      );
      writeFileSync(
        path.join(projectDir, "yarn.lock"),
        [
          "outside-risk@9.9.9:",
          "  version \"9.9.9\""
        ].join("\n")
      );

      const result = parseYarnLockfile(path.join(projectDir, "yarn.lock"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.nodes).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
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
