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

  test("rejects package entries without exact version pins", () => {
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
});
