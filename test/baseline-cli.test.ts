import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JsonSchemaRegistry,
  type JsonSchema
} from "./support/json-schema-validator";

const temporaryDirectories: string[] = [];
const baselineCli = path.join(import.meta.dir, "..", "bin", "ohrisk-baseline.mjs");
const baselineSchemaId = "urn:ohrisk:schema:baseline:1.0.0";
const baselineCheckSchemaId = "urn:ohrisk:schema:baseline-check:1.0.0";
const schemaRegistry = new JsonSchemaRegistry([
  readSchema("baseline.schema.json"),
  readSchema("baseline-check.schema.json")
]);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ohrisk-baseline", () => {
  test("creates a deterministic baseline and accepts an unchanged report", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "report.json", [
      finding("fingerprint-b", "B", "pkg:npm/b@1.0.0", "review"),
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "high")
    ]);

    const created = run(workspace, [
      "create",
      "--report",
      "report.json",
      "--output",
      "baseline.json",
      "--json"
    ]);

    expect(created.status).toBe(0);
    expect(created.stderr).toBe("");
    expect(JSON.parse(created.stdout)).toMatchObject({
      status: "baseline_created",
      findingCount: 2
    });

    const baselineSource = readFileSync(path.join(workspace, "baseline.json"), "utf8");
    const baseline = JSON.parse(baselineSource) as {
      findings: Array<{ fingerprint: string }>;
    };
    expectValid(baselineSchemaId, baseline);
    expect(baseline.findings.map((entry) => entry.fingerprint)).toEqual([
      "fingerprint-a",
      "fingerprint-b"
    ]);
    expect(baselineSource).not.toContain("createdAt");

    const repeated = run(workspace, [
      "create",
      "--report",
      "report.json",
      "--output",
      "baseline.json"
    ]);
    expect(repeated.status).toBe(0);
    expect(readFileSync(path.join(workspace, "baseline.json"), "utf8")).toBe(baselineSource);

    const checked = run(workspace, [
      "check",
      "--report",
      "report.json",
      "--baseline",
      "baseline.json",
      "--json"
    ]);
    expect(checked.status).toBe(0);
    const checkReport = JSON.parse(checked.stdout) as unknown;
    expectValid(baselineCheckSchemaId, checkReport);
    expect(checkReport).toMatchObject({
      status: "baseline_checked",
      failed: false,
      introducedFindingCount: 0,
      failingFindingCount: 0
    });
  });

  test("fails for a new finding at the configured threshold", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "baseline-report.json", [
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "review")
    ]);
    expect(run(workspace, [
      "create",
      "--report",
      "baseline-report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    writeReport(workspace, "current-report.json", [
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "review"),
      finding("fingerprint-b", "B", "pkg:npm/b@1.0.0", "high")
    ]);

    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json",
      "--fail-on",
      "high",
      "--json"
    ]);

    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      failed: true,
      newFindingCount: 1,
      escalatedFindingCount: 0,
      failingFindingCount: 1,
      failingFindings: [
        {
          fingerprint: "fingerprint-b",
          packageId: "pkg:npm/b@1.0.0",
          severity: "high"
        }
      ]
    });
  });

  test("treats a severity increase as introduced risk", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "baseline-report.json", [
      finding("fingerprint-review", "A", "pkg:npm/a@1.0.0", "review")
    ]);
    expect(run(workspace, [
      "create",
      "--report",
      "baseline-report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    writeReport(workspace, "current-report.json", [
      finding("fingerprint-high", "A", "pkg:npm/a@1.0.0", "high")
    ]);
    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json",
      "--fail-on",
      "review",
      "--json"
    ]);

    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      newFindingCount: 0,
      escalatedFindingCount: 1,
      failingFindings: [
        {
          fingerprint: "fingerprint-high",
          severity: "high",
          previousSeverity: "review"
        }
      ]
    });
  });

  test("treats changed semantics for the same finding id as introduced risk", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "baseline-report.json", [
      finding("fingerprint-before", "A", "pkg:npm/a@1.0.0", "review")
    ]);
    expect(run(workspace, [
      "create",
      "--report",
      "baseline-report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    writeReport(workspace, "current-report.json", [
      finding("fingerprint-after", "A", "pkg:npm/a@1.0.0", "review")
    ]);
    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json",
      "--fail-on",
      "review",
      "--json"
    ]);

    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      newFindingCount: 0,
      changedFindingCount: 1,
      escalatedFindingCount: 0,
      failingFindings: [
        {
          id: "A",
          fingerprint: "fingerprint-after",
          previousFingerprint: "fingerprint-before",
          previousSeverity: "review"
        }
      ]
    });
  });

  test("uses stable code-unit ordering for baseline findings", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "report.json", [
      finding("ä", "id-umlaut", "pkg:npm/umlaut@1.0.0", "low"),
      finding("a", "id-lower", "pkg:npm/lower@1.0.0", "low"),
      finding("Z", "id-upper", "pkg:npm/upper@1.0.0", "low")
    ]);

    expect(run(workspace, [
      "create",
      "--report",
      "report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    const baseline = JSON.parse(
      readFileSync(path.join(workspace, "baseline.json"), "utf8")
    ) as { findings: Array<{ fingerprint: string }> };
    expect(baseline.findings.map((finding) => finding.fingerprint)).toEqual([
      "Z",
      "a",
      "ä"
    ]);
  });

  test("rejects configuration drift instead of silently accepting a new scope", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "baseline-report.json", [], { profile: "saas" });
    expect(run(workspace, [
      "create",
      "--report",
      "baseline-report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    writeReport(workspace, "current-report.json", [], { profile: "distributed-app" });
    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json"
    ]);

    expect(checked.status).toBe(2);
    expect(checked.stderr).toContain("baseline configuration does not match");
  });

  test("rejects equal-sized policy content drift", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "baseline-report.json", [], {
      policyDigest: "a".repeat(64)
    });
    expect(run(workspace, [
      "create",
      "--report",
      "baseline-report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    writeReport(workspace, "current-report.json", [], {
      policyDigest: "b".repeat(64)
    });
    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json"
    ]);

    expect(checked.status).toBe(2);
    expect(checked.stderr).toContain("baseline configuration does not match");
  });

  test("rejects duplicate finding ids in a report", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "report.json", [
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "review"),
      finding("fingerprint-b", "A", "pkg:npm/a@1.0.0", "high")
    ]);

    const created = run(workspace, [
      "create",
      "--report",
      "report.json",
      "--output",
      "baseline.json"
    ]);

    expect(created.status).toBe(2);
    expect(created.stderr).toContain("duplicate finding id");
  });

  test("rejects duplicate finding ids in a checked-in baseline", () => {
    const workspace = temporaryDirectory();
    writeReport(workspace, "report.json", [
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "review")
    ]);
    expect(run(workspace, [
      "create",
      "--report",
      "report.json",
      "--output",
      "baseline.json"
    ]).status).toBe(0);

    const baselinePath = path.join(workspace, "baseline.json");
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      findings: unknown[];
    };
    baseline.findings.push(baseline.findings[0]);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

    const checked = run(workspace, [
      "check",
      "--report",
      "report.json",
      "--baseline",
      "baseline.json"
    ]);

    expect(checked.status).toBe(2);
    expect(checked.stderr).toContain("baseline contains duplicate finding id");
  });

  test("publishes closed schemas for baseline artifacts", () => {
    schemaRegistry.assertSupportedKeywords();

    expect(schemaRegistry.validate(baselineSchemaId, {
      $schema: baselineSchemaId,
      schemaVersion: "1.0.0",
      sourceReportSchema: "urn:ohrisk:schema:scan-report:3.5.0",
      profile: "saas",
      prodOnly: true,
      configurationDigest: "a".repeat(64),
      findings: [],
      unexpected: true
    })).not.toEqual([]);

    expect(schemaRegistry.validate(baselineCheckSchemaId, {
      $schema: baselineCheckSchemaId,
      schemaVersion: "1.0.0",
      status: "baseline_checked",
      failed: false,
      failOn: "critical",
      baselineFindingCount: 0,
      currentFindingCount: 0,
      newFindingCount: 0,
      changedFindingCount: 0,
      escalatedFindingCount: 0,
      introducedFindingCount: 0,
      failingFindingCount: 0,
      introducedFindings: [],
      failingFindings: []
    })).not.toEqual([]);
  });
});

