import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseGradleLockfile, parseGradleLockText } from "../src/graph/java-gradle-lock";

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

  test("uses the project root name for legacy Gradle dependency-locks files", () => {
    const result = parseGradleLockText(
      "org.example:demo:1.2.3=runtimeClasspath\n",
      "fixture-java/gradle/dependency-locks/runtimeClasspath.lockfile"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-java");
    expect(result.value.nodes[0]?.paths).toEqual([
      ["fixture-java", "org.example:demo@1.2.3"]
    ]);
  });

  test("merges legacy Gradle dependency-locks directory files", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-lock-dir-"));
    const lockDir = path.join(projectDir, "gradle", "dependency-locks");

    try {
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        path.join(lockDir, "runtimeClasspath.lockfile"),
        "org.example:prod:1.0.0=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(lockDir, "testRuntimeClasspath.lockfile"),
        "org.example:test:2.0.0=testRuntimeClasspath\n",
        "utf8"
      );

      const result = parseGradleLockfile(lockDir);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      const rootName = path.basename(projectDir);
      expect(result.value.rootName).toBe(rootName);
      expect(result.value.nodes.map((node) => node.id)).toEqual([
        "org.example:prod@1.0.0",
        "org.example:test@2.0.0"
      ]);
      expect(result.value.nodes.find((node) => node.id === "org.example:prod@1.0.0"))
        .toMatchObject({
          dependencyType: "production",
          paths: [[rootName, "org.example:prod@1.0.0"]]
        });
      expect(result.value.nodes.find((node) => node.id === "org.example:test@2.0.0"))
        .toMatchObject({
          dependencyType: "development",
          paths: [[rootName, "org.example:test@2.0.0"]]
        });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
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
