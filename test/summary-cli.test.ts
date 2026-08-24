import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JsonSchemaRegistry,
  type JsonSchema
} from "./support/json-schema-validator";

const temporaryDirectories: string[] = [];
const summaryCli = path.join(import.meta.dir, "..", "bin", "ohrisk-summary.mjs");
const summarySchemaId = "urn:ohrisk:schema:report-summary:1.0.0";
const schemaRegistry = new JsonSchemaRegistry([readSchema("report-summary.schema.json")]);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ohrisk-summary", () => {
  test("renders a bounded and escaped step summary with structured outputs", () => {
    const workspace = temporaryDirectory();
    const reportPath = path.join(workspace, "report.json");
    const stepSummaryPath = path.join(workspace, "step-summary.md");
    const outputPath = path.join(workspace, "github-output.txt");
    writeFileSync(stepSummaryPath, "", "utf8");
    writeFileSync(outputPath, "", "utf8");
    writeFileSync(
      reportPath,
      `${JSON.stringify({
        $schema: "urn:ohrisk:schema:scan-report:3.5.0",
        schemaVersion: "3.5.0",
        status: "profile_risk_evaluated",
        findings: [
          finding("HIGH|ID", "pkg:npm/<unsafe>@1.0.0", "high", "<script>\nblocked"),
          finding("REVIEW", "pkg:npm/review@1.0.0", "review", "review this")
        ],
        failOn: "high",
        failed: true,
        failingFindingCount: 1,
        waiverDriftFailed: false,
        completeness: { status: "partial" },
        waivers: { applied: 2 }
      }, null, 2)}\n`,
      "utf8"
    );

    const result = run(workspace, [
      "--workspace",
      workspace,
      "--report",
      "report.json",
      "--max-findings",
      "1",
      "--step-summary",
      "--github-output",
      outputPath
    ], {
      GITHUB_STEP_SUMMARY: stepSummaryPath
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const markdown = readFileSync(stepSummaryPath, "utf8");
    expect(markdown).toContain("Ohrisk license-risk summary");
    expect(markdown).toContain("pkg:npm/&lt;unsafe&gt;@1.0.0");
    expect(markdown).toContain("HIGH\\|ID");
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("1 additional finding was omitted");

    const outputs = readFileSync(outputPath, "utf8");
    expect(outputs).toContain("report-type=scan\n");
    expect(outputs).toContain("failed=true\n");
    expect(outputs).toContain("completeness=partial\n");
    expect(outputs).toContain("finding-count=2\n");
    expect(outputs).toContain("high-count=1\n");
    expect(outputs).toContain("review-count=1\n");
    expect(outputs).toContain("waived-count=2\n");
  });

  test("summarizes a diff report without inventing completeness", () => {
    const workspace = temporaryDirectory();
    writeFileSync(
      path.join(workspace, "diff.json"),
      `${JSON.stringify({
        $schema: "urn:ohrisk:schema:diff-report:3.5.0",
        schemaVersion: "3.5.0",
        status: "risk_diff_evaluated",
        findings: [
          finding("UNKNOWN", "pkg:cargo/example@2.0.0", "unknown", "evidence missing")
        ],
        failOn: "unknown",
        failed: true
      }, null, 2)}\n`,
      "utf8"
    );

    const result = run(workspace, [
      "--report",
      "diff.json",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout) as unknown;
    expect(schemaRegistry.validate(summarySchemaId, summary)).toEqual([]);
    expect(summary).toMatchObject({
      reportType: "diff",
      failed: true,
      completeness: "not-reported",
      findingCount: 1,
      failingFindingCount: 1,
      counts: {
        high: 0,
        unknown: 1,
        review: 0,
        low: 0
      }
    });
  });

  test("rejects report traversal outside an explicit workspace", () => {
    const parent = temporaryDirectory();
    const workspace = path.join(parent, "workspace");
    const outsideReport = path.join(parent, "outside.json");
    mkdirSync(workspace);
    writeFileSync(outsideReport, JSON.stringify({
      status: "profile_risk_evaluated",
      findings: []
    }), "utf8");

    const result = run(workspace, [
      "--workspace",
      workspace,
      "--report",
      "../outside.json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must resolve inside --workspace");
  });

  test("rejects a status-shaped JSON document without the report schema", () => {
    const workspace = temporaryDirectory();
    writeFileSync(path.join(workspace, "forged.json"), JSON.stringify({
      status: "profile_risk_evaluated",
      findings: [],
      completeness: { status: "complete" },
      waivers: { applied: 0 }
    }), "utf8");

    const result = run(workspace, ["--report", "forged.json"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not use the supported Ohrisk 3.5.0 report schema");
  });

  test("reports omitted findings accurately when max-findings is zero", () => {
    const workspace = temporaryDirectory();
    writeFileSync(path.join(workspace, "report.json"), JSON.stringify({
      $schema: "urn:ohrisk:schema:scan-report:3.5.0",
      schemaVersion: "3.5.0",
      status: "profile_risk_evaluated",
      findings: [finding("HIGH", "pkg:npm/example@1.0.0", "high", "review")],
      completeness: { status: "complete" },
      waivers: { applied: 0 }
    }), "utf8");

    const result = run(workspace, [
      "--report",
      "report.json",
      "--max-findings",
      "0"
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 active finding was omitted because max-findings is 0");
    expect(result.stdout).not.toContain("No active findings are present");
  });

  test("keeps the nested summary action permissionless and report-driven", () => {
    const action = readFileSync(
      path.join(import.meta.dir, "..", "summary-action", "action.yml"),
      "utf8"
    );

    expect(action).toContain("--step-summary");
    expect(action).toContain("--github-output \"$GITHUB_OUTPUT\"");
    expect(action).toContain("finding-count:");
    expect(action).toContain("waiver-drift-failed:");
    expect(action).not.toContain("pull-requests: write");
    expect(action).not.toContain("github-token");
  });
});

function readSchema(filename: string): JsonSchema {
  return JSON.parse(
    readFileSync(path.join(import.meta.dir, "..", "schemas", filename), "utf8")
  ) as JsonSchema;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ohrisk-summary-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function finding(
  id: string,
  packageId: string,
  severity: "low" | "review" | "unknown" | "high",
  reason: string
): Record<string, string> {
  return { id, packageId, severity, reason, action: "Review the dependency." };
}

function run(
  cwd: string,
  args: string[],
  environment: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [summaryCli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment
    }
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