function readSchema(filename: string): JsonSchema {
  return JSON.parse(
    readFileSync(path.join(import.meta.dir, "..", "schemas", filename), "utf8")
  ) as JsonSchema;
}

function expectValid(schemaId: string, value: unknown): void {
  expect(schemaRegistry.validate(schemaId, value)).toEqual([]);
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ohrisk-baseline-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeReport(
  directory: string,
  name: string,
  findings: unknown[],
  overrides: { profile?: string; prodOnly?: boolean; policyDigest?: string } = {}
): void {
  writeFileSync(
    path.join(directory, name),
    `${JSON.stringify({
      $schema: "urn:ohrisk:schema:scan-report:3.5.0",
      profile: overrides.profile ?? "saas",
      prodOnly: overrides.prodOnly ?? true,
      policy: {
        digest: overrides.policyDigest ?? "0".repeat(64),
        enabled: false,
        sourceFiles: [],
        allowLicenseCount: 0,
        denyLicenseCount: 0,
        severityOverrideCount: 0,
        packageRuleCount: 0,
        profileCount: 0,
        profileOverrideCount: 0,
        allowedRegistryHostCount: 0,
        registryAuthHostCount: 0
      },
      findings
    }, null, 2)}\n`,
    "utf8"
  );
}

function finding(
  fingerprint: string,
  id: string,
  packageId: string,
  severity: "low" | "review" | "unknown" | "high"
): Record<string, string> {
  return { fingerprint, id, packageId, severity };
}

function run(
  cwd: string,
  args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [baselineCli, ...args], {
    cwd,
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
