import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  test("prints help text", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["help"], io);

    const output = stdout.join("\n");
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Ohrisk");
    expect(output).toContain("ohrisk scan");
    expect(output).toContain("ohrisk help [command]");
    expect(output).toContain("ohrisk version");
    expect(output).toContain("--lockfile <path>");
    expect(output).toContain("--help, -h");
    expect(output).toContain("--cyclonedx");
  });

  test("prints command-specific help text", async () => {
    const scan = createTestIO(fixturesDir);
    const scanExitCode = await main(["help", "scan"], scan.io);
    const scanOutput = scan.stdout.join("\n");

    expect(scanExitCode).toBe(0);
    expect(scan.stderr).toEqual([]);
    expect(scanOutput).toContain("Ohrisk scan");
    expect(scanOutput).toContain("ohrisk scan [--lockfile <path>]");
    expect(scanOutput).toContain("--lockfile <path>");
    expect(scanOutput).toContain("--cyclonedx");
    expect(scanOutput).not.toContain("--fail-on");

    const ci = createTestIO(fixturesDir);
    const ciExitCode = await main(["help", "ci"], ci.io);
    const ciOutput = ci.stdout.join("\n");

    expect(ciExitCode).toBe(0);
    expect(ci.stderr).toEqual([]);
    expect(ciOutput).toContain("Ohrisk ci");
    expect(ciOutput).toContain("--fail-on <severity>");
    expect(ciOutput).toContain("--strict-waivers");

    const diff = createTestIO(fixturesDir);
    const diffExitCode = await main(["help", "diff"], diff.io);
    const diffOutput = diff.stdout.join("\n");

    expect(diffExitCode).toBe(0);
    expect(diff.stderr).toEqual([]);
    expect(diffOutput).toContain("Ohrisk diff");
    expect(diffOutput).toContain("ohrisk diff <baseline-ref>");
    expect(diffOutput).toContain("--markdown");
    expect(diffOutput).not.toContain("--sarif");

    const explain = createTestIO(fixturesDir);
    const explainExitCode = await main(["help", "explain"], explain.io);
    const explainOutput = explain.stdout.join("\n");

    expect(explainExitCode).toBe(0);
    expect(explain.stderr).toEqual([]);
    expect(explainOutput).toContain("Ohrisk explain");
    expect(explainOutput).toContain("ohrisk explain <license-expression>");
    expect(explainOutput).toContain("--json");

    const scanFlag = createTestIO(fixturesDir);
    const scanFlagExitCode = await main(["scan", "--help"], scanFlag.io);

    expect(scanFlagExitCode).toBe(0);
    expect(scanFlag.stderr).toEqual([]);
    expect(scanFlag.stdout.join("\n")).toContain("Ohrisk scan");

    const versionFlag = createTestIO(fixturesDir);
    const versionFlagExitCode = await main(["version", "--help"], versionFlag.io);

    expect(versionFlagExitCode).toBe(0);
    expect(versionFlag.stderr).toEqual([]);
    expect(versionFlag.stdout.join("\n")).toContain("Ohrisk version");
  });

  test("prints package version", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["version"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual(["ohrisk 0.72.0"]);
  });

  test("returns invalid input for extra version arguments", async () => {
    const { io, stdout, stderr } = createTestIO(fixturesDir);
    const exitCode = await main(["version", "scan"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("INVALID_ARGUMENT");
    expect(stderr.join("\n")).toContain("version does not accept those extra arguments.");
    expect(stderr.join("\n")).toContain("extraArgs: scan");
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
    expect(stdout.join("\n")).toContain("License issues: 1 missing, 0 malformed");
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain("Status: profile-aware risk evaluated");
    expect(stdout.join("\n")).toContain("Findings:");
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
    expect(stdout.join("\n")).toContain(
      "id: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0"
    );
    expect(stdout.join("\n")).toContain(
      "fingerprint: agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas."
    );
    expect(stdout.join("\n")).toContain("recommendation: replace");
    expect(stdout.join("\n")).toContain(
      "action: Replace this package or escalate before shipping."
    );
    expect(stdout.join("\n")).toContain("dependency: production transitive");
    expect(stdout.join("\n")).toContain(
      "path: fixture-bun-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
    );
    expect(stdout.join("\n")).toContain("- [high] dev-risk@3.0.0");
    expect(stdout.join("\n")).toContain("recommendation: exclude-dev-only");
    expect(stdout.join("\n")).toContain(
      "action: Keep this package out of production or scan with --prod."
    );
    expect(stdout.join("\n")).toContain("dependency: development direct");
    expect(stdout.join("\n")).toContain("- [unknown] missing-license@4.0.0");
    expect(stdout.join("\n")).toContain(
      "Package metadata does not declare a license expression."
    );
    expect(stdout.join("\n")).toContain("recommendation: collect-evidence");
    expect(stdout.join("\n")).toContain(
      "action: Add or verify package license metadata before approving this package."
    );
    expect(stdout.join("\n")).toContain("warning: No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found.");
    expect(stdout.join("\n")).toContain("file: COPYING (copying)");
    expect(stdout.join("\n")).toContain("- [review] gpl-package@5.0.0");
    expect(stdout.join("\n")).toContain("License expression should be reviewed before shipping under saas.");
    expect(stdout.join("\n")).toContain(
      "Next: Replace or escalate high-risk dependencies before shipping."
    );
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

  test("scans an explicit lockfile when a project has multiple lockfiles", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "multiple-lockfiles"));
    const exitCode = await main(["scan", "--lockfile", "package-lock.json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: package-lock.json (package-lock)");
    expect(output).toContain("Dependencies: 0 total, 0 direct, 0 transitive");
    expect(output).toContain("Risks: 0 high, 0 review, 0 unknown, 0 low");
  });

  test("keeps optional dependencies in production-only scans", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "optional-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Production only: yes");
    expect(output).toContain("Dependencies: 1 total, 1 direct, 0 transitive");
    expect(output).toContain("Risks: 1 high, 0 review, 0 unknown, 0 low");
    expect(output).toContain("- [high] optional-risk@1.0.0");
    expect(output).toContain("dependency: optional direct");
    expect(output).not.toContain("dev-risk@3.0.0");
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

  test("prints actionable findings for a Yarn v1 lockfile project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "yarn-project"));
    const exitCode = await main(["scan", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk scan");
    expect(output).toContain("Lockfile: yarn.lock (yarn-lock)");
    expect(output).toContain("Dependencies: 5 total, 4 direct, 1 transitive");
    expect(output).toContain("Risks: 1 high, 1 review, 1 unknown, 2 low");
    expect(output).toContain("- [high] agpl-child@0.1.0");
    expect(output).toContain(
      "path: fixture-yarn-project -> permissive-parent@1.0.0 -> agpl-child@0.1.0"
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
      waiverMode: string;
      findings: Array<{
        id: string;
        fingerprint: string;
        packageId: string;
        severity: string;
        recommendation: string;
        action: string;
        dependencyType: string;
        dependencyScope: string;
        paths: string[][];
      }>;
      nextAction: string;
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
    expect(payload.waiverMode).toBe("local");
    expect(payload.nextAction).toBe("Replace or escalate high-risk dependencies before shipping.");
    expect(payload.findings).toHaveLength(5);
    expect(payload.findings[0]).toMatchObject({
      id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      packageId: "agpl-child@0.1.0",
      severity: "high",
      recommendation: "replace",
      action: "Replace this package or escalate before shipping.",
      dependencyType: "production",
      dependencyScope: "transitive"
    });
    expect(payload.findings[0]?.fingerprint).toContain(
      "::high::replace::License expression is high risk for saas."
    );
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
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        packageId: "dual-license@2.0.0",
        severity: "low",
        recommendation: "allow",
        action: "Preserve required NOTICE or attribution files when distributing this package."
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
        properties: {
          ohriskWaiverMode: string;
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
          properties: {
            packageId: string;
            findingId: string;
            fingerprint: string;
            reason: string;
            recommendation: string;
            action: string;
            dependencyType: string;
            dependencyScope: string;
          };
        }>;
      }>;
    };

    expect(payload.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(payload.version).toBe("2.1.0");
    expect(payload.runs[0]?.tool.driver.name).toBe("Ohrisk");
    expect(payload.runs[0]?.tool.driver.semanticVersion).toBe("0.72.0");
    expect(payload.runs[0]?.properties.ohriskWaiverMode).toBe("local");
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
    expect(payload.runs[0]?.results[0]?.message.text).toContain(
      "Dependency: production transitive."
    );
    expect(payload.runs[0]?.results[0]?.message.text).toContain(
      "Action: Replace this package or escalate before shipping."
    );
    expect(payload.runs[0]?.results[0]?.properties).toMatchObject({
      findingId:
        "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
      packageId: "agpl-child@0.1.0",
      reason: "License expression is high risk for saas.",
      recommendation: "replace",
      action: "Replace this package or escalate before shipping.",
      dependencyType: "production",
      dependencyScope: "transitive"
    });
    expect(payload.runs[0]?.results[0]?.properties.fingerprint).toContain(
      "::high::replace::License expression is high risk for saas."
    );
    expect(payload.runs[0]?.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: {
        uri: "bun.lock"
      },
      region: {
        startLine: 1
      }
    });
    expect(payload.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash).toContain(
      "::high::replace::License expression is high risk for saas."
    );
  });

  test("prints waived findings as suppressed SARIF results", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-sarif-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for SARIF audit output."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--sarif", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        runs: Array<{
          properties: {
            ohriskWaiverMode: string;
            ohriskActiveFindingCount: number;
            ohriskWaivedFindingCount: number;
            ohriskExpiredWaiverCount: number;
            ohriskUnmatchedWaiverCount: number;
          };
          results: Array<{
            properties: {
              packageId: string;
              waived?: boolean;
              waiverMatchedBy?: string;
              waiverReason?: string;
            };
            suppressions?: Array<{
              kind: string;
              justification: string;
            }>;
          }>;
        }>;
      };

      expect(payload.runs[0]?.properties).toEqual({
        ohriskWaiverMode: "local",
        ohriskActiveFindingCount: 4,
        ohriskWaivedFindingCount: 1,
        ohriskExpiredWaiverCount: 0,
        ohriskUnmatchedWaiverCount: 0
      });
      expect(payload.runs[0]?.results).toHaveLength(5);

      const suppressed = payload.runs[0]?.results.find(
        (result) => result.properties.packageId === "agpl-child@0.1.0"
      );

      expect(suppressed?.suppressions).toEqual([
        {
          kind: "external",
          justification: "Accepted fixture risk for SARIF audit output."
        }
      ]);
      expect(suppressed?.properties).toMatchObject({
        waived: true,
        waiverMatchedBy: "id",
        waiverReason: "Accepted fixture risk for SARIF audit output."
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints CycloneDX SBOM output", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["scan", "--cyclonedx", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      bomFormat: string;
      specVersion: string;
      version: number;
      metadata: {
        component: {
          type: string;
          name: string;
          "bom-ref": string;
        };
        properties: Array<{
          name: string;
          value: string;
        }>;
      };
      components: Array<{
        type: string;
        "bom-ref": string;
        name: string;
        version: string;
        purl: string;
        scope: string;
        licenses?: Array<
          | {
              expression: string;
            }
          | {
              license: {
                id?: string;
                name?: string;
              };
            }
        >;
        properties: Array<{
          name: string;
          value: string;
        }>;
      }>;
      dependencies: Array<{
        ref: string;
        dependsOn: string[];
      }>;
    };

    expect(payload.bomFormat).toBe("CycloneDX");
    expect(payload.specVersion).toBe("1.5");
    expect(payload.version).toBe(1);
    expect(payload.metadata.component).toEqual({
      type: "application",
      name: "fixture-bun-project",
      "bom-ref": "project"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:lockfileKind",
      value: "bun"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:waiverMode",
      value: "local"
    });
    expect(payload.components).toHaveLength(5);
    expect(payload.components.map((component) => component.name)).not.toContain("dev-risk");

    const parent = payload.components.find((component) => component.name === "permissive-parent");
    expect(parent).toMatchObject({
      type: "library",
      "bom-ref": "pkg:npm/permissive-parent@1.0.0",
      version: "1.0.0",
      purl: "pkg:npm/permissive-parent@1.0.0",
      scope: "required"
    });

    const dualLicense = payload.components.find((component) => component.name === "dual-license");
    expect(dualLicense?.licenses).toEqual([
      {
        expression: "MIT OR Apache-2.0"
      }
    ]);

    const missingLicense = payload.components.find((component) => component.name === "missing-license");
    expect(missingLicense?.licenses).toBeUndefined();
    expect(missingLicense?.properties).toContainEqual({
      name: "ohrisk:licenseSignals",
      value: "missing"
    });

    const highRisk = payload.components.find((component) => component.name === "agpl-child");
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:riskSeverity",
      value: "high"
    });
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:recommendation",
      value: "replace"
    });
    expect(highRisk?.properties).toContainEqual({
      name: "ohrisk:action",
      value: "Replace this package or escalate before shipping."
    });
    expect(highRisk?.properties.some(
      (property) => property.name === "ohrisk:fingerprint" && property.value.includes("agpl-child@0.1.0")
    )).toBe(true);

    const projectDependencies = payload.dependencies.find((dependency) => dependency.ref === "project");
    expect([...(projectDependencies?.dependsOn ?? [])].sort()).toEqual([
      "pkg:npm/dual-license@2.0.0",
      "pkg:npm/gpl-package@5.0.0",
      "pkg:npm/missing-license@4.0.0",
      "pkg:npm/permissive-parent@1.0.0"
    ]);
    expect(payload.dependencies).toContainEqual({
      ref: "pkg:npm/permissive-parent@1.0.0",
      dependsOn: ["pkg:npm/agpl-child@0.1.0"]
    });
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
    expect(output).toContain("- Waiver mode: `local (.ohrisk-waivers.json)`");
    expect(output).toContain(
      "- Licenses: `4 high-confidence`, `0 medium-confidence`, `1 low-confidence`"
    );
    expect(output).toContain("- License issues: `1 missing`, `0 malformed`");
    expect(output).toContain(
      "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |"
    );
    expect(output).toContain(
      "| `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0` | `agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0::high::replace::License expression is high risk for saas."
    );
    expect(output).toContain("## Next");
    expect(output).toContain("Replace or escalate high-risk dependencies before shipping.");
  });

  test("returns non-zero from ci when findings meet the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 2 high, 1 review, 1 unknown, 2 low");
    expect(stdout.join("\n")).toContain(
      "Threshold: failed on high (2 findings at or above threshold)"
    );
    expect(stdout.join("\n")).toContain("- [high] agpl-child@0.1.0");
  });

  test("prints JSON ci threshold outcome", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    const exitCode = await main(["ci", "--json", "--fail-on", "high"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      failOn: string;
      failed: boolean;
      failingFindingCount: number;
    };

    expect(payload.failOn).toBe("high");
    expect(payload.failed).toBe(true);
    expect(payload.failingFindingCount).toBe(2);
  });

  test("excludes waived findings from CI threshold failures while reporting them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-waived-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for this release candidate."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
          review: number;
          unknown: number;
          low: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        failed: boolean;
        failingFindingCount: number;
        findings: Array<{
          packageId: string;
        }>;
        waivedFindings: Array<{
          finding: {
            packageId: string;
            severity: string;
          };
          waiver: {
            reason: string;
          };
          matchedBy: string;
        }>;
      };

      expect(payload.risks.high).toBe(0);
      expect(payload.waivers).toEqual({
        applied: 1,
        expired: 0,
        unmatched: 0
      });
      expect(payload.failed).toBe(false);
      expect(payload.failingFindingCount).toBe(0);
      expect(payload.findings.map((finding) => finding.packageId)).not.toContain("agpl-child@0.1.0");
      expect(payload.waivedFindings).toHaveLength(1);
      expect(payload.waivedFindings[0]).toMatchObject({
        finding: {
          packageId: "agpl-child@0.1.0",
          severity: "high"
        },
        waiver: {
          reason: "Accepted fixture risk for this release candidate."
        },
        matchedBy: "id"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns invalid input for malformed waiver files", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bad-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(path.join(projectRoot, ".ohrisk-waivers.json"), "{", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan"], io);

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("\n")).toContain("WAIVER_FILE_PARSE_FAILED");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores local waivers when waiver application is disabled", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-no-waivers-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for this release candidate."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high", "--no-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        failed: boolean;
        failingFindingCount: number;
        findings: Array<{
          packageId: string;
          severity: string;
        }>;
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: unknown[];
      };

      expect(payload.risks.high).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 0
      });
      expect(payload.waiverMode).toBe("ignored");
      expect(payload.failed).toBe(true);
      expect(payload.failingFindingCount).toBe(1);
      expect(payload.findings).toContainEqual(
        expect.objectContaining({
          packageId: "agpl-child@0.1.0",
          severity: "high"
        })
      );
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not read malformed waiver files when waiver application is disabled", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-no-waiver-read-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(path.join(projectRoot, ".ohrisk-waivers.json"), "{", "utf8");

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--json", "--prod", "--no-waivers"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waiverMode: string;
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: unknown[];
      };

      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 0
      });
      expect(payload.waiverMode).toBe("ignored");
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports expired waivers without applying them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-expired-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Temporary acceptance expired.",
                expiresOn: "2000-01-01"
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--fail-on", "high"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        risks: {
          high: number;
        };
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        failed: boolean;
        failingFindingCount: number;
        waivedFindings: unknown[];
        expiredWaivers: Array<{
          id: string;
          reason: string;
          expiresOn: string;
        }>;
      };

      expect(payload.risks.high).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 1,
        unmatched: 0
      });
      expect(payload.failed).toBe(true);
      expect(payload.failingFindingCount).toBe(1);
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([
        {
          id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
          reason: "Temporary acceptance expired.",
          expiresOn: "2000-01-01"
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports unmatched active waivers without applying them", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-unmatched-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["scan", "--json", "--prod"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
        waivedFindings: unknown[];
        expiredWaivers: unknown[];
        unmatchedWaivers: Array<{
          id: string;
          reason: string;
        }>;
      };

      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 1
      });
      expect(payload.waivedFindings).toEqual([]);
      expect(payload.expiredWaivers).toEqual([]);
      expect(payload.unmatchedWaivers).toEqual([
        {
          id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
          reason: "Leftover waiver from a removed dependency."
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("fails CI strict waiver checks when an active waiver no longer matches a finding", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-strict-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--json", "--prod", "--strict-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        failed: boolean;
        failingFindingCount: number;
        strictWaivers: boolean;
        waiverDriftFailed: boolean;
        waiverDriftCount: number;
        waivers: {
          applied: number;
          expired: number;
          unmatched: number;
        };
      };

      expect(payload.failed).toBe(false);
      expect(payload.failingFindingCount).toBe(0);
      expect(payload.strictWaivers).toBe(true);
      expect(payload.waiverDriftFailed).toBe(true);
      expect(payload.waiverDriftCount).toBe(1);
      expect(payload.waivers).toEqual({
        applied: 0,
        expired: 0,
        unmatched: 1
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints passed strict waiver status when CI has no waiver drift", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "permissive-project"));
    const exitCode = await main(["ci", "--prod", "--strict-waivers"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Waiver drift: passed (0 expired or unmatched waivers)");
  });

  test("prints SARIF strict waiver drift properties", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-sarif-strict-waiver-project-"));

    try {
      cpSync(path.join(fixturesDir, "permissive-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "missing-package@9.9.9::production::direct::fixture-permissive-project>missing-package@9.9.9",
                reason: "Leftover waiver from a removed dependency."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      const exitCode = await main(["ci", "--sarif", "--prod", "--strict-waivers"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        runs: Array<{
          properties: {
            ohriskStrictWaivers: boolean;
            ohriskWaiverDriftFailed: boolean;
            ohriskWaiverDriftCount: number;
          };
        }>;
      };

      expect(payload.runs[0]?.properties).toMatchObject({
        ohriskStrictWaivers: true,
        ohriskWaiverDriftFailed: true,
        ohriskWaiverDriftCount: 1
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
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
      expect(readFileSync(outputPath, "utf8")).toContain(
        "- Threshold: failed on high (2 findings at or above threshold)"
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  test("returns zero from ci when findings stay below the fail threshold", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "permissive-project"));
    const exitCode = await main(["ci", "--fail-on", "high"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Risks: 0 high, 0 review, 0 unknown, 2 low");
    expect(stdout.join("\n")).toContain("- [low] alias-package@2.0.0");
    expect(stdout.join("\n")).toContain("evidence: license: Apache License, Version 2.0");
    expect(stdout.join("\n")).toContain(
      "Threshold: passed on high (0 findings at or above threshold)"
    );
    expect(stdout.join("\n")).toContain("Next: No action needed for this profile.");
  });

  test("prints only new or changed findings for a git ref diff", async () => {
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
    expect(output).toContain("Findings: 5 current, 3 baseline, 2 new or changed");
    expect(output).toContain("New or changed risks: 0 high, 1 review, 1 unknown, 0 low");
    expect(output).toContain("- [unknown] missing-license@4.0.0");
    expect(output).toContain("fingerprint: missing-license@4.0.0");
    expect(output).toContain("dependency: production direct");
    expect(output).toContain("- [review] gpl-package@5.0.0");
    expect(output).not.toContain("- [high] agpl-child@0.1.0");
  });

  test("diff reads the baseline for an explicit lockfile path", async () => {
    const baselineLockfile = readFileSync(
      path.join(fixturesDir, "multiple-lockfiles", "package-lock.json"),
      "utf8"
    );
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "multiple-lockfiles"));
    io.readRefFile = ({ relativePath }) => {
      expect(relativePath).toBe("package-lock.json");
      return { ok: true as const, value: baselineLockfile };
    };

    const exitCode = await main(["diff", "main", "--lockfile", "package-lock.json", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      currentFindingCount: number;
      baselineFindingCount: number;
      newFindingCount: number;
    };
    expect(payload.currentFindingCount).toBe(0);
    expect(payload.baselineFindingCount).toBe(0);
    expect(payload.newFindingCount).toBe(0);
  });

  test("does not apply local waivers to git ref diff findings", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-diff-waiver-project-"));
    const baselineLockfile = [
      "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
      "# bun lockfile v1",
      "",
      "{",
      '  "lockfileVersion": 1,',
      '  "workspaces": {',
      '    "": {',
      '      "name": "fixture-bun-project",',
      '      "dependencies": {',
      '        "dual-license": "2.0.0",',
      "      },",
      "    },",
      "  },",
      '  "packages": {',
      '    "dual-license": [',
      '      "dual-license@2.0.0",',
      '      "file:./.registry/dual-license",',
      "      {},",
      '      "sha512-dual",',
      "    ],",
      "  },",
      "}"
    ].join("\n");

    try {
      cpSync(path.join(fixturesDir, "bun-project"), projectRoot, { recursive: true });
      writeFileSync(
        path.join(projectRoot, ".ohrisk-waivers.json"),
        JSON.stringify(
          {
            waivers: [
              {
                id: "agpl-child@0.1.0::production::transitive::fixture-bun-project>permissive-parent@1.0.0>agpl-child@0.1.0",
                reason: "Accepted fixture risk for scan output only."
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );

      const { io, stdout, stderr } = createTestIO(projectRoot);
      io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

      const exitCode = await main(["diff", "main", "--prod", "--json", "--fail-on", "high"], io);

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);

      const payload = JSON.parse(stdout.join("\n")) as {
        newRisks: {
          high: number;
        };
        findings: Array<{
          packageId: string;
        }>;
      };

      expect(payload.newRisks.high).toBe(1);
      expect(payload.findings.map((finding) => finding.packageId)).toContain("agpl-child@0.1.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("prints only new or changed findings for a Yarn v1 git ref diff", async () => {
    const baselineLockfile = [
      "# yarn lockfile v1",
      "",
      "agpl-child@0.1.0:",
      "  version \"0.1.0\"",
      "  resolved \"file:../bun-project/.registry/agpl-child\"",
      "",
      "\"dual-license@file:../bun-project/.registry/dual-license\":",
      "  version \"2.0.0\"",
      "  resolved \"file:../bun-project/.registry/dual-license\"",
      "",
      "\"permissive-parent@file:../bun-project/.registry/permissive-parent\":",
      "  version \"1.0.0\"",
      "  resolved \"file:../bun-project/.registry/permissive-parent\"",
      "  dependencies:",
      "    agpl-child \"0.1.0\"",
      ""
    ].join("\n");
    const baselinePackageJson = JSON.stringify({
      name: "fixture-yarn-project",
      version: "0.0.0",
      dependencies: {
        "permissive-parent": "file:../bun-project/.registry/permissive-parent",
        "dual-license": "file:../bun-project/.registry/dual-license"
      }
    });
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "yarn-project"));
    io.readRefFile = ({ relativePath }) => {
      if (relativePath === "yarn.lock") {
        return { ok: true as const, value: baselineLockfile };
      }

      if (relativePath === "package.json") {
        return { ok: true as const, value: baselinePackageJson };
      }

      throw new Error(`Unexpected baseline path: ${relativePath}`);
    };

    const exitCode = await main(["diff", "main", "--prod"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Ohrisk diff");
    expect(output).toContain("Baseline: main");
    expect(output).toContain("Findings: 5 current, 3 baseline, 2 new or changed");
    expect(output).toContain("New or changed risks: 0 high, 1 review, 1 unknown, 0 low");
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
      nextAction: string;
      findings: Array<{
        id: string;
        fingerprint: string;
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
    expect(payload.nextAction).toBe(
      "Collect evidence for new or changed unknown license findings before merging."
    );
    expect(payload.findings.map((finding) => finding.packageId)).toEqual([
      "missing-license@4.0.0",
      "gpl-package@5.0.0"
    ]);
    expect(payload.findings[0]?.id).toBe(
      "missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0"
    );
    expect(payload.findings[0]?.fingerprint).toContain(
      "::unknown::collect-evidence::Package metadata does not declare a license expression."
    );
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
    expect(output).toContain("- New or changed risks: `0 high`, `1 review`, `1 unknown`, `0 low`");
    expect(output).toContain(
      "| ID | Fingerprint | Severity | Package | Dependency | Reason | Recommendation | Action | Path |"
    );
    expect(output).toContain(
      "| `missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0` | `missing-license@4.0.0::production::direct::fixture-bun-project>missing-license@4.0.0::unknown::collect-evidence::Package metadata does not declare a license expression."
    );
    expect(output).toContain(
      "| `gpl-package@5.0.0::production::direct::fixture-bun-project>gpl-package@5.0.0` | `gpl-package@5.0.0::production::direct::fixture-bun-project>gpl-package@5.0.0::review::review::License expression should be reviewed before shipping under saas."
    );
    expect(output).toContain("Collect evidence for new or changed unknown license findings before merging.");
  });

  test("prints diff threshold outcome", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--fail-on", "unknown"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain(
      "Threshold: failed on unknown (1 finding at or above threshold)"
    );
  });

  test("returns non-zero from diff when new findings meet the fail threshold", async () => {
    const baselineLockfile = readFileSync(path.join(fixturesDir, "baseline-bun.lock"), "utf8");
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "bun-project"));
    io.readRefFile = () => ({ ok: true as const, value: baselineLockfile });

    const exitCode = await main(["diff", "main", "--prod", "--json", "--fail-on", "unknown"], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      failOn: string;
      failed: boolean;
      failingFindingCount: number;
      newRisks: {
        high: number;
        review: number;
        unknown: number;
        low: number;
      };
    };

    expect(payload.newRisks).toEqual({
      high: 0,
      review: 1,
      unknown: 1,
      low: 0
    });
    expect(payload.failOn).toBe("unknown");
    expect(payload.failed).toBe(true);
    expect(payload.failingFindingCount).toBe(1);
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
    expect(stdout.join("\n")).toContain(
      "Action: Replace this package or escalate before shipping."
    );
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
        action: string;
      };
    };

    expect(payload.status).toBe("license_explained");
    expect(payload.expression).toBe("MIT OR Apache-2.0");
    expect(payload.profile).toBe("saas");
    expect(payload.license.expression).toBe("MIT OR Apache-2.0");
    expect(payload.license.choices).toEqual(["MIT", "Apache-2.0"]);
    expect(payload.finding.severity).toBe("low");
    expect(payload.finding.recommendation).toBe("allow");
    expect(payload.finding.action).toBe("No action needed for this profile.");
  });

  test("explains source-available aliases without scanning a project", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "BUSL", "--profile", "saas"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const output = stdout.join("\n");
    expect(output).toContain("Expression: BUSL");
    expect(output).toContain("Severity: high");
    expect(output).toContain("Recommendation: replace");
    expect(output).toContain("Normalized: BUSL-1.1");
    expect(output).toContain("commercial-restriction");
  });

  test("explains restricted OR expressions without overriding the low-risk branch", async () => {
    const { io, stdout, stderr } = createTestIO(path.join(fixturesDir, "no-lockfile"));
    const exitCode = await main(["explain", "MIT", "OR", "BUSL-1.1", "--json"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);

    const payload = JSON.parse(stdout.join("\n")) as {
      expression: string;
      license: {
        expression: string;
        choices: string[];
        signals: string[];
      };
      finding: {
        severity: string;
        recommendation: string;
      };
    };

    expect(payload.expression).toBe("MIT OR BUSL-1.1");
    expect(payload.license.expression).toBe("MIT OR BUSL-1.1");
    expect(payload.license.choices).toEqual(["MIT", "BUSL-1.1"]);
    expect(payload.license.signals).toContain("commercial-restriction");
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
