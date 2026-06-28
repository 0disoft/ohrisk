import { describe, expect, test } from "bun:test";

import { parsePipfileLockText } from "../src/graph/python-pipfile-lock";

describe("parsePipfileLockText", () => {
  test("parses default and develop PyPI package entries", () => {
    const result = parsePipfileLockText(JSON.stringify({
      _meta: {
        "pipfile-spec": 6
      },
      default: {
        requests: {
          version: "==2.32.3"
        },
        certifi: {
          version: "==2026.6.17"
        }
      },
      develop: {
        pytest: {
          version: "==8.3.5"
        }
      }
    }), "fixture-python/Pipfile.lock");

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
    expect(result.value.nodes.find((node) => node.id === "pytest@8.3.5"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-python", "pytest@8.3.5"]]
      });
  });

  test("parses local path package entries with embedded license evidence", () => {
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

    const result = parsePipfileLockText(JSON.stringify({
      default: {
        "local-risk": {
          editable: true,
          path: "./local-risk"
        }
      }
    }), "fixture-python/Pipfile.lock", {
      readLocalSourceFile: ({ sourcePath, relativeFilePath }) => {
        const text = files.get(`${sourcePath}/${relativeFilePath}`);
        return {
          ok: true as const,
          value: text === undefined
            ? undefined
            : {
                path: `fixture-python/${sourcePath}/${relativeFilePath}`,
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
        paths: [["fixture-python", "local-risk@1.0.0"]]
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
            path: "local-risk/LICENSE",
            kind: "license"
          })
        ]
      })
    ]);
  });

  test("rejects local path package entries when no local source reader is available", () => {
    const result = parsePipfileLockText(JSON.stringify({
      default: {
        editablePackage: {
          editable: true,
          path: "."
        }
      }
    }), "Pipfile.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unpinned Pipfile.lock entry to fail.");
    }

    expect(result.error.code).toBe("PIPFILE_LOCK_PARSE_FAILED");
  });

  test("reports remote VCS package sources with an actionable error", () => {
    const result = parsePipfileLockText(JSON.stringify({
      default: {
        "remote-risk": {
          git: "https://example.com/acme/remote-risk.git",
          ref: "abc123"
        }
      }
    }), "Pipfile.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected remote VCS Pipfile.lock source to fail.");
    }

    expect(result.error.code).toBe("PIPFILE_LOCK_PARSE_FAILED");
    expect(result.error.message).toContain("Remote VCS package sources are not supported yet");
    expect(result.error.message).toContain("exact ==version pins");
    expect(result.error.message).toContain("project-root-contained local source paths");
    expect(result.error.details).toMatchObject({
      lockfilePath: "Pipfile.lock",
      sectionName: "default",
      packageName: "remote-risk",
      reason: "unsupported_remote_vcs_source",
      source: "https://example.com/acme/remote-risk.git",
      supportedPackageForms: [
        "exact ==version pin",
        "project-root-contained local source path"
      ]
    });
  });
});
