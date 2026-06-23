import { describe, expect, test } from "bun:test";

import { parsePubspecLockText } from "../src/graph/dart-pubspec-lock";

describe("parsePubspecLockText", () => {
  test("parses Dart pubspec.lock package entries", () => {
    const result = parsePubspecLockText(
      [
        "packages:",
        "  risk_package:",
        "    dependency: \"direct main\"",
        "    description:",
        "      name: risk_package",
        "      url: \"https://pub.dev\"",
        "    source: hosted",
        "    version: \"1.0.0\"",
        "  dev_tool:",
        "    dependency: \"direct dev\"",
        "    description:",
        "      name: dev_tool",
        "      url: \"https://pub.dev\"",
        "    source: hosted",
        "    version: \"2.0.0\"",
        "  transitive_package:",
        "    dependency: transitive",
        "    description:",
        "      name: transitive_package",
        "      url: \"https://pub.dev\"",
        "    source: hosted",
        "    version: \"3.0.0\"",
        "  flutter:",
        "    dependency: transitive",
        "    description: flutter",
        "    source: sdk",
        "    version: \"0.0.0\""
      ].join("\n"),
      "fixture-dart/pubspec.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-dart");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "dev_tool@2.0.0",
      "risk_package@1.0.0",
      "transitive_package@3.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "risk_package@1.0.0"))
      .toMatchObject({
        ecosystem: "pub",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-dart", "risk_package@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "dev_tool@2.0.0"))
      .toMatchObject({
        ecosystem: "pub",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-dart", "dev_tool@2.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "transitive_package@3.0.0"))
      .toMatchObject({
        ecosystem: "pub",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-dart", "transitive_package@3.0.0"]]
      });
  });

  test("reports malformed pubspec.lock entries as typed errors", () => {
    const result = parsePubspecLockText(
      [
        "packages:",
        "  missing_version:",
        "    dependency: \"direct main\"",
        "    source: hosted"
      ].join("\n"),
      "pubspec.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed pubspec.lock to fail.");
    }

    expect(result.error.code).toBe("PUBSPEC_LOCK_PARSE_FAILED");
  });
});
