import { expect, test } from "bun:test";
import { parsePackageLockText } from "../src/graph/npm-package-lock";
import { parsePnpmLockText } from "../src/graph/npm-pnpm-lock";
import { parseUvLockText } from "../src/graph/python-uv-lock";
import { extendGraphWithRecordDependencies } from "../src/graph/record-dependency-edges";
import { filterGraphForProdOnly } from "../src/cli/scan-policy";
import { renderCycloneDxReport } from "../src/report/cyclonedx-report";
import type { DependencyGraph } from "../src/graph/types";

function checked(result: ReturnType<typeof parsePackageLockText>): DependencyGraph {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("npm installation traversal retains descendants of the 65th shared installation", () => {
  const packages: Record<string, unknown> = { "": { name: "app", dependencies: Object.fromEntries(
    Array.from({ length: 65 }, (_, i) => [`parent-${i}`, "1.0.0"])) } };
  for (let i = 0; i < 65; i++) {
    packages[`node_modules/parent-${i}`] = { version: "1.0.0", dependencies: { shared: "1.0.0" } };
    packages[`node_modules/parent-${i}/node_modules/shared`] = { version: "1.0.0", dependencies: { [`leaf-${i}`]: "1.0.0" } };
    packages[`node_modules/leaf-${i}`] = { version: "1.0.0" };
  }
  const graph = checked(parsePackageLockText(JSON.stringify({ lockfileVersion: 3, packages })));
  const reversed = checked(parsePackageLockText(JSON.stringify({ lockfileVersion: 3,
    packages: Object.fromEntries(Object.entries(packages).reverse()) })));
  expect(graph.edges).toEqual(reversed.edges);
  expect(graph.edges?.filter((edge) => edge.to === "shared@1.0.0")).toHaveLength(65);
  expect(graph.edges?.filter((edge) => edge.from === "shared@1.0.0")).toHaveLength(65);
  expect(graph.nodes.filter((node) => node.name.startsWith("leaf-"))).toHaveLength(65);
  expect(graph.nodes.find((node) => node.id === "shared@1.0.0")?.paths.length).toBeLessThanOrEqual(64);
  const report = JSON.parse(renderCycloneDxReport({
    project: { rootDir: "/app", lockfile: { kind: "package-lock", path: "/app/package-lock.json" } },
    graph: filterGraphForProdOnly(graph, true), normalizedLicenses: [], riskFindings: [], waiverMode: "ignored"
  }));
  expect(report.dependencies.find((edge: { ref: string }) => edge.ref === "pkg:npm/shared@1.0.0").dependsOn).toHaveLength(65);
});

test("npm v1 retains cycle edges and marks the inferred root relationships unknown", () => {
  const graph = checked(parsePackageLockText(JSON.stringify({ name: "app", lockfileVersion: 1, dependencies: {
    a: { version: "1.0.0", requires: { b: "1.0.0" } },
    b: { version: "1.0.0", requires: { a: "1.0.0" } }
  } })));
  expect(graph.edges).toContainEqual({ from: "a@1.0.0", to: "b@1.0.0", dependencyType: "production" });
  expect(graph.edges).toContainEqual({ from: "b@1.0.0", to: "a@1.0.0", dependencyType: "production" });
  expect(graph.rootDependenciesUnknown).toBe(true);
});

for (const format of ["pnpm", "uv"] as const) {
  test(`${format} retains all 65 incoming edges and descendants beyond display truncation`, () => {
    const parents = Array.from({ length: 65 }, (_, i) => `parent-${i}`);
    const text = format === "pnpm"
      ? `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n${parents.map((p) => `      ${p}: '1.0.0'`).join("\n")}\npackages:\n${[...parents, "shared", "leaf"].map((p) => `  ${p}@1.0.0: {}`).join("\n")}\nsnapshots:\n${parents.map((p) => `  ${p}@1.0.0:\n    dependencies:\n      shared: '1.0.0'`).join("\n")}\n  shared@1.0.0:\n    dependencies:\n      leaf: '1.0.0'\n  leaf@1.0.0: {}\n`
      : `version = 1\n[[package]]\nname = "app"\nversion = "1.0.0"\nsource = { virtual = "." }\ndependencies = [${parents.map((p) => `{ name = "${p}" }`).join(", ")}]\n${parents.map((p) => `[[package]]\nname = "${p}"\nversion = "1.0.0"\ndependencies = [{ name = "shared" }]`).join("\n")}\n[[package]]\nname = "shared"\nversion = "1.0.0"\ndependencies = [{ name = "leaf" }]\n[[package]]\nname = "leaf"\nversion = "1.0.0"\n`;
    const graph = checked(format === "pnpm" ? parsePnpmLockText(text) : parseUvLockText(text));
    expect(graph.edges?.filter((edge) => edge.to === "shared@1.0.0")).toHaveLength(65);
    expect(graph.edges).toContainEqual({ from: "shared@1.0.0", to: "leaf@1.0.0", dependencyType: "production" });
    expect(filterGraphForProdOnly(graph, true).nodes.some((node) => node.id === "leaf@1.0.0")).toBe(true);
    expect(graph.rootDependenciesUnknown).toBeUndefined();
  });
}

test("source graph traversal fails explicitly at its edge limit", () => {
  const record = { id: "a@1" };
  const result = extendGraphWithRecordDependencies({ graph: { lockfilePath: "lock", nodes: [] },
    roots: [{ name: "a", record, dependencyType: "production" }],
    node: (item) => ({ ...item, name: "a", version: "1", ecosystem: "npm" }), children: () => [], maxEdges: 0 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("DEPENDENCY_GRAPH_LIMIT_EXCEEDED");
});

test("pnpm local links declare opaque relationships without inventing missing installations", () => {
  const graph = checked(parsePnpmLockText("lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      local: 'link:../local'\npackages: {}\n"));
  expect(graph.rootDependenciesUnknown).toBe(true);
  expect(graph.unresolvedDependencies).toBeUndefined();
});
