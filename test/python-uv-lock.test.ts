import { describe, expect, test } from "bun:test";

import { parseUvLockText } from "../src/graph/python-uv-lock";

describe("parseUvLockText", () => {
  test("parses production, development, and transitive PyPI dependencies", () => {
    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"certifi\"",
        "version = \"2026.6.17\"",
        "source = { registry = \"https://pypi.org/simple\" }",
        "",
        "[[package]]",
        "name = \"fixture-python\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [",
        "    { name = \"requests\" },",
        "]",
        "",
        "[package.dev-dependencies]",
        "dev = [",
        "    { name = \"pytest\" },",
        "]",
        "",
        "[[package]]",
        "name = \"pytest\"",
        "version = \"8.3.5\"",
        "source = { registry = \"https://pypi.org/simple\" }",
        "",
        "[[package]]",
        "name = \"requests\"",
        "version = \"2.32.3\"",
        "source = { registry = \"https://pypi.org/simple\" }",
        "dependencies = [",
        "    { name = \"certifi\" },",
        "]"
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-python");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "certifi@2026.6.17",
      "pytest@8.3.5",
      "requests@2.32.3"
    ]);

    expect(result.value.nodes.find((node) => node.id === "requests@2.32.3"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-python", "requests@2.32.3"]]
      });

    expect(result.value.nodes.find((node) => node.id === "certifi@2026.6.17"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-python", "requests@2.32.3", "certifi@2026.6.17"]]
      });

    expect(result.value.nodes.find((node) => node.id === "pytest@8.3.5"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-python", "pytest@8.3.5"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"fixture-uv-cycle\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [",
        "    { name = \"requests\" },",
        "]",
        "",
        "[[package]]",
        "name = \"requests\"",
        "version = \"2.32.3\"",
        "source = { registry = \"https://pypi.org/simple\" }",
        "dependencies = [",
        "    { name = \"urllib3\" },",
        "]",
        "",
        "[[package]]",
        "name = \"urllib3\"",
        "version = \"2.5.0\"",
        "source = { registry = \"https://pypi.org/simple\" }",
        "dependencies = [",
        "    { name = \"requests\" },",
        "]"
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "requests@2.32.3",
      "urllib3@2.5.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "requests@2.32.3"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-uv-cycle", "requests@2.32.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "urllib3@2.5.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-uv-cycle", "requests@2.32.3", "urllib3@2.5.0"]]
      });
  });

  test("parses local source package records with embedded license evidence", () => {
    const files = new Map([
      [
        "./local-risk/pyproject.toml",
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n")
      ],
      [
        "./local-risk/LICENSE",
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
      ]
    ]);

    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"fixture-python\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [",
        "    { name = \"local-risk\" },",
        "]",
        "",
        "[[package]]",
        "name = \"local-risk\"",
        "version = \"1.0.0\"",
        "source = { directory = \"./local-risk\" }"
      ].join("\n"),
      "uv.lock",
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
        id: "local-risk@1.0.0",
        name: "local-risk",
        version: "1.0.0",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-python", "local-risk@1.0.0"]]
      })
    ]);
    expect(result.value.embeddedEvidence).toEqual([
      {
        packageId: "local-risk@1.0.0",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "pyproject.toml",
        files: [
          {
            path: "local-risk/LICENSE",
            kind: "license",
            text: "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
          }
        ],
        source: "local",
        warnings: []
      }
    ]);
  });

  test("reports remote VCS package sources with an actionable error", () => {
    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"remote-risk\"",
        "version = \"1.0.0\"",
        "source = { git = \"https://example.com/acme/remote-risk.git\", rev = \"abc123\" }"
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected remote VCS uv.lock source to fail.");
    }

    expect(result.error.code).toBe("UV_LOCK_PARSE_FAILED");
    expect(result.error.message).toContain("Remote VCS package sources are not supported yet");
    expect(result.error.message).toContain("locked PyPI package records");
    expect(result.error.message).toContain("project-root-contained local source paths");
    expect(result.error.details).toMatchObject({
      lockfilePath: "uv.lock",
      packageName: "remote-risk",
      reason: "unsupported_remote_vcs_source",
      source: "https://example.com/acme/remote-risk.git",
      supportedSourceForms: [
        "locked PyPI package record",
        "project-root-contained local source path"
      ]
    });
  });

  test("reports malformed package records as typed errors", () => {
    const result = parseUvLockText(
      [
        "[[package]]",
        "name = \"missing-version\""
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed uv.lock to fail.");
    }

    expect(result.error.code).toBe("UV_LOCK_PARSE_FAILED");
  });
});
