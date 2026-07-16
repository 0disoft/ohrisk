import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadArchiveProject } from "../src/archive/archive-project";
import { readArchiveBytes, type ArchiveFormat } from "../src/archive/archive-reader";

type FixtureProvenance = {
  path: string;
  format: ArchiveFormat;
  decodedBytes: number;
  sha256: string;
  producer: string;
  producerVersion: string;
};

type ProvenanceManifest = {
  fixtures: FixtureProvenance[];
};

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "archive");
const provenance = JSON.parse(
  readFileSync(join(fixtureDir, "provenance.json"), "utf8")
) as ProvenanceManifest;

describe("archive interoperability corpus", () => {
  for (const fixture of provenance.fixtures) {
    test(`reads ${fixture.format} produced by ${fixture.producer} ${fixture.producerVersion}`, () => {
      const encoded = readFileSync(join(fixtureDir, fixture.path), "utf8").trim();
      const bytes = Buffer.from(encoded, "base64");

      expect(bytes.byteLength).toBe(fixture.decodedBytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);

      const archive = readArchiveBytes({
        displayName: fixture.path.replace(/\.b64$/, ""),
        bytes,
        formatHint: fixture.format
      });
      expect(archive.ok).toBe(true);
      if (!archive.ok) throw new Error(archive.error.message);

      const paths = archive.value.listPaths();
      expect(paths).toContain("docs/README.txt");
      expect(paths).toContain("package-lock.json");
      expect(archive.value.readText("docs/README.txt")).toEqual({
        ok: true,
        value: "external tool fixture"
      });

      const project = loadArchiveProject({ source: archive.value });
      expect(project.ok).toBe(true);
      if (!project.ok) throw new Error(project.error.message);
      expect(project.value.graph.nodes.map((node) => node.name)).toEqual(["left-pad"]);
    });
  }
});
