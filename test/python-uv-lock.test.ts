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
