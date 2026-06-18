import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
});
