import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main, type CliIO } from "../src/cli/main";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function createTestIO(cwd: string): { io: CliIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      cwd,
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text)
    },
    stdout,
    stderr
  };
}

describe("main", () => {
  test("prints package version", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["--version"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual(["ohrisk 0.11.0"]);
  });

  test("prints actionable findings for a Bun project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Ohrisk scan");
    expect(stdout.join("\n")).toContain("Lockfile: bun.lock (bun)");
    expect(stdout.join("\n")).toContain("Dependencies: 6 total, 5 direct, 1 transitive");
    expect(stdout.join("\n")).toContain("Evidence: 5 files, 1 warnings");
    expect(stdout.join("\n")).toContain("Licenses: 5 high-confidence, 0 medium-confidence, 1 low-confidence");
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain("Status: profile-aware risk evaluated");
    expect(stdout.join("\n")).toContain("Findings:");
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
    expect(stdout.join("\n")).toContain("recommendation: replace");
    expect(stdout.join("\n")).toContain(
      "path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(stdout.join("\n")).toContain("- [high] dev-risk@3.0.0");
    expect(stdout.join("\n")).toContain("recommendation: exclude-dev-only");
    expect(stdout.join("\n")).toContain("- [unknown] missing-license@4.0.0");
    expect(stdout.join("\n")).toContain("recommendation: collect-evidence");
    expect(stdout.join("\n")).toContain("warning: No LICENSE, LICENCE, COPYING, or NOTICE file found.");
    expect(stdout.join("\n")).toContain("file: COPYING (copying)");
    expect(stdout.join("\n")).toContain("- [review] gpl-package@5.0.0");
    expect(stdout.join("\n")).toContain("License expression should be reviewed before shipping under saas.");
  });

  test("prints actionable findings for a package-lock project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "package-lock-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: package-lock.json (package-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: fixture-package-lock-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] dev-risk@3.0.0");
  });

  test("prints actionable findings for a pnpm-lock project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "pnpm-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: pnpm-lock.yaml (pnpm-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: <root> -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] dev-risk@3.0.0");
  });


  test("tightens GPL severity for distributed apps", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--profile", "distributed-app", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Profile: distributed-app");
    expect(output).toContain("Risks: 2 high, 0 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] gpl-package@5.0.0");
    expect(output).toContain("License expression is high risk for distributed-app.");
    expect(output).toContain("recommendation: replace");
  });

  test("prints JSON report with findings when requested", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--json", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      profile: string;
      prodOnly: boolean;
      dependencyGraph: {
        total: number;
        direct: number;
        transitive: number;
      };
      evidence: {
        packages: number;
        files: number;
        warnings: number;
      };
      licenses: {
        highConfidence: number;
        mediumConfidence: number;
        lowConfidence: number;
        missing: number;
        malformed: number;
      };
      risks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
      findings: Array<{
        packageId: string;
        severity: string;
        recommendation: string;
        paths: string[][];
      }>;
    };

    expect(payload.status).toBe("profile_risk_evaluated");
    expect(payload.profile).toBe("saas");
    expect(payload.prodOnly).toBe(true);
    expect(payload.dependencyGraph).toEqual({
      total: 5,
      direct: 4,
      transitive: 1
    });
    expect(payload.evidence).toEqual({
      packages: 5,
      files: 4,
      warnings: 1
    });
    expect(payload.licenses).toEqual({
      highConfidence: 4,
      mediumConfidence: 0,
      lowConfidence: 1,
      missing: 1,
      malformed: 0
    });
    expect(payload.risks).toEqual({
      high: 1,
      review: 1,
      unknown: 1,
      low: 2
    });
    expect(payload.findings).toHaveLength(5);
    expect(payload.findings[0]).toMatchObject({
      packageId: "agpl-child@0.1.0",
      severity: "high",
      recommendation: "replace"
    });
    expect(payload.findings[0]?.paths[0]).toEqual([
      "fixture-bun-project",
      "permissive-parent@1.0.0",
      "agpl-child@0.1.0"
    ]);
    expect(payload.findings.map((finding) => finding.packageId)).not.toContain("dev-risk@3.0.0");
    expect(payload.findings.map((finding) => finding.packageId)).toContain("missing-license@4.0.0");
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        packageId: "gpl-package@5.0.0",
        severity: "review",
        recommendation: "review"
      })
    );
  });

  test("writes report output to a file instead of stdout", async () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-output-"));

    try {
      const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
      io.cwd = path.join(fixturesDir, "bun-project");

      const exitCode = await main(
        ["scan", "--json", "--prod", "--output", path.join(outputRoot, "reports", "scan.json")],
        io
      );

      expect(exitCode).toBe(0);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(
        readFileSync(path.join(outputRoot, "reports", "scan.json"), "utf8")
      ) as {
        status: string;
        prodOnly: boolean;
      };

      expect(payload.status).toBe("profile_risk_evaluated");
      expect(payload.prodOnly).toBe(true);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("prints SARIF report with stable rule ids and lockfile locations", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--sarif", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: {
          driver: {
            name: string;
            semanticVersion: string;
            rules: Array<{
              id: string;
              defaultConfiguration: {
                level: string;
              };
            }>;
          };
        };
        results: Array<{
          ruleId: string;
          ruleIndex: number;
          level: string;
          message: {
            text: string;
          };
          locations: Array<{
            physicalLocation: {
              artifactLocation: {
                uri: string;
              };
              region: {
                startLine: number;
              };
            };
          }>;
          partialFingerprints: {
            primaryLocationLineHash: string;
          };
        }>;
      }>;
    };

    expect(payload.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(payload.version).toBe("2.1.0");
    expect(payload.runs[0]?.tool.driver.name).toBe("Ohrisk");
    expect(payload.runs[0]?.tool.driver.semanticVersion).toBe("0.11.0");
    expect(payload.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "ohrisk/license-high",
      "ohrisk/license-unknown",
      "ohrisk/license-review",
      "ohrisk/license-low"
    ]);
    expect(payload.runs[0]?.results).toHaveLength(5);
    expect(payload.runs[0]?.results[0]).toMatchObject({
      ruleId: "ohrisk/license-high",
      ruleIndex: 0,
      level: "error"
    });
    expect(payload.runs[0]?.results[0]?.message.text).toContain("agpl-child@0.1.0");
    expect(payload.runs[0]?.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: {
        uri: "bun.lock"
      },
      region: {
        startLine: 1
      }
    });
    expect(payload.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash)
      .toContain("agpl-child@0.1.0");
  });

  test("prints Markdown scan output", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--markdown", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("# Ohrisk scan");
    expect(output).toContain("- Profile: `saas`");
    expect(output).toContain("- Production only: `yes`");
    expect(output).toContain("| Severity | Package | Recommendation | Path |");
    expect(output).toContain("| high | `agpl-child@0.1.0` | replace |");
    expect(output).toContain("## Next");
  });

  test("returns non-zero from ci when findings meet the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
  });

  test("writes ci output before returning a failing threshold exit code", async () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-ci-output-"));

    try {
      const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
      const outputPath = path.join(outputRoot, "ci.md");

      const exitCode = await main(
        ["ci", "--markdown", "--fail-on", "high", "--output", outputPath],
        io
      );

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
      expect(readFileSync(outputPath, "utf8")).toContain("# Ohrisk scan");
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("returns zero from ci when findings stay below the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "permissive-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 0 high, 0 review, 0 unknown, 1 low");
  });

  test("prints only newly introduced findings for a git ref diff", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk diff");
    expect(output).toContain("Baseline: main");
    expect(output).toContain("Production only: yes");
    expect(output).toContain("Findings: 5 current, 3 baseline, 2 new");
    expect(output).toContain("New risks: 0 high, 1 review, 1 unknown, 0 low");
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] agpl-child@0.1.0");
  });

  test("prints JSON diff output", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      baselineRef: string;
      baselineFindingCount: number;
      currentFindingCount: number;
      newFindingCount: number;
      newRisks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
      findings: Array<{
        packageId: string;
        severity: string;
      }>;
    };

    expect(payload.status).toBe("risk_diff_evaluated");
    expect(payload.baselineRef).toBe("main");
    expect(payload.baselineFindingCount).toBe(3);
    expect(payload.currentFindingCount).toBe(5);
    expect(payload.newFindingCount).toBe(2);
    expect(payload.newRisks).toEqual({
      high: 0,
      review: 1,
      unknown: 1,
      low: 0
    });
    expect(payload.findings.map((finding) => finding.packageId)).toEqual([
      "missing-license@4.0.0",
      "gpl-package@5.0.0"
    ]);
  });

  test("prints Markdown diff output", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--markdown"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("# Ohrisk diff");
    expect(output).toContain("- Baseline: `main`");
    expect(output).toContain("- New risks: `0 high`, `1 review`, `1 unknown`, `0 low`");
    expect(output).toContain("| unknown | `missing-license@4.0.0` | collect-evidence |");
    expect(output).toContain("| review | `gpl-package@5.0.0` | review |");
  });

  test("returns non-zero from diff when new findings meet the fail threshold", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--fail-on", "unknown"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("New risks: 0 high, 1 review, 1 unknown, 0 low");
  });

  test("explains license risk without scanning a project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "AGPL-3.0-only", "--profile", "saas"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Ohrisk explain");
    expect(stdout.join("\n")).toContain("Expression: AGPL-3.0-only");
    expect(stdout.join("\n")).toContain("Severity: high");
    expect(stdout.join("\n")).toContain("Recommendation: replace");
    expect(stdout.join("\n")).toContain("not a legal safe or unsafe verdict");
  });

  test("prints JSON explain output", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "MIT", "OR", "Apache-2.0", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      status: string;
      expression: string;
      profile: string;
      license: {
        expression: string;
        choices: string[];
      };
      finding: {
        severity: string;
        recommendation: string;
      };
    };

    expect(payload.status).toBe("license_explained");
    expect(payload.expression).toBe("MIT OR Apache-2.0");
    expect(payload.profile).toBe("saas");
    expect(payload.license.expression).toBe("MIT OR Apache-2.0");
    expect(payload.license.choices).toEqual(["MIT", "Apache-2.0"]);
    expect(payload.finding.severity).toBe("low");
    expect(payload.finding.recommendation).toBe("allow");
  });

  test("returns user-input failure for unsupported projects", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["scan"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("NO_SUPPORTED_LOCKFILE");
  });
});
