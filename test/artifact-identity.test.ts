import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectGraphEvidence } from "../src/evidence/collect";
import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../src/graph/merge";
import { mergeArtifactIdentity } from "../src/graph/artifact-identity";
import type { DependencyArtifact, DependencyNode } from "../src/graph/types";
import { buildScanCompleteness } from "../src/policy/completeness";
import { main } from "../src/cli/main";
import { createTarGz, integrityFor } from "./helpers/tar";
import { JsonSchemaRegistry } from "./support/json-schema-validator";

function node(artifact: DependencyArtifact = {}): DependencyNode {
  return {
    id: "example@1.0.0", name: "example", version: "1.0.0", ecosystem: "npm",
    dependencyType: "production", direct: true, paths: [["app", "example@1.0.0"]], ...artifact
  };
}

function input(artifact: DependencyArtifact, index: number): SourcedDependencyGraph {
  return {
    source: { lockfileKind: "package-lock", lockfilePath: `input-${index}.lock` },
    graph: { lockfilePath: `input-${index}.lock`, nodes: [node(artifact)] }
  };
}

test("conflicting artifacts retain all declarations without choosing an input", async () => {
  const variants = [
    { resolved: "https://registry.npmjs.org/example/a.tgz", integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}` },
    { resolved: "https://registry.npmjs.org/example/b.tgz", integrity: `sha512-${Buffer.alloc(64, 2).toString("base64")}` },
    { resolved: "https://registry.npmjs.org/example/c.tgz" }
  ];
  const inputs = variants.map(input);
  const forward = mergeDependencyGraphs(inputs);
  const reverse = mergeDependencyGraphs([...inputs].reverse());
  expect(forward.nodes[0]?.artifactVariants).toEqual(reverse.nodes[0]?.artifactVariants);
  expect(forward.nodes[0]?.artifactVariants).toHaveLength(3);
  expect(forward.nodes[0]?.artifactIdentityConflict).toBe(true);
  expect(forward.nodes[0]?.resolved).toBeUndefined();
  expect(forward.nodes[0]?.integrity).toBeUndefined();
  expect(forward.warnings).toEqual(reverse.warnings);
  let fetches = 0;
  const evidence = await collectGraphEvidence({
    graph: forward, projectRoot: tmpdir(),
    fetchArtifact: async () => { fetches++; throw new Error("Conflicts must not fetch"); }
  });
  if (!evidence.ok) throw new Error(evidence.error.message);
  expect(fetches).toBe(0);
  expect(evidence.value[0]?.artifactIdentityConflict).toBe(true);
  expect(buildScanCompleteness({ evidence: evidence.value }).status).toBe("partial");
});

test("equal digest encodings share mirror collection and verify the collected bytes", async () => {
  const tarball = createTarGz({
    "package/package.json": JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }),
    "package/LICENSE": "MIT License fixture text."
  });
  const integrity = integrityFor(tarball);
  const inputs = [
    input({ resolved: "https://registry.npmjs.org/example/b.tgz", integrity }, 0),
    input({ resolved: "https://registry.npmjs.org/example/a.tgz", integrity: integrity.replace(/=+$/, "") }, 1)
  ];
  const graph = mergeDependencyGraphs(inputs);
  const reversed = mergeDependencyGraphs([...inputs].reverse());
  expect(graph.nodes[0]?.resolved).toBe(reversed.nodes[0]?.resolved);
  expect(graph.nodes[0]?.integrity).toBe(integrity);
  expect(graph.nodes[0]?.artifactIdentityConflict).toBeUndefined();
  expect(graph.warnings).toBeUndefined();
  let fetches = 0;
  const evidence = await collectGraphEvidence({
    graph, projectRoot: tmpdir(), allowLocalProjectEvidence: false,
    fetchArtifact: async () => { fetches++; return new Response(new Uint8Array(tarball)); }
  });
  if (!evidence.ok) throw new Error(evidence.error.message);
  expect(fetches).toBe(1);
  expect(evidence.value[0]?.source).toBe("tarball");
  expect(evidence.value[0]?.packageJsonLicense).toBe("MIT");
  const tampered = await collectGraphEvidence({
    graph, projectRoot: tmpdir(), allowLocalProjectEvidence: false,
    fetchArtifact: async () => new Response(new Uint8Array(createTarGz({ "package/LICENSE": "different bytes" })))
  });
  expect(tampered.ok).toBe(false);
  if (!tampered.ok) expect(tampered.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
});

test("missing metadata can merge, but unverified mirrors and internal checksum conflicts cannot", () => {
  expect(mergeArtifactIdentity(node(), node()).artifactIdentityConflict).toBeUndefined();
  expect(mergeArtifactIdentity(node(), node({ resolved: "same" })).resolved).toBe("same");
  expect(mergeArtifactIdentity(node({ resolved: "a" }), node({ resolved: "b" })).artifactIdentityConflict).toBe(true);
  expect(mergeArtifactIdentity(node({ resolved: "a", integrity: "unsupported-pin" }),
    node({ resolved: "b", integrity: "unsupported-pin" })).artifactIdentityConflict).toBe(true);
  for (const field of ["yarnCacheChecksum", "goModIntegrity"] as const) {
    expect(mergeArtifactIdentity(node({ [field]: "a" }), node({ [field]: "b" })).artifactIdentityConflict).toBe(true);
  }
});

test("CI cannot use local or embedded evidence to hide an artifact identity conflict", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ohrisk-artifact-conflict-"));
  try {
    for (const [filename, suffix] of [["package-lock.json", "a"], ["npm-shrinkwrap.json", "b"]]) {
      writeFileSync(path.join(cwd, filename!), JSON.stringify({
        name: "app", lockfileVersion: 3, packages: {
          "": { name: "app", dependencies: { example: "1.0.0" } },
          "node_modules/example": { version: "1.0.0", resolved: `https://registry.npmjs.org/example/${suffix}.tgz` }
        }
      }));
    }
    writeFileSync(path.join(cwd, "cyclonedx.json"), JSON.stringify({
      bomFormat: "CycloneDX", specVersion: "1.5",
      components: [{ "bom-ref": "example", purl: "pkg:npm/example@1.0.0", licenses: [{ license: { id: "MIT" } }] }]
    }));
    const execute = async (flags: string[]) => {
      const stdout: string[] = [], stderr: string[] = [];
      const exit = await main(["ci", "--all", "--offline", "--json", "--fail-on", "high", ...flags], {
        cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text)
      });
      expect(stderr).toEqual([]);
      return { exit, report: JSON.parse(stdout.join("\n")) };
    };
    const strict = await execute([]);
    expect(strict.exit).toBe(1);
    expect(strict.report.completeness.status).toBe("partial");
    expect(strict.report.evidence.diagnostics).toContainEqual({
      code: "artifact_identity_conflict", source: "unavailable", packageCount: 1, occurrenceCount: 1
    });
    const registry = new JsonSchemaRegistry(["common", "scan-report"].map((name) =>
      JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8"))));
    expect(registry.validate(strict.report.$schema, strict.report)).toEqual([]);
    const allowed = await execute(["--allow-partial-evidence"]);
    expect(allowed.exit).toBe(0);
    expect(allowed.report.completeness).toEqual(strict.report.completeness);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
