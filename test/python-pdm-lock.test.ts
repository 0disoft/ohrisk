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
