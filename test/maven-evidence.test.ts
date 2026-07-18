import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectMavenPackageEvidence } from "../src/evidence/maven-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";

describe("collectMavenPackageEvidence", () => {
  test("reads license evidence from local Maven POM metadata", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-evidence-"));
    const pomDir = path.join(
      projectRoot,
      ".m2",
      "repository",
      "org",
      "example",
      "demo",
      "1.2.3"
    );

    try {
      mkdirSync(pomDir, { recursive: true });
      writeFileSync(
        path.join(pomDir, "demo-1.2.3.pom"),
        [
          "<project>",
          "  <groupId>org.example</groupId>",
          "  <artifactId>demo</artifactId>",
          "  <version>1.2.3</version>",
          "  <licenses>",
          "    <license>",
          "      <name>Apache License, Version 2.0</name>",
          "      <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>",
          "    </license>",
          "  </licenses>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const evidence = collectMavenPackageEvidence({
        packageId: "org.example:demo@1.2.3",
        coordinates: "org.example:demo",
        version: "1.2.3",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "org.example:demo@1.2.3",
        metadataLicense: "Apache License, Version 2.0",
        metadataSource: "pom.xml",
        source: "local"
      });

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        original: "Apache License, Version 2.0",
        expression: "Apache-2.0",
        choices: ["Apache-2.0"],
        confidence: "medium"
      });
      expect(normalized.evidenceSources).toContain("pom.xml license: Apache License, Version 2.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports missing local Maven POM metadata with a recovery hint", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-missing-evidence-"));

    try {
      const evidence = collectMavenPackageEvidence({
        packageId: "org.example:missing@1.2.3",
        coordinates: "org.example:missing",
        version: "1.2.3",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "org.example:missing@1.2.3",
        files: [],
        source: "unavailable",
        warnings: [
          "Maven POM metadata for org.example:missing@1.2.3 was not found in local .m2/repository caches; run Maven/Gradle dependency resolution first or provide a project .m2/repository cache."
        ]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("inherits license evidence from a bounded local Maven parent POM", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-parent-evidence-"));

    try {
      writeMavenPom(projectRoot, "org.example", "demo", "1.2.3", [
        "<project>",
        "  <parent>",
        "    <groupId>org.example</groupId>",
        "    <artifactId>parent</artifactId>",
        "    <version>4.5.6</version>",
        "  </parent>",
        "  <artifactId>demo</artifactId>",
        "  <version>1.2.3</version>",
        "</project>"
      ].join("\n"));
      writeMavenPom(projectRoot, "org.example", "parent", "4.5.6", [
        "<project>",
        "  <groupId>org.example</groupId>",
        "  <artifactId>parent</artifactId>",
        "  <version>4.5.6</version>",
        "  <licenses>",
        "    <license><name>Eclipse Public License - v 2.0</name></license>",
        "  </licenses>",
        "</project>"
      ].join("\n"));

      const evidence = collectMavenPackageEvidence({
        packageId: "org.example:demo@1.2.3",
        coordinates: "org.example:demo",
        version: "1.2.3",
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) throw new Error(evidence.error.message);
      expect(evidence.value).toMatchObject({
        metadataLicense: "Eclipse Public License - v 2.0",
        metadataSource: "parent pom.xml (org.example:parent@4.5.6)",
        source: "local",
        warnings: []
      });
      expect(normalizeLicenseEvidence(evidence.value)).toMatchObject({
        expression: "EPL-2.0",
        choices: ["EPL-2.0"]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails closed on a local Maven parent cycle", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-parent-cycle-"));

    try {
      writeMavenPom(projectRoot, "org.example", "demo", "1.2.3", [
        "<project>",
        "  <parent>",
        "    <groupId>org.example</groupId>",
        "    <artifactId>parent</artifactId>",
        "    <version>4.5.6</version>",
        "  </parent>",
        "  <artifactId>demo</artifactId>",
        "  <version>1.2.3</version>",
        "</project>"
      ].join("\n"));
      writeMavenPom(projectRoot, "org.example", "parent", "4.5.6", [
        "<project>",
        "  <parent>",
        "    <groupId>org.example</groupId>",
        "    <artifactId>demo</artifactId>",
        "    <version>1.2.3</version>",
        "  </parent>",
        "  <artifactId>parent</artifactId>",
        "  <version>4.5.6</version>",
        "</project>"
      ].join("\n"));

      const evidence = collectMavenPackageEvidence({
        packageId: "org.example:demo@1.2.3",
        coordinates: "org.example:demo",
        version: "1.2.3",
        projectRoot
      });

      expect(evidence.ok).toBe(false);
      if (evidence.ok) throw new Error("Expected Maven parent cycle failure.");
      expect(evidence.error).toMatchObject({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: "unsupported_input",
        details: { reason: "parent_cycle" }
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function writeMavenPom(
  projectRoot: string,
  groupId: string,
  artifactId: string,
  version: string,
  text: string
): void {
  const pomDir = path.join(
    projectRoot,
    ".m2",
    "repository",
    ...groupId.split("."),
    artifactId,
    version
  );
  mkdirSync(pomDir, { recursive: true });
  writeFileSync(path.join(pomDir, `${artifactId}-${version}.pom`), text, "utf8");
}
