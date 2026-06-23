import { describe, expect, test } from "bun:test";

import { parseBazelModuleText } from "../src/graph/bazel-module";

describe("parseBazelModuleText", () => {
  test("parses literal bazel_dep entries from MODULE.bazel", () => {
    const result = parseBazelModuleText([
      "module(name = \"fixture_bazel\", version = \"0.1.0\")",
      "",
      "bazel_dep(",
      "  name = \"rules_cc\",",
      "  version = \"0.0.9\",",
      "  repo_name = \"cc_rules\",",
      ")",
      "bazel_dep(name = \"rules_java\", version = \"7.11.1\", dev_dependency = True)",
      "bazel_dep(name = \"bazel_skylib\", version = \"1.6.1\") # direct runtime dep"
    ].join("\n"), "fixture-bazel/MODULE.bazel");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture_bazel");
    expect(result.value.lockfilePath).toBe("fixture-bazel/MODULE.bazel");
    expect(result.value.nodes).toEqual([
      {
        id: "bazel_skylib@1.6.1",
        name: "bazel_skylib",
        version: "1.6.1",
        ecosystem: "bazel",
        dependencyType: "production",
        direct: true,
        paths: [["fixture_bazel", "bazel_skylib@1.6.1"]]
      },
      {
        id: "rules_cc@0.0.9",
        name: "rules_cc",
        installNames: ["cc_rules"],
        version: "0.0.9",
        ecosystem: "bazel",
        dependencyType: "production",
        direct: true,
        paths: [["fixture_bazel", "rules_cc@0.0.9"]]
      },
      {
        id: "rules_java@7.11.1",
        name: "rules_java",
        version: "7.11.1",
        ecosystem: "bazel",
        dependencyType: "development",
        direct: true,
        paths: [["fixture_bazel", "rules_java@7.11.1"]]
      }
    ]);
  });

  test("supports positional name and version for older MODULE.bazel call shapes", () => {
    const result = parseBazelModuleText([
      "module(name = \"fixture_bazel\")",
      "bazel_dep(\"rules_cc\", \"0.0.9\")"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength(1);
    expect(result.value.nodes[0]).toMatchObject({
      id: "rules_cc@0.0.9",
      name: "rules_cc",
      version: "0.0.9",
      ecosystem: "bazel"
    });
  });

  test("rejects bazel_dep entries without exact literal versions", () => {
    const result = parseBazelModuleText("bazel_dep(name = \"rules_cc\")");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseBazelModuleText to fail.");
    }

    expect(result.error.code).toBe("BAZEL_MODULE_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      reason: "bazel_dep_missing_name_or_exact_version"
    });
  });

  test("rejects nodep repo_name None entries because the actual resolved graph is unknown", () => {
    const result = parseBazelModuleText("bazel_dep(name = \"rules_cc\", version = \"0.0.9\", repo_name = None)");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseBazelModuleText to fail.");
    }

    expect(result.error.code).toBe("BAZEL_MODULE_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      reason: "nodep_repo_name_not_supported"
    });
  });

  test("rejects graph-expanding MODULE.bazel constructs instead of silently partial-scanning", () => {
    const result = parseBazelModuleText([
      "module(name = \"fixture_bazel\")",
      "include(\"//:deps.MODULE.bazel\")",
      "bazel_dep(name = \"rules_cc\", version = \"0.0.9\")"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected parseBazelModuleText to fail.");
    }

    expect(result.error.code).toBe("BAZEL_MODULE_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      reason: "unsupported_bazel_module_graph_construct",
      construct: "include"
    });
  });
});
