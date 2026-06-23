import { describe, expect, test } from "bun:test";

import { parsePyprojectText } from "../src/graph/python-pyproject";

describe("parsePyprojectText", () => {
  test("parses PEP 621 exact dependencies and optional dependencies", () => {
    const result = parsePyprojectText(
      [
        "[project]",
        "name = \"fixture-python\"",
        "version = \"0.1.0\"",
        "dependencies = [",
        "  \"risk-pkg==1.0.0\",",
        "  \"safe-pkg[ssl]==2.0.0 ; python_version >= \\\"3.11\\\"\",",
        "]",
        "",
        "[project.optional-dependencies]",
        "docs = [\"mkdocs==1.6.1\"]"
      ].join("\n"),
      "fixture-python/pyproject.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-python");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "mkdocs@1.6.1",
        name: "mkdocs",
        version: "1.6.1",
        ecosystem: "pypi",
        dependencyType: "optional",
        direct: true,
        paths: [["fixture-python", "mkdocs@1.6.1"]]
      }),
      expect.objectContaining({
        id: "risk-pkg@1.0.0",
        dependencyType: "production",
        direct: true
      }),
      expect.objectContaining({
        id: "safe-pkg@2.0.0",
        dependencyType: "production",
        direct: true
      })
    ]);
  });

  test("rejects ranged dependencies instead of pretending resolved coverage", () => {
    const result = parsePyprojectText(
      [
        "[project]",
        "dependencies = [\"requests>=2\"]"
      ].join("\n"),
      "pyproject.toml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected ranged pyproject.toml dependency to fail.");
    }

    expect(result.error.code).toBe("PYPROJECT_PARSE_FAILED");
  });

  test("rejects direct references without resolved versions", () => {
    const result = parsePyprojectText(
      [
        "[project]",
        "dependencies = [\"risk-pkg @ file:./risk-pkg\"]"
      ].join("\n"),
      "pyproject.toml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected direct reference pyproject.toml dependency to fail.");
    }

    expect(result.error.code).toBe("PYPROJECT_PARSE_FAILED");
  });
});
