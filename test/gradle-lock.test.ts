import { describe, expect, test } from "bun:test";

import { parseGradleLockText } from "../src/graph/java-gradle-lock";

describe("parseGradleLockText", () => {
  test("parses Maven coordinates from a Gradle dependency lockfile", () => {
    const result = parseGradleLockText(
      [
        "# This is a Gradle generated file for dependency locking.",
        "org.apache.commons:commons-lang3:3.14.0=compileClasspath,runtimeClasspath",
        "junit:junit:4.13.2=testRuntimeClasspath",
        "empty=annotationProcessor"
      ].join("\n"),
      "fixture-java/gradle.lockfile"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-java");
    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "junit:junit@4.13.2",
        name: "junit:junit",
        version: "4.13.2",
        ecosystem: "maven",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-java", "junit:junit@4.13.2"]]
      }),
      expect.objectContaining({
        id: "org.apache.commons:commons-lang3@3.14.0",
        name: "org.apache.commons:commons-lang3",
        version: "3.14.0",
        ecosystem: "maven",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-java", "org.apache.commons:commons-lang3@3.14.0"]]
      })
    ]);
  });

  test("reports malformed lockfile entries as typed errors", () => {
    const result = parseGradleLockText("not-a-coordinate=runtimeClasspath", "gradle.lockfile");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed gradle.lockfile to fail.");
    }

    expect(result.error.code).toBe("GRADLE_LOCK_PARSE_FAILED");
  });
});
