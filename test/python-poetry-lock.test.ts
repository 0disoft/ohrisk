import { describe, expect, test } from "bun:test";

import { parsePoetryLockText } from "../src/graph/python-poetry-lock";

describe("parsePoetryLockText", () => {
  test("parses Poetry root, development, and transitive PyPI dependencies", () => {
    const poetryLock = [
      "[[package]]",
      "name = \"certifi\"",
      "version = \"2026.6.17\"",
      "description = \"Root certificates\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"main\"]",
      "",
      "[[package]]",
      "name = \"pytest\"",
      "version = \"8.3.5\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"dev\"]",
      "",
      "[[package]]",
      "name = \"requests\"",
      "version = \"2.32.3\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"main\"]",
      "",
      "[package.dependencies]",
      "certifi = \">=2017.4.17\""
    ].join("\n");
    const pyproject = [
      "[tool.poetry]",
      "name = \"fixture-poetry\"",
      "version = \"0.1.0\"",
      "",
      "[tool.poetry.dependencies]",
      "python = \"^3.12\"",
      "requests = \"^2.32.3\"",
      "",
      "[tool.poetry.group.dev.dependencies]",
      "pytest = \"^8.3.5\""
    ].join("\n");

    const result = parsePoetryLockText(poetryLock, "fixture-poetry/poetry.lock", {
      pyprojectText: pyproject
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-poetry");
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
        paths: [["fixture-poetry", "requests@2.32.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "certifi@2026.6.17"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-poetry", "requests@2.32.3", "certifi@2026.6.17"]]
      });
    expect(result.value.nodes.find((node) => node.id === "pytest@8.3.5"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-poetry", "pytest@8.3.5"]]
      });
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const poetryLock = [
      "[[package]]",
      "name = \"requests\"",
      "version = \"2.32.3\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"main\"]",
      "",
      "[package.dependencies]",
      "urllib3 = \">=2.0.0\"",
      "",
      "[[package]]",
      "name = \"urllib3\"",
      "version = \"2.5.0\"",
      "optional = false",
      "python-versions = \">=3.8\"",
      "groups = [\"main\"]",
      "",
      "[package.dependencies]",
      "requests = \">=2.32.3\""
    ].join("\n");
    const pyproject = [
      "[tool.poetry]",
      "name = \"fixture-poetry-cycle\"",
      "version = \"0.1.0\"",
      "",
      "[tool.poetry.dependencies]",
      "python = \"^3.12\"",
      "requests = \"^2.32.3\""
    ].join("\n");

    const result = parsePoetryLockText(poetryLock, "fixture-poetry-cycle/poetry.lock", {
      pyprojectText: pyproject
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "requests@2.32.3"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-poetry-cycle", "requests@2.32.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "urllib3@2.5.0"))
      .toMatchObject({
        ecosystem: "pypi",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-poetry-cycle", "requests@2.32.3", "urllib3@2.5.0"]]
      });
  });

  test("falls back to inferred roots when pyproject.toml is unavailable", () => {
    const result = parsePoetryLockText(
      [
        "[[package]]",
        "name = \"leaf\"",
        "version = \"1.0.0\"",
        "category = \"main\"",
        "optional = false",
        "",
        "[[package]]",
        "name = \"root\"",
        "version = \"2.0.0\"",
        "category = \"main\"",
        "optional = false",
        "",
        "[package.dependencies]",
        "leaf = \"^1.0.0\""
      ].join("\n"),
      "project/poetry.lock"
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
    const result = parsePoetryLockText(
      [
        "[[package]]",
        "name = \"missing-version\""
      ].join("\n"),
      "poetry.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed poetry.lock to fail.");
    }

    expect(result.error.code).toBe("POETRY_LOCK_PARSE_FAILED");
  });
});
