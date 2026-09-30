import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePackageLockText } from "../src/graph/npm-package-lock";
import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../src/graph/merge";
import { filterGraphForProdOnly } from "../src/cli/scan-policy";
import { buildScanCompleteness } from "../src/policy/completeness";
import type { DependencyGraph } from "../src/graph/types";
import { main } from "../src/cli/main";
import { ok, err } from "../src/shared/result";
import { createError } from "../src/shared/errors";
import { JsonSchemaRegistry } from "./support/json-schema-validator";

function parse(packages: Record<string, unknown>): DependencyGraph {
  const result = parsePackageLockText(JSON.stringify({ name: "app", lockfileVersion: 3, packages }));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const registry = new JsonSchemaRegistry(["common", "scan-report", "diff-report"].map((name) =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8"))));

test("missing root and transitive requests are explicit and independent of input key order", () => {
  const packages = {
    "": { name: "app", dependencies: { parent: "1.0.0", missing: "1.0.0" } },
    "node_modules/parent": { version: "1.0.0", dependencies: { child: "1.0.0" } }
  };
  const graph = parse(packages);
  const reversed = parse(Object.fromEntries(Object.entries(packages).reverse()));
  expect(graph.unresolvedDependencies).toEqual(reversed.unresolvedDependencies);
  expect(graph.unresolvedDependencies).toContainEqual({ name: "missing", dependencyType: "production", reason: "missing_installation" });
  expect(graph.unresolvedDependencies).toContainEqual({ from: "parent@1.0.0", name: "child", dependencyType: "production", reason: "missing_installation" });
  expect(buildScanCompleteness({ graph, evidence: [] }).status).toBe("partial");
});

test("name-based recovery retains the known package while declaring the installation unproven", () => {
  const graph = parse({
    "": { dependencies: { child: "1.0.0" } },
    "node_modules/unrelated/node_modules/child": { version: "1.0.0" }
  });
  expect(graph.nodes[0]?.id).toBe("child@1.0.0");
  expect(graph.unresolvedDependencies).toEqual([{ name: "child", dependencyType: "production", reason: "unproven_installation" }]);
});

test("unresolved request records omit credential-bearing source specifications", () => {
  const graph = parse({ "": { dependencies: { missing: "git+https://user:secret@example.test/private.git" } } });
  const report = JSON.stringify(buildScanCompleteness({ graph, evidence: [] }));
  expect(report).toContain("missing_installation");
  expect(report).not.toContain("secret");
  expect(report).not.toContain("private.git");
});

test("uninstalled optional dependencies and optional peers are valid omissions", () => {
  const graph = parse({
    "": {
      dependencies: { optional: "1.0.0", constructor: "1.0.0" },
      optionalDependencies: { optional: "1.0.0" },
      peerDependencies: { optionalPeer: "1.0.0", requiredPeer: "1.0.0" },
      peerDependenciesMeta: { optionalPeer: { optional: true } }
    },
    "node_modules/constructor": { version: "1.0.0" },
    "node_modules/requiredPeer": { version: "1.0.0" }
  });
  expect(graph.unresolvedDependencies).toBeUndefined();
  expect(graph.nodes.map((item) => item.name)).toEqual(["constructor", "requiredPeer"]);
  expect(buildScanCompleteness({ graph, evidence: [] }).status).toBe("complete");
});

test("production scope excludes development requests and preserves missing production descendants", () => {
  const graph = parse({
    "": { dependencies: { runtime: "1.0.0" }, devDependencies: { missingDev: "1.0.0" } },
    "node_modules/runtime": { version: "1.0.0", dependencies: { missingRuntime: "1.0.0" } }
  });
  expect(graph.unresolvedDependencies).toHaveLength(2);
  const filtered = filterGraphForProdOnly(graph, true);
  expect(filtered.unresolvedDependencies).toEqual([{
    from: "runtime@1.0.0", name: "missingRuntime", dependencyType: "production", reason: "missing_installation"
  }]);
  const devOnly = parse({ "": { devDependencies: { missingDev: "1.0.0" } } });
  expect(buildScanCompleteness({ graph: filterGraphForProdOnly(devOnly, true), evidence: [] }).status).toBe("complete");
});

test("npm v1 exposes missing requires entries without inventing a package", () => {
  const result = parsePackageLockText(JSON.stringify({
    lockfileVersion: 1, dependencies: { parent: { version: "1.0.0", requires: { missing: "1.0.0" } } }
  }));
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.nodes).toHaveLength(1);
  expect(result.value.unresolvedDependencies).toEqual([{
    from: "parent@1.0.0", name: "missing", dependencyType: "production", reason: "missing_installation"
  }]);
});

test("bounded display paths cannot hide a missing request in another installation", () => {
  const packages: Record<string, unknown> = { "": { dependencies: Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`parent-${index}`, "1.0.0"])) } };
  for (let index = 0; index < 65; index++) {
    packages[`node_modules/parent-${index}`] = { version: "1.0.0", dependencies: { shared: "1.0.0" } };
    packages[`node_modules/parent-${index}/node_modules/shared`] = {
      version: "1.0.0", ...(index === 64 ? { dependencies: { missing: "1.0.0" } } : {})
    };
  }
  const graph = parse(packages);
  expect(graph.nodes.find((item) => item.name === "shared")?.paths).toHaveLength(64);
  expect(graph.unresolvedDependencies).toContainEqual({
    from: "shared@1.0.0", name: "missing", dependencyType: "production", reason: "missing_installation"
  });
});

