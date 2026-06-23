import { describe, expect, test } from "bun:test";

import { parseGradleVersionCatalogText } from "../src/graph/java-gradle-version-catalog";

describe("parseGradleVersionCatalogText", () => {
  test("parses exact Maven library aliases from a Gradle version catalog", () => {
    const result = parseGradleVersionCatalogText(
      [
        "[versions]",
        "commons = \"3.14.0\"",
        "",
        "[libraries]",
        "commons-lang3 = { module = \"org.apache.commons:commons-lang3\", version.ref = \"commons\" }",
        "guava = \"com.google.guava:guava:33.2.1-jre\"",
        "junit = { group = \"junit\", name = \"junit\", version = \"4.13.2\" }",
        "junit4 = { module = \"junit:junit\", version = \"4.13.2\" }"
      ].join("\n"),
      "fixture-gradle/gradle/libs.versions.toml"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-gradle");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "com.google.guava:guava@33.2.1-jre",
        name: "com.google.guava:guava",
        installNames: ["guava"],
        version: "33.2.1-jre",
        ecosystem: "maven",
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-gradle", "guava", "com.google.guava:guava@33.2.1-jre"]]
      }),
      expect.objectContaining({
        id: "junit:junit@4.13.2",
        name: "junit:junit",
        installNames: ["junit", "junit4"],
        version: "4.13.2",
        ecosystem: "maven",
        dependencyType: "unknown",
        direct: true,
        paths: [
          ["fixture-gradle", "junit", "junit:junit@4.13.2"],
          ["fixture-gradle", "junit4", "junit:junit@4.13.2"]
        ]
      }),
      expect.objectContaining({
        id: "org.apache.commons:commons-lang3@3.14.0",
        name: "org.apache.commons:commons-lang3",
        installNames: ["commons-lang3"],
        version: "3.14.0",
        ecosystem: "maven",
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-gradle", "commons-lang3", "org.apache.commons:commons-lang3@3.14.0"]]
      })
    ]);
  });

  test("rejects library aliases without an exact Maven module version", () => {
    const result = parseGradleVersionCatalogText(
      [
        "[libraries]",
        "ranged = { module = \"org.example:ranged\", version = { strictly = \"[1.0,2.0)\" } }"
      ].join("\n"),
      "gradle/libs.versions.toml"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected rich Gradle catalog version to fail.");
    }

    expect(result.error.code).toBe("GRADLE_VERSION_CATALOG_PARSE_FAILED");
  });
});
