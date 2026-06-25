import { describe, expect, test } from "bun:test";

import { parsePylockText } from "../src/graph/python-pylock";

describe("parsePylockText", () => {
  test("parses versioned pylock package records and dependency paths", () => {
    const result = parsePylockText(
      [
        "lock-version = '1.0'",
        "created-by = 'fixture-locker'",
        "",
        "[[packages]]",
        "name = 'attrs'",
        "version = '25.1.0'",
        "",
        "[[packages]]",
        "name = 'cattrs'",
        "version = '24.1.2'",
        "dependencies = [",
        "  { name = 'attrs', version = '25.1.0' },",
        "]",
        "",
        "[[packages]]",
        "name = 'fixture-dev-tool'",
        "version = '1.0.0'"
      ].join("\n"),
      "pylock.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "attrs@25.1.0",
      "cattrs@24.1.2",
      "fixture-dev-tool@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "cattrs@24.1.2"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "unknown",
        direct: true,
        paths: [["<root>", "cattrs@24.1.2"]]
      });
    expect(result.value.nodes.find((node) => node.id === "attrs@25.1.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "unknown",
        direct: false,
        paths: [["<root>", "cattrs@24.1.2", "attrs@25.1.0"]]
      });
  });

  test("parses named pylock root names and nested dependency tables", () => {
    const result = parsePylockText(
      [
        "lock-version = '1.0'",
        "created-by = 'fixture-locker'",
        "",
        "[[packages]]",
        "name = 'risk-pkg'",
        "version = '1.0.0'",
        "",
        "[[packages.dependencies]]",
        "name = 'dep-pkg'",
        "version = '2.0.0'",
        "",
        "[[packages]]",
        "name = 'dep-pkg'",
        "version = '2.0.0'",
        "",
        "[[packages]]",
        "name = 'dep-pkg'",
        "version = '3.0.0'"
      ].join("\n"),
      "pylock.deploy.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("deploy");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "dep-pkg@2.0.0",
      "dep-pkg@3.0.0",
      "risk-pkg@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "dep-pkg@2.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["deploy", "risk-pkg@1.0.0", "dep-pkg@2.0.0"]]
      });
  });

  test("skips source tree records that do not carry a stable version", () => {
    const result = parsePylockText(
      [
        "lock-version = '1.0'",
        "created-by = 'fixture-locker'",
        "",
        "[[packages]]",
        "name = 'local-source'",
        "[packages.directory]",
        "path = './packages/local-source'"
      ].join("\n"),
      "pylock.toml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unversioned pylock records to be skipped and fail as empty.");
    }

    expect(result.error.code).toBe("PYLOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "pylock.toml",
      reason: "unsupported_unversioned_source_tree_record",
      unsupportedSourceTreePackages: ["local-source"],
      unsupportedSourceTreePaths: ["./packages/local-source"]
    });
  });

  test("keeps versioned records when unversioned source tree records are present", () => {
    const result = parsePylockText(
      [
        "lock-version = '1.0'",
        "created-by = 'fixture-locker'",
        "",
        "[[packages]]",
        "name = 'attrs'",
        "version = '25.1.0'",
        "",
        "[[packages]]",
        "name = 'local-source'",
        "[packages.directory]",
        "path = './packages/local-source'"
      ].join("\n"),
      "pylock.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual(["attrs@25.1.0"]);
  });
});
