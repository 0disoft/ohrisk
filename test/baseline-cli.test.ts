import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectories: string[] = [];
const baselineCli = path.join(import.meta.dir, "..", "bin", "ohrisk-baseline.mjs");

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
    expect(JSON.parse(checked.stdout)).toMatchObject({
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
      finding("fingerprint-a", "A", "pkg:npm/a@1.0.0", "high")
    ]);
    const checked = run(workspace, [
      "check",
      "--report",
      "current-report.json",
      "--baseline",
      "baseline.json",
      "--json"
    ]);

    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      newFindingCount: 0,
      escalatedFindingCount: 1,
      failingFindings: [
        {
          fingerprint: "fingerprint-a",
          severity: "high",
          previousSeverity: "review"
        }
      ]
    });
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
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ohrisk-baseline-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeReport(
  directory: string,
  name: string,
  findings: unknown[],
  overrides: { profile?: string; prodOnly?: boolean } = {}
): void {
  writeFileSync(
    path.join(directory, name),
    `${JSON.stringify({
      $schema: "urn:ohrisk:schema:scan-report:3.5.0",
      profile: overrides.profile ?? "saas",
      prodOnly: overrides.prodOnly ?? true,
      policy: {
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