test("graph merging remaps unresolved parent identities across ecosystems", () => {
  const sources: SourcedDependencyGraph[] = ["npm", "pypi"].map((ecosystem) => ({
    source: { lockfileKind: ecosystem === "npm" ? "package-lock" : "uv-lock", lockfilePath: `${ecosystem}.lock` },
    graph: {
      lockfilePath: `${ecosystem}.lock`,
      nodes: [{ id: "parent@1", name: "parent", version: "1", ecosystem: ecosystem as "npm" | "pypi", dependencyType: "production", direct: true, paths: [] }],
      unresolvedDependencies: [{ from: "parent@1", name: "missing", dependencyType: "production", reason: "missing_installation" }]
    }
  }));
  const graph = mergeDependencyGraphs(sources);
  expect(graph.unresolvedDependencies).toEqual(mergeDependencyGraphs([...sources].reverse()).unresolvedDependencies);
  expect(graph.unresolvedDependencies?.map((item) => item.from)).toEqual(["pkg:npm/parent@1", "pkg:pypi/parent@1"]);
});

test("inspection dimensions distinguish known graph, unknown license and unavailable evidence", () => {
  const graph: DependencyGraph = { lockfilePath: "bom.json", nodes: [], edges: [], diagnostics: [{
    code: "dependency_paths_truncated", affectedNodeCount: 1, limit: 64, message: "Display paths limited"
  }] };
  const complete = buildScanCompleteness({ graph, evidence: [], normalizedLicenses: [] });
  expect(complete.status).toBe("complete");
  expect(complete.dimensions?.graph.status).toBe("complete");
  const unknown = parse({ "": { dependencies: { package: "1.0.0" } }, "node_modules/package": { version: "1.0.0" } });
  const unidentified = buildScanCompleteness({ graph: unknown, evidence: [{ packageId: "package@1.0.0", source: "sbom", files: [], warnings: [] }], normalizedLicenses: [] });
  expect(unidentified.status).toBe("complete");
  expect(unidentified.dimensions?.graph.status).toBe("complete");
  expect(unidentified.dimensions?.licenses.status).toBe("unidentified");
  const unavailable = buildScanCompleteness({ graph: unknown, evidence: [{ packageId: "package@1.0.0", source: "unavailable", files: [], warnings: [], artifactIdentityConflict: true }] });
  expect(unavailable.status).toBe("partial");
  expect(unavailable.dimensions?.evidence.artifactConflictPackageCount).toBe(1);
});

function lockfile(missing: boolean): string {
  return JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": { name: "app", dependencies: missing ? { missing: "1.0.0" } : {} } } });
}

test("CI and all report formats retain the same incomplete graph status", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ohrisk-inspection-"));
  try {
    writeFileSync(path.join(cwd, "package-lock.json"), lockfile(true));
    const execute = async (command: string, flags: string[]) => {
      const stdout: string[] = [], stderr: string[] = [];
      const exit = await main([command, "--offline", ...flags], { cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
      expect(stderr).toEqual([]);
      return { exit, output: stdout.join("\n") };
    };
    const strict = await execute("ci", ["--json", "--fail-on", "high"]);
    const report = JSON.parse(strict.output);
    expect(strict.exit).toBe(1);
    expect(report.completeness.unavailablePackageCount).toBe(0);
    expect(report.completeness.unresolvedDependencyCount).toBe(1);
    expect(report.completeness.dimensions.graph.status).toBe("partial");
    expect(report.completeness.dimensions.evidence.status).toBe("complete");
    expect(registry.validate(report.$schema, report)).toEqual([]);
    const invalid = structuredClone(report);
    invalid.completeness.dimensions.graph.status = "invented";
    expect(registry.validate(invalid.$schema, invalid).length).toBeGreaterThan(0);
    expect((await execute("ci", ["--json", "--allow-partial-evidence"])).exit).toBe(0);
    for (const flag of ["--markdown", "--html"]) {
      const rendered = await execute("scan", [flag]);
      expect(rendered.exit).toBe(0);
      expect(rendered.output).toContain("1 unresolved dependency requests");
    }
    const sarif = JSON.parse((await execute("scan", ["--sarif"])).output);
    expect(sarif.runs[0].properties.ohriskCompleteness).toEqual(report.completeness);
    const cdx = JSON.parse((await execute("scan", ["--cyclonedx"])).output);
    const property = cdx.metadata.properties.find((item: { name: string }) => item.name === "ohrisk:completeness");
    expect(JSON.parse(property.value)).toEqual(report.completeness);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const side of ["baseline", "current"] as const) {
  test(`gated diff rejects missing ${side} graph requests even with zero unavailable evidence`, async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ohrisk-inspection-diff-"));
    try {
      writeFileSync(path.join(cwd, "package-lock.json"), lockfile(side === "current"));
      const execute = async (flags: string[]) => {
        const stdout: string[] = [], stderr: string[] = [];
        const exit = await main(["diff", "main", "--offline", "--json", ...flags], {
          cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text),
          listRefFiles: () => ok(["package-lock.json"]),
          readRefFile: ({ relativePath }) => relativePath === "package-lock.json" ? ok(lockfile(side === "baseline"))
            : err(createError({ code: "GIT_REF_FILE_NOT_FOUND", category: "invalid_input", message: "Absent fixture file" }))
        });
        expect(stderr).toEqual([]);
        return { exit, report: JSON.parse(stdout.join("\n")) };
      };
      const strict = await execute(["--fail-on", "high"]);
      expect(strict.exit).toBe(1);
      expect(strict.report.completeness[side].unavailablePackageCount).toBe(0);
      expect(strict.report.completeness[side].unresolvedDependencyCount).toBe(1);
      expect(registry.validate(strict.report.$schema, strict.report)).toEqual([]);
      expect((await execute(["--fail-on", "high", "--allow-partial-evidence"])).exit).toBe(0);
      expect((await execute([])).exit).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
