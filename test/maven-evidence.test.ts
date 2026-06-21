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
});
