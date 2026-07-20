import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-cycle",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture-package-lock-cycle",
            dependencies: {
              parent: "1.0.0"
            }
          },
          "node_modules/child": {
            name: "child",
            version: "2.0.0",
            dependencies: {
              parent: "1.0.0"
            }
          },
          "node_modules/parent": {
            name: "parent",
            version: "1.0.0",
            dependencies: {
              child: "2.0.0"
            }
          }
        }
      }),
      "package-lock-cycle.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["fixture-package-lock-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["fixture-package-lock-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
  });

  test("uses exact transitive package license metadata embedded in modern package locks", () => {
    const result = parsePackageLockText(JSON.stringify({
      name: "fixture-package-lock-license-metadata",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture-package-lock-license-metadata",
          dependencies: {
            parent: "1.0.0"
          }
        },
        "node_modules/parent": {
          name: "parent",
          version: "1.0.0",
          license: "Apache-2.0",
          dependencies: {
            child: "2.0.0"
          }
        },
        "node_modules/child": {
          name: "child",
          version: "2.0.0",
          license: "MIT"
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.embeddedEvidence).toEqual([
      {
        packageId: "child@2.0.0",
        metadataLicense: "MIT",
        metadataSource: "package-lock.json",
        files: [],
        source: "local",
        warnings: []
      },
      {
        packageId: "parent@1.0.0",
        metadataLicense: "Apache-2.0",
        metadataSource: "package-lock.json",
        files: [],
        source: "local",
        warnings: []
      }
    ]);
  });

  test("bounds dependency path fan-out while retaining every reachable package", () => {
    const layerCount = 10;
    const packages: Record<string, unknown> = {
      "": {
        name: "bounded-package-lock",
        dependencies: {
          "layer-0-a": "1.0.0",
          "layer-0-b": "1.0.0"
        }
      }
    };
    for (let layer = 0; layer < layerCount; layer += 1) {
      for (const branch of ["a", "b"]) {
        packages[`node_modules/layer-${layer}-${branch}`] = {
          name: `layer-${layer}-${branch}`,
          version: "1.0.0",
          dependencies: layer === layerCount - 1
            ? { leaf: "1.0.0" }
            : {
                [`layer-${layer + 1}-a`]: "1.0.0",
                [`layer-${layer + 1}-b`]: "1.0.0"
              }
        };
      }
    }
    packages["node_modules/leaf"] = {
      name: "leaf",
      version: "1.0.0"
    };

    const result = parsePackageLockText(JSON.stringify({
      name: "bounded-package-lock",
      lockfileVersion: 3,
      packages
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength((layerCount * 2) + 1);
    expect(result.value.nodes.find((node) => node.id === "leaf@1.0.0")?.paths)
      .toHaveLength(64);
    expect(result.value.diagnostics).toEqual([{
      code: "dependency_paths_truncated",
      affectedNodeCount: 7,
      limit: 64,
      message: "npm dependency paths were limited."
    }]);
  });

  test("reports malformed package-lock files as typed errors", () => {
    const result = parsePackageLockText("{ this is not json", "broken-package-lock.json");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("PACKAGE_LOCK_PARSE_FAILED");
  });

  test("parses npm-shrinkwrap.json with the package-lock parser", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-npm-shrinkwrap-project",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture-npm-shrinkwrap-project",
            dependencies: {
              "prod-package": "1.0.0"
            }
          },
          "node_modules/prod-package": {
            name: "prod-package",
            version: "1.0.0"
          }
        }
      }),
      "npm-shrinkwrap.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("npm-shrinkwrap.json");
    expect(result.value.rootName).toBe("fixture-npm-shrinkwrap-project");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "prod-package@1.0.0",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-npm-shrinkwrap-project", "prod-package@1.0.0"]]
      })
    ]);
  });

  test("rejects oversized package-lock files before parsing", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-package-lock-size-"));
    const lockfilePath = path.join(projectRoot, "package-lock.json");

    try {
      writeFileSync(lockfilePath, Buffer.alloc(9));

      const result = parsePackageLockfile(lockfilePath, { maxBytes: 8 });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized package-lock file to fail.");
      }

      expect(result.error.code).toBe("PACKAGE_LOCK_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe(
        "package-lock.json exceeded the maximum supported size."
      );
      expect(result.error.details).toMatchObject({
        lockfilePath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("parses old package-lock v1 dependency trees", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-v1",
        lockfileVersion: 1,
        dependencies: {
          "permissive-parent": {
            version: "1.0.0",
            resolved: "file:../bun-project/.registry/permissive-parent",
            requires: {
              "agpl-child": "0.1.0",
              "optional-child": "2.0.0"
            },
            dependencies: {
              "agpl-child": {
                version: "0.1.0",
                resolved: "file:../bun-project/.registry/agpl-child"
              },
              "optional-child": {
                version: "2.0.0",
                resolved: "file:../bun-project/.registry/optional-child",
                optional: true
              }
            }
          },
          "dev-risk": {
            version: "3.0.0",
            resolved: "file:../bun-project/.registry/dev-risk",
            dev: true
          }
        }
      }),
      "package-lock-v1.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-package-lock-v1");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "optional-child@2.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0"))
      .toMatchObject({
        direct: true,
        dependencyType: "production",
        paths: [["fixture-package-lock-v1", "permissive-parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        direct: false,
        dependencyType: "production",
        paths: [["fixture-package-lock-v1", "permissive-parent@1.0.0", "agpl-child@0.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "dev-risk@3.0.0"))
      .toMatchObject({
        direct: true,
        dependencyType: "development"
      });
    expect(result.value.nodes.find((node) => node.id === "optional-child@2.0.0"))
      .toMatchObject({
        direct: false,
        dependencyType: "optional",
        paths: [[
          "fixture-package-lock-v1",
          "permissive-parent@1.0.0",
          "optional-child@2.0.0"
        ]]
      });
  });

  test("stops walking package-lock v1 dependency cycles without dropping reachable paths", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-v1-cycle",
        lockfileVersion: 1,
        dependencies: {
          parent: {
            version: "1.0.0",
            requires: {
              child: "2.0.0"
            },
            dependencies: {
              child: {
                version: "2.0.0",
                requires: {
                  parent: "1.0.0"
                }
              }
            }
          }
        }
      }),
      "package-lock-v1-cycle.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "parent@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["fixture-package-lock-v1-cycle", "parent@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "child@2.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["fixture-package-lock-v1-cycle", "parent@1.0.0", "child@2.0.0"]]
      });
  });

  test("links hoisted package-lock v1 dependencies through requiring parents", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-v1-hoisted",
        lockfileVersion: 1,
        dependencies: {
          "prod-parent": {
            version: "1.0.0",
            requires: {
              "hoisted-child": "2.0.0"
            }
          },
          "hoisted-child": {
            version: "2.0.0",
            resolved: "file:../bun-project/.registry/hoisted-child"
          },
          "dev-parent": {
            version: "3.0.0",
            dev: true,
            requires: {
              "dev-hoisted-child": "4.0.0"
            }
          },
          "dev-hoisted-child": {
            version: "4.0.0",
            resolved: "file:../bun-project/.registry/dev-hoisted-child"
          }
        }
      }),
      "package-lock-v1-hoisted.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "dev-hoisted-child@4.0.0",
      "dev-parent@3.0.0",
      "hoisted-child@2.0.0",
      "prod-parent@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "hoisted-child@2.0.0"))
      .toMatchObject({
        direct: false,
        dependencyType: "production",
        paths: [[
          "fixture-package-lock-v1-hoisted",
          "prod-parent@1.0.0",
          "hoisted-child@2.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "dev-hoisted-child@4.0.0"))
      .toMatchObject({
        direct: false,
        dependencyType: "development",
        paths: [[
          "fixture-package-lock-v1-hoisted",
          "dev-parent@3.0.0",
          "dev-hoisted-child@4.0.0"
        ]]
      });
  });

  test("resolves npm alias dependencies to the actual package identity", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-alias-project",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture-package-lock-alias-project",
            dependencies: {
              "compat-parent": "npm:permissive-parent@1.0.0"
            }
          },
          "node_modules/compat-parent": {
            name: "permissive-parent",
            version: "1.0.0",
            resolved: "file:../bun-project/.registry/permissive-parent",
            dependencies: {
              "compat-child": "npm:agpl-child@0.1.0"
            }
          },
          "node_modules/compat-parent/node_modules/compat-child": {
            name: "agpl-child",
            version: "0.1.0",
            resolved: "file:../bun-project/.registry/agpl-child"
          }
        }
      }),
      "alias-package-lock.json"
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
        paths: [[
          "fixture-package-lock-alias-project",
          "compat-parent -> permissive-parent@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "agpl-child@0.1.0"))
      .toMatchObject({
        name: "agpl-child",
        installNames: ["compat-child"],
        direct: false,
        paths: [[
          "fixture-package-lock-alias-project",
          "compat-parent -> permissive-parent@1.0.0",
          "compat-child -> agpl-child@0.1.0"
        ]]
      });
  });

  test("keeps nested optional and peer dependency edges from modern package locks", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-nested-edges",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture-package-lock-nested-edges",
            dependencies: {
              "prod-parent": "1.0.0"
            }
          },
          "node_modules/prod-parent": {
            name: "prod-parent",
            version: "1.0.0",
            dependencies: {
              "regular-child": "1.0.0"
            },
            optionalDependencies: {
              "optional-child": "1.0.0"
            },
            peerDependencies: {
              "peer-child": "1.0.0"
            }
          },
          "node_modules/prod-parent/node_modules/regular-child": {
            name: "regular-child",
            version: "1.0.0"
          },
          "node_modules/prod-parent/node_modules/optional-child": {
            name: "optional-child",
            version: "1.0.0"
          },
          "node_modules/prod-parent/node_modules/peer-child": {
            name: "peer-child",
            version: "1.0.0"
          }
        }
      }),
      "nested-edges-package-lock.json"
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
    expect(result.value.nodes.find((node) => node.id === "regular-child@1.0.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [[
          "fixture-package-lock-nested-edges",
          "prod-parent@1.0.0",
          "regular-child@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "optional-child@1.0.0"))
      .toMatchObject({
        dependencyType: "optional",
        direct: false,
        paths: [[
          "fixture-package-lock-nested-edges",
          "prod-parent@1.0.0",
          "optional-child@1.0.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "peer-child@1.0.0"))
      .toMatchObject({
        dependencyType: "peer",
        direct: false,
        paths: [[
          "fixture-package-lock-nested-edges",
          "prod-parent@1.0.0",
          "peer-child@1.0.0"
        ]]
      });
  });

  test("uses every npm workspace package as a dependency graph root", () => {
    const result = parsePackageLockText(
      JSON.stringify({
        name: "fixture-package-lock-workspaces",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture-package-lock-workspaces",
            workspaces: [
              "apps/*",
              "packages/*"
            ]
          },
          "apps/web": {
            name: "workspace-web",
            version: "1.0.0",
            dependencies: {
              "workspace-prod": "1.0.0"
            }
          },
          "packages/tools": {
            name: "workspace-tools",
            version: "1.0.0",
            devDependencies: {
              "workspace-dev": "2.0.0"
            }
          },
          "node_modules/workspace-prod": {
            name: "workspace-prod",
            version: "1.0.0",
            dependencies: {
              "workspace-child": "0.1.0"
            }
          },
          "node_modules/workspace-prod/node_modules/workspace-child": {
            name: "workspace-child",
            version: "0.1.0"
          },
          "packages/tools/node_modules/workspace-dev": {
            name: "workspace-dev",
            version: "2.0.0"
          }
        }
      }),
      "workspace-package-lock.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-package-lock-workspaces");
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
        paths: [[
          "workspace-web",
          "workspace-prod@1.0.0",
          "workspace-child@0.1.0"
        ]]
      });
    expect(result.value.nodes.find((node) => node.id === "workspace-dev@2.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["workspace-tools", "workspace-dev@2.0.0"]]
      });
  });
});
