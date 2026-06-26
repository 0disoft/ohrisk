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

  test("stops walking pylock dependency cycles", () => {
    const result = parsePylockText(
      [
        "lock-version = '1.0'",
        "created-by = 'fixture-locker'",
        "",
        "[[packages]]",
        "name = 'fixture-root'",
        "version = '1.0.0'",
        "dependencies = [",
        "  { name = 'cycle-a', version = '1.0.0' },",
        "]",
        "",
        "[[packages]]",
        "name = 'cycle-a'",
        "version = '1.0.0'",
        "dependencies = [",
        "  { name = 'cycle-b', version = '1.0.0' },",
        "]",
        "",
        "[[packages]]",
        "name = 'cycle-b'",
        "version = '1.0.0'",
        "dependencies = [",
        "  { name = 'cycle-a', version = '1.0.0' },",
        "]"
      ].join("\n"),
      "pylock.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "cycle-a@1.0.0",
      "cycle-b@1.0.0",
      "fixture-root@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "cycle-a@1.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["<root>", "fixture-root@1.0.0", "cycle-a@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "cycle-b@1.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["<root>", "fixture-root@1.0.0", "cycle-a@1.0.0", "cycle-b@1.0.0"]]
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

  test("rejects source tree records when local source file access is unavailable", () => {
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
      throw new Error("Expected source tree pylock records to require local source file access.");
    }

    expect(result.error.code).toBe("PYLOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "pylock.toml",
      reason: "unsupported_unversioned_source_tree_record",
      unsupportedSourceTreePackages: ["local-source"],
      unsupportedSourceTreePaths: ["./packages/local-source"]
    });
  });

  test("parses source tree records with embedded license evidence when file access is available", () => {
    const files = new Map([
      [
        "./packages/local-source/pyproject.toml",
        [
          "[project]",
          "name = 'local-source'",
          "version = '1.2.3'",
          "license = 'AGPL-3.0-only'"
        ].join("\n")
      ],
      [
        "./packages/local-source/LICENSE",
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
      ]
    ]);

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
      "pylock.toml",
      {
        readLocalSourceFile: ({ sourcePath, relativeFilePath }) => {
          const text = files.get(`${sourcePath}/${relativeFilePath}`);
          return {
            ok: true as const,
            value: text === undefined
              ? undefined
              : {
                  path: `${sourcePath}/${relativeFilePath}`,
                  text
                }
          };
        }
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "local-source@1.2.3",
        name: "local-source",
        version: "1.2.3",
        ecosystem: "pypi",
        dependencyType: "unknown",
        direct: true,
        paths: [["<root>", "local-source@1.2.3"]]
      })
    ]);
    expect(result.value.embeddedEvidence).toEqual([
      {
        packageId: "local-source@1.2.3",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "pyproject.toml",
        files: [
          {
            path: "packages/local-source/LICENSE",
            kind: "license",
            text: "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
          }
        ],
        source: "local",
        warnings: []
      }
    ]);
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
