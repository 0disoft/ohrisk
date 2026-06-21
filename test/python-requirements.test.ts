import { describe, expect, test } from "bun:test";

import { parseRequirementsText } from "../src/graph/python-requirements";

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
