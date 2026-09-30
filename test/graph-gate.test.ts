import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "../src/cli/args";
import { main } from "../src/cli/main";
import { buildGraphGate } from "../src/policy/inspection-gate";
import { buildScanCompleteness } from "../src/policy/completeness";
import { createError } from "../src/shared/errors";
import { err, ok } from "../src/shared/result";
import { JsonSchemaRegistry } from "./support/json-schema-validator";
import { readFileSync } from "node:fs";

const registry = new JsonSchemaRegistry(["common", "scan-report", "diff-report"].map((name) =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), "utf8"))));

function bom(known: boolean): string {
  return JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
    metadata: { component: { type: "application", "bom-ref": "app", name: "app", version: "1" } },
    components: [{ type: "library", "bom-ref": "example", name: "example", version: "1.0.0",
      purl: "pkg:npm/example@1.0.0", licenses: [{ license: { id: "MIT" } }] }],
    ...(known ? { dependencies: [{ ref: "app", dependsOn: ["example"] }, { ref: "example", dependsOn: [] }] } : {}) });
}

async function withProject(currentKnown: boolean, run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(path.join(tmpdir(), "ohrisk-graph-gate-"));
  try {
    writeFileSync(path.join(cwd, "cyclonedx.json"), bom(currentKnown));
    await run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("graph gates require assessed complete relationships without redefining collection completeness", () => {
  const unknown = buildScanCompleteness({ graph: { lockfilePath: "bom.json", nodes: [] }, evidence: [] });
  const known = buildScanCompleteness({ graph: { lockfilePath: "bom.json", nodes: [], edges: [] }, evidence: [] });
  expect(unknown.status).toBe("complete");
  expect(buildGraphGate({ required: true, completeness: unknown })).toEqual({ required: true, failed: true });
  expect(buildGraphGate({ required: false, completeness: unknown }).failed).toBe(false);
  expect(buildGraphGate({ required: true, completeness: known }).failed).toBe(false);
  expect(buildGraphGate({ required: true, completeness: { status: "complete", unavailablePackageCount: 0, skippedRepositoryEntryCount: 0 } }).failed).toBe(true);
  const partial = buildScanCompleteness({ graph: { lockfilePath: "bom.json", nodes: [], edges: [],
    unresolvedDependencies: [{ name: "missing", dependencyType: "production", reason: "missing_installation" }] }, evidence: [] });
  expect(buildGraphGate({ required: true, completeness: partial }).failed).toBe(true);
});

for (const command of ["scan", "ci", "diff"] as const) {
  test(`${command} accepts the complete graph requirement`, () => {
    const parsed = parseArgs([command, ...(command === "diff" ? ["main"] : []), "--require-complete-graph"]);
    expect(parsed).toMatchObject({ ok: true, value: { kind: command, requireCompleteGraph: true } });
  });
}

for (const known of [false, true]) {
  test(`CI gates ${known ? "known" : "unknown"} relationships independently of partial evidence overrides`, async () => {
    await withProject(known, async (cwd) => {
      const output: string[] = [];
      const code = await main(["ci", "--lockfile", "cyclonedx.json", "--offline", "--json",
        "--require-complete-graph", "--allow-partial-evidence"], {
        cwd, stdout: (text) => output.push(text), stderr: (text) => { throw new Error(text); }
      });
      const report = JSON.parse(output.join("\n"));
      expect(code).toBe(known ? 0 : 1);
      expect(report.completeness.status).toBe("complete");
      expect(report.graphGate).toEqual({ required: true, failed: !known });
      expect(registry.validate(report.$schema, report)).toEqual([]);
    });
  });
}

for (const unknownSide of ["baseline", "current", "neither"] as const) {
  test(`diff checks both relationship assessments (${unknownSide}) without requiring a severity gate`, async () => {
    await withProject(unknownSide !== "current", async (cwd) => {
      const output: string[] = [];
      const code = await main(["diff", "main", "--lockfile", "cyclonedx.json", "--json", "--offline",
        "--require-complete-graph", "--allow-partial-evidence"], {
        cwd, stdout: (text) => output.push(text), stderr: (text) => { throw new Error(text); },
        listRefFiles: () => ok(["cyclonedx.json"]),
        readRefFile: ({ relativePath }) => relativePath === "cyclonedx.json" ? ok(bom(unknownSide !== "baseline"))
          : err(createError({ code: "GIT_REF_FILE_NOT_FOUND", category: "invalid_input", message: "Absent fixture" }))
      });
      const report = JSON.parse(output.join("\n"));
      expect(code).toBe(unknownSide === "neither" ? 0 : 1);
      expect(report.graphGate).toEqual({ required: true, failed: unknownSide !== "neither" });
      expect(report.introducedFindingCount).toBe(0);
      expect(registry.validate(report.$schema, report)).toEqual([]);
    });
  });
}

test("scan output formats retain the same independent graph gate failure", async () => {
  await withProject(false, async (cwd) => {
    for (const format of ["--json", "--sarif", "--cyclonedx", "--markdown", "--html", "text"]) {
      const output: string[] = [];
      expect(await main(["scan", "--lockfile", "cyclonedx.json", "--offline", "--require-complete-graph",
        ...(format === "text" ? [] : [format])], {
        cwd, stdout: (text) => output.push(text), stderr: (text) => { throw new Error(text); }
      })).toBe(1);
      const text = output.join("\n");
      const report = ["--json", "--sarif", "--cyclonedx"].includes(format) ? JSON.parse(text) : undefined;
      if (format === "--json") expect(report.graphGate).toEqual({ required: true, failed: true });
      else if (format === "--sarif") expect(report.runs[0].properties.ohriskGraphGate).toEqual({ required: true, failed: true });
      else if (format === "--cyclonedx") expect(JSON.parse(report.metadata.properties.find((item: { name: string }) => item.name === "ohrisk:graphGate").value))
        .toEqual({ required: true, failed: true });
      else if (format === "--html") expect(text).toContain("failed: dependency relationships are not fully known");
      else expect(text).toContain("Graph gate failed: true");
    }
  });
});
