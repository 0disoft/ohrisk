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

  test("bounds dependency path fan-out while retaining every reachable package", () => {
    const packageRecords: string[] = [];
    const layerCount = 10;

    for (let layer = 0; layer < layerCount; layer += 1) {
      for (const suffix of ["a", "b"]) {
        const dependencies = layer === layerCount - 1
          ? ["leaf"]
          : [`layer-${layer + 1}-a`, `layer-${layer + 1}-b`];
        packageRecords.push(
          "[[package]]",
          `name = "layer-${layer}-${suffix}"`,
          "version = \"1.0.0\"",
          "source = { registry = \"https://pypi.org/simple\" }",
          "dependencies = [",
          ...dependencies.map((name) => `    { name = "${name}" },`),
          "]",
          ""
        );
      }
    }

    packageRecords.push(
      "[[package]]",
      "name = \"leaf\"",
      "version = \"1.0.0\"",
      "source = { registry = \"https://pypi.org/simple\" }"
    );

    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"bounded-uv\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [",
        "    { name = \"layer-0-a\" },",
        "    { name = \"layer-0-b\" },",
        "]",
        "",
        ...packageRecords
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength((layerCount * 2) + 1);
    expect(result.value.nodes.find((node) => node.id === "leaf@1.0.0")?.paths)
      .toHaveLength(64);
    expect(result.value.diagnostics).toEqual([
      {
        code: "dependency_paths_truncated",
        affectedNodeCount: 7,
        limit: 64,
        message: "uv dependency paths were limited."
      }
    ]);
  });

  test("parses local source package records with embedded license evidence", () => {
    const files = new Map([
      [
        "libs/local-risk/pyproject.toml",
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = \"AGPL-3.0-only\""
        ].join("\n")
      ],
      [
        "libs/local-risk/LICENSE",
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
        "source = { directory = \"libs/local-risk\" }"
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
            path: "libs/local-risk/LICENSE",
            kind: "license",
            text: "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
          }
        ],
        source: "local",
        warnings: []
      }
    ]);
  });

  test("keeps immutable remote VCS package records without fetching unrelated PyPI evidence", () => {
    const commit = "4e3996d9f69b10e8f91b6b9fa4712f627c539c02";
    const result = parseUvLockText(
      [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"fixture-python\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [{ name = \"remote-risk\" }]",
        "",
        "[[package]]",
        "name = \"remote-risk\"",
        "version = \"1.0.0\"",
        `source = { git = \"https://example.com/acme/remote-risk.git?rev=main#${commit}\" }`
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "remote-risk@1.0.0",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-python", "remote-risk@1.0.0"]]
      })
    ]);
    expect(result.value.embeddedEvidence).toEqual([{
      packageId: "remote-risk@1.0.0",
      metadataSource: "uv.lock remote VCS source",
      files: [],
      source: "unavailable",
      warnings: [
        `Remote VCS dependency is pinned to immutable commit ${commit}, but Ohrisk does not fetch VCS package evidence. Verify this dependency's license from that commit before approval.`
      ]
    }]);
  });

  test("rejects remote VCS package sources without a full resolved commit", () => {
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
    expect(result.error.message).toContain("must resolve to a full immutable Git commit");
    expect(result.error.message).toContain("branches, tags, short revisions");
    expect(result.error.details).toMatchObject({
      lockfilePath: "uv.lock",
      packageName: "remote-risk",
      reason: "unpinned_remote_vcs_source",
      source: "https://example.com/acme/remote-risk.git",
      supportedSourceForms: [
        "locked PyPI package record",
        "project-root-contained local source path",
        "remote VCS source pinned to a full commit"
      ]
    });
  });

  test("redacts credentials and query strings from rejected remote VCS sources", () => {
    const result = parseUvLockText(
      [
        "[[package]]",
        "name = \"remote-risk\"",
        "version = \"1.0.0\"",
        "source = { git = \"https://secret-user:secret-password@example.com/acme/remote-risk.git?token=secret-token#main\" }"
      ].join("\n"),
      "uv.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an unpinned remote VCS uv.lock source to fail.");
    }

    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain("secret-user");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("secret-token");
    expect(result.error.details?.source).toBe(
      "https://redacted:redacted@example.com/acme/remote-risk.git"
    );
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
