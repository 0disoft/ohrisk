import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseRequirementsFile, parseRequirementsText } from "../src/graph/python-requirements";

describe("parseRequirementsText", () => {
  test("parses pinned PyPI requirements as direct production dependencies", () => {
    const result = parseRequirementsText(
      [
        "--index-url https://pypi.org/simple",
        "requests==2.32.3",
        "risk-pkg[ssl]==1.0.0 ; python_version >= \"3.11\"",
        "Flask==3.0.2 # local comment"
      ].join("\n"),
      "fixture-python/requirements.txt"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-python");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "Flask@3.0.2",
        name: "Flask",
        version: "3.0.2",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-python", "Flask@3.0.2"]]
      }),
      expect.objectContaining({
        id: "requests@2.32.3",
        name: "requests",
        version: "2.32.3",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true
      }),
      expect.objectContaining({
        id: "risk-pkg@1.0.0",
        name: "risk-pkg",
        version: "1.0.0",
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true
      })
    ]);
  });

  test("reconstructs pip-compile dependency paths from via annotations", () => {
    const result = parseRequirementsText(
      [
        "certifi==2025.8.3",
        "    # via requests",
        "readthedocs-cli==5",
        "    # via -r docs/requirements.in",
        "requests==2.32.5",
        "    # via",
        "    #   readthedocs-cli",
        "    #   sphinx",
        "sphinx==7.4.7 # via -r docs/requirements.in"
      ].join("\n"),
      "mbedtls/docs/requirements.txt"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "certifi@2025.8.3",
        direct: false,
        paths: [
          ["docs", "readthedocs-cli@5", "requests@2.32.5", "certifi@2025.8.3"],
          ["docs", "sphinx@7.4.7", "requests@2.32.5", "certifi@2025.8.3"]
        ]
      }),
      expect.objectContaining({
        id: "readthedocs-cli@5",
        direct: true,
        paths: [["docs", "readthedocs-cli@5"]]
      }),
      expect.objectContaining({
        id: "requests@2.32.5",
        direct: false,
        paths: [
          ["docs", "readthedocs-cli@5", "requests@2.32.5"],
          ["docs", "sphinx@7.4.7", "requests@2.32.5"]
        ]
      }),
      expect.objectContaining({
        id: "sphinx@7.4.7",
        direct: true,
        paths: [["docs", "sphinx@7.4.7"]]
      })
    ]);
  });

  test("keeps plain and unresolved via annotations fail-safe as direct dependencies", () => {
    const result = parseRequirementsText(
      [
        "plain==1.0.0",
        "unknown-parent-child==2.0.0",
        "    # via package-not-present",
        "constraint-only==3.0.0",
        "    # via -c constraints.txt"
      ].join("\n"),
      "fixture-python/requirements.txt"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => ({
      id: node.id,
      direct: node.direct,
      paths: node.paths
    }))).toEqual([
      {
        id: "constraint-only@3.0.0",
        direct: true,
        paths: [["fixture-python", "constraint-only@3.0.0"]]
      },
      {
        id: "plain@1.0.0",
        direct: true,
        paths: [["fixture-python", "plain@1.0.0"]]
      },
      {
        id: "unknown-parent-child@2.0.0",
        direct: true,
        paths: [["fixture-python", "unknown-parent-child@2.0.0"]]
      }
    ]);
  });

  test("follows nested requirements and exact constraint pins", () => {
    const files = new Map([
      [
        "fixture-python/base.txt",
        [
          "requests>=2",
          "risk-pkg==1.0.0"
        ].join("\n")
      ],
      [
        "fixture-python/constraints.txt",
        [
          "Flask==3.0.2",
          "requests==2.32.3"
        ].join("\n")
      ]
    ]);
    const result = parseRequirementsText(
      [
        "-c constraints.txt",
        "-r base.txt",
        "Flask>=3"
      ].join("\n"),
      "fixture-python/requirements.txt",
      {
        readIncludedFile: ({ includePath, fromFilePath }) => {
          const includedPath = `fixture-python/${includePath}`;
          const text = files.get(includedPath);
          if (!text) {
            throw new Error(`Unexpected include from ${fromFilePath}: ${includePath}`);
          }

          return {
            ok: true as const,
            value: {
              path: includedPath,
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
        id: "Flask@3.0.2",
        name: "Flask",
        version: "3.0.2"
      }),
      expect.objectContaining({
        id: "requests@2.32.3",
        name: "requests",
        version: "2.32.3"
      }),
      expect.objectContaining({
        id: "risk-pkg@1.0.0",
        name: "risk-pkg",
        version: "1.0.0"
      })
    ]);
  });

  test("reports nested requirement include cycles as typed errors", () => {
    const files = new Map([
      [
        "fixture-python/requirements.txt",
        "-r base.txt"
      ],
      [
        "fixture-python/base.txt",
        "-r requirements.txt"
      ]
    ]);
    const result = parseRequirementsText(
      "-r base.txt",
      "fixture-python/requirements.txt",
      {
        readIncludedFile: ({ includePath }) => {
          const includedPath = `fixture-python/${includePath}`;
          const text = files.get(includedPath);
          if (!text) {
            throw new Error(`Unexpected include: ${includePath}`);
          }

          return {
            ok: true as const,
            value: {
              path: includedPath,
              text
            }
          };
        }
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected nested requirements.txt include cycle to fail.");
    }

    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
    expect(result.error.message).toContain("include cycle");
    expect(result.error.details).toMatchObject({
      lockfilePath: "fixture-python/requirements.txt"
    });
  });

  test("parses editable local source requirements with embedded license evidence", () => {
    const files = new Map([
      [
        "libs/local-risk/pyproject.toml",
        [
          "[project]",
          "name = \"local-risk\"",
          "version = \"1.0.0\"",
          "license = { text = \"AGPL-3.0-only\" }"
        ].join("\n")
      ],
      [
        "libs/local-risk/LICENSE",
        "GNU AFFERO GENERAL PUBLIC LICENSE Version 3\n"
      ]
    ]);
    const result = parseRequirementsText(
      [
        "-e libs/local-risk",
        "local-risk @ libs/local-risk"
      ].join("\n"),
      "fixture-python/requirements.txt",
      {
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
        direct: true
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

  test("rejects local source paths outside the requirements root", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-root-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-outside-"));

    try {
      writeFileSync(path.join(projectRoot, "requirements.txt"), "-e ../outside-risk\n", "utf8");
      mkdirSync(path.join(outsideRoot, "outside-risk"), { recursive: true });

      const result = parseRequirementsFile(path.join(projectRoot, "requirements.txt"));

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected outside local source path to fail.");
      }

      expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("reports remote editable VCS requirements with an actionable error", () => {
    const result = parseRequirementsText(
      "-e git+https://example.com/acme/risk-pkg.git#egg=risk-pkg",
      "requirements.txt"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected remote editable VCS requirement to fail.");
    }

    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
    expect(result.error.message).toContain("Remote VCS requirements are not supported yet");
    expect(result.error.message).toContain("name==version pins");
    expect(result.error.message).toContain("project-root-contained local source path");
    expect(result.error.details).toMatchObject({
      lockfilePath: "requirements.txt",
      line: 1,
      entry: "-e git+https://example.com/acme/risk-pkg.git#egg=risk-pkg",
      reason: "unsupported_remote_editable_vcs_requirement",
      supportedRequirementForms: [
        "name==version",
        "name with an exact constraint pin",
        "project-root-contained local source path"
      ]
    });
  });

  test("reports remote VCS direct references with an actionable error", () => {
    const result = parseRequirementsText(
      "risk-pkg @ git+https://example.com/acme/risk-pkg.git@v1.2.3",
      "requirements.txt"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected remote VCS direct reference to fail.");
    }

    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
    expect(result.error.message).toContain("Remote VCS requirements are not supported yet");
    expect(result.error.details).toMatchObject({
      lockfilePath: "requirements.txt",
      line: 1,
      entry: "risk-pkg @ git+https://example.com/acme/risk-pkg.git@v1.2.3",
      reason: "unsupported_remote_vcs_direct_reference"
    });
  });

  test("rejects unpinned requirements instead of pretending coverage is complete", () => {
    const result = parseRequirementsText("requests>=2", "requirements.txt");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unpinned requirements.txt to fail.");
    }

    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
  });

  test("rejects nested requirement includes when no include reader is available", () => {
    const result = parseRequirementsText("-r base.txt", "requirements.txt");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected nested requirements.txt include without reader to fail.");
    }

    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
  });
});
