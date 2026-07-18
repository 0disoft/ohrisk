import { describe, expect, test } from "bun:test";

import { parsePdmLockText } from "../src/graph/python-pdm-lock";

describe("parsePdmLockText", () => {
  test("parses PDM root, optional, development, and transitive PyPI dependencies", () => {
    const pdmLock = [
      "[metadata]",
      "groups = [\"default\", \"docs\", \"dev\"]",
      "lock_version = \"4.5.0\"",
      "",
      "[[package]]",
      "name = \"certifi\"",
      "version = \"2026.6.17\"",
      "groups = [\"default\"]",
      "",
      "[[package]]",
      "name = \"mkdocs\"",
      "version = \"1.6.1\"",
      "groups = [\"docs\"]",
      "",
      "[[package]]",
      "name = \"pytest\"",
      "version = \"8.3.5\"",
      "groups = [\"dev\"]",
      "",
      "[[package]]",
      "name = \"requests\"",
      "version = \"2.32.3\"",
      "groups = [\"default\"]",
      "dependencies = [",
      "    \"certifi>=2017.4.17\",",
      "]"
    ].join("\n");
    const pyproject = [
      "[project]",
      "name = \"fixture-pdm\"",
      "version = \"0.1.0\"",
      "dependencies = [",
      "    \"requests>=2.32.3\",",
      "]",
      "",
      "[project.optional-dependencies]",
      "docs = [\"mkdocs>=1.6.1\"]",
      "",
      "[dependency-groups]",
      "dev = [\"pytest>=8.3.5\"]"
    ].join("\n");

    const result = parsePdmLockText(pdmLock, "fixture-pdm/pdm.lock", {
      pyprojectText: pyproject
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-pdm");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "certifi@2026.6.17",
      "mkdocs@1.6.1",
      "pytest@8.3.5",
      "requests@2.32.3"
    ]);
    expect(result.value.nodes.find((node) => node.id === "requests@2.32.3"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-pdm", "requests@2.32.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "certifi@2026.6.17"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-pdm", "requests@2.32.3", "certifi@2026.6.17"]]
      });
    expect(result.value.nodes.find((node) => node.id === "mkdocs@1.6.1"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "optional",
        direct: true,
        paths: [["fixture-pdm", "mkdocs@1.6.1"]]
      });
    expect(result.value.nodes.find((node) => node.id === "pytest@8.3.5"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-pdm", "pytest@8.3.5"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const pdmLock = [
      "[[package]]",
      "name = \"requests\"",
      "version = \"2.32.3\"",
      "groups = [\"default\"]",
      "dependencies = [",
      "    \"urllib3>=2.5.0\",",
      "]",
      "",
      "[[package]]",
      "name = \"urllib3\"",
      "version = \"2.5.0\"",
      "groups = [\"default\"]",
      "dependencies = [",
      "    \"requests>=2.32.3\",",
      "]"
    ].join("\n");
    const pyproject = [
      "[project]",
      "name = \"fixture-pdm-cycle\"",
      "version = \"0.1.0\"",
      "dependencies = [",
      "    \"requests>=2.32.3\",",
      "]"
    ].join("\n");

    const result = parsePdmLockText(pdmLock, "fixture-pdm-cycle/pdm.lock", {
      pyprojectText: pyproject
    });

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
        paths: [["fixture-pdm-cycle", "requests@2.32.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "urllib3@2.5.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-pdm-cycle", "requests@2.32.3", "urllib3@2.5.0"]]
      });
  });

  test("parses local path package records with embedded license evidence", () => {
    const pdmLock = [
      "[[package]]",
      "name = \"local-risk\"",
      "groups = [\"default\"]",
      "path = \"libs/local-risk\""
    ].join("\n");
    const pyproject = [
      "[project]",
      "name = \"fixture-pdm\"",
      "version = \"0.1.0\"",
      "dependencies = [\"local-risk @ file:./local-risk\"]"
    ].join("\n");
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

    const result = parsePdmLockText(pdmLock, "fixture-pdm/pdm.lock", {
      pyprojectText: pyproject,
      readLocalSourceFile: ({ sourcePath, relativeFilePath }) => {
        const text = files.get(`${sourcePath}/${relativeFilePath}`);
        return {
          ok: true as const,
          value: text === undefined
            ? undefined
            : {
                path: `fixture-pdm/${sourcePath}/${relativeFilePath}`,
                text
              }
        };
      }
    });

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
        paths: [["fixture-pdm", "local-risk@1.0.0"]]
      })
    ]);
    expect(result.value.embeddedEvidence).toEqual([
      expect.objectContaining({
        packageId: "local-risk@1.0.0",
        metadataLicense: "AGPL-3.0-only",
        metadataSource: "pyproject.toml",
        source: "local",
        files: [
          expect.objectContaining({
            path: "libs/local-risk/LICENSE",
            kind: "license"
          })
        ]
      })
    ]);
  });

  test("reports remote VCS package sources with an actionable error", () => {
    const pdmLock = [
      "[[package]]",
      "name = \"remote-risk\"",
      "git = \"https://example.com/acme/remote-risk.git\"",
      "ref = \"abc123\""
    ].join("\n");

    const result = parsePdmLockText(pdmLock, "pdm.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected remote VCS pdm.lock source to fail.");
    }

    expect(result.error.code).toBe("PDM_LOCK_PARSE_FAILED");
    expect(result.error.message).toContain("Remote VCS package sources are not supported yet");
    expect(result.error.message).toContain("locked PyPI package records");
    expect(result.error.message).toContain("project-root-contained local source paths");
    expect(result.error.details).toMatchObject({
      lockfilePath: "pdm.lock",
      packageName: "remote-risk",
      reason: "unsupported_remote_vcs_source",
      source: "https://example.com/acme/remote-risk.git",
      supportedSourceForms: [
        "locked PyPI package record",
        "project-root-contained local source path"
      ]
    });
  });

  test("falls back to inferred roots when pyproject.toml is unavailable", () => {
    const result = parsePdmLockText(
      [
        "[[package]]",
        "name = \"leaf\"",
        "version = \"1.0.0\"",
        "groups = [\"default\"]",
        "",
        "[[package]]",
        "name = \"root\"",
        "version = \"2.0.0\"",
        "groups = [\"default\"]",
        "dependencies = [\"leaf>=1.0.0\"]"
      ].join("\n"),
      "project/pdm.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "leaf@1.0.0",
      "root@2.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "root@2.0.0")?.direct).toBe(true);
    expect(result.value.nodes.find((node) => node.id === "leaf@1.0.0")?.direct).toBe(false);
  });

  test("reports malformed package records as typed errors", () => {
    const result = parsePdmLockText(
      [
        "[[package]]",
        "name = \"missing-version\""
      ].join("\n"),
      "pdm.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed pdm.lock to fail.");
    }

    expect(result.error.code).toBe("PDM_LOCK_PARSE_FAILED");
  });
});
