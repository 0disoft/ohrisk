import { describe, expect, test } from "bun:test";

import { collectMavenJarEvidence } from "../src/evidence/maven-jar";
import { createZip } from "./helpers/zip";

const coordinates = {
  groupId: "org.example",
  artifactId: "demo",
  version: "1.2.3"
};

describe("collectMavenJarEvidence", () => {
  test("collects root and META-INF license files after exact embedded identity validation", () => {
    const result = collectMavenJarEvidence({
      packageId: "org.example:demo@1.2.3",
      coordinates,
      jar: createZip({
        "META-INF/maven/org.example/demo/pom.properties": "groupId=org.example\nartifactId=demo\nversion=1.2.3\n",
        "META-INF/LICENSE.txt": "Eclipse Public License Version 2.0",
        NOTICE: "Copyright example",
        "nested/dependency/LICENSE": "must not be attributed to the package"
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      packageId: "org.example:demo@1.2.3",
      source: "tarball",
      files: [
        { path: "META-INF/LICENSE.txt", kind: "license" },
        { path: "NOTICE", kind: "notice" }
      ]
    });
  });

  test("does not trust a Maven JAR without exact embedded package identity", () => {
    const result = collectMavenJarEvidence({
      packageId: "org.example:demo@1.2.3",
      coordinates,
      jar: createZip({ "META-INF/LICENSE": "MIT License" })
    });

    expect(result).toEqual({
      ok: true,
      value: {
        packageId: "org.example:demo@1.2.3",
        files: [],
        source: "unavailable",
        warnings: [
          "Checksum-verified Maven JAR did not contain exact embedded pom.properties identity; its contents were not trusted."
        ]
      }
    });
  });

  test("fails closed when embedded Maven JAR identity disagrees with the request", () => {
    const result = collectMavenJarEvidence({
      packageId: "org.example:demo@1.2.3",
      coordinates,
      jar: createZip({
        "META-INF/maven/org.example/demo/pom.properties": "groupId=org.example\nartifactId=forged\nversion=1.2.3\n"
      })
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Maven JAR identity mismatch.");
    expect(result.error).toMatchObject({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      details: { reason: "maven_jar_identity_mismatch" }
    });
  });
});
