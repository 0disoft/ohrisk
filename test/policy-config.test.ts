import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  evaluationPolicyForProfile,
  matchPolicyPackageRule,
  readPolicyConfig,
  summarizePolicyConfig
} from "../src/policy/config";

function withWorkspace(run: (workspace: string) => void): void {
  const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-policy-config-"));
  try {
    run(workspace);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

describe("organization policy configuration", () => {
  test("loads inherited policy, profile overrides, package rules, and network settings", () => {
    withWorkspace((workspace) => {
      const project = path.join(workspace, "apps", "api");
      mkdirSync(project, { recursive: true });
      writeFileSync(path.join(workspace, "base.yml"), [
        "version: 1",
        "licenses:",
        "  allow: [MIT]",
        "  severity:",
        "    GPL-3.0-only: high",
        "packages:",
        "  'pkg:npm/@scope/*':",
        "    severity: review",
        "    action: Confirm the distribution path.",
        "network:",
        "  allowedHosts: [packages.example.com]",
        "  auth:",
        "    packages.example.com:",
        "      tokenEnv: OHRISK_PACKAGES_TOKEN"
      ].join("\n") + "\n");
      writeFileSync(path.join(project, ".ohrisk.yml"), [
        "version: 1",
        "extends: ../../base.yml",
        "licenses:",
        "  deny: [AGPL-3.0-only]",
        "packages:",
        "  'pkg:npm/@scope/critical@*':",
        "    severity: high",
        "    recommendation: replace",
        "profiles:",
        "  distributed-app:",
        "    licenses:",
        "      severity:",
        "        LGPL-3.0-only: review",
        "network:",
        "  npmRegistryUrl: https://packages.example.com/npm"
      ].join("\n") + "\n");

      const result = readPolicyConfig({ projectRoot: project, workspaceRoot: workspace });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);

      expect([...result.value.allowLicenses]).toEqual(["MIT"]);
      expect([...result.value.denyLicenses]).toEqual(["AGPL-3.0-only"]);
      expect(result.value.severityOverrides.get("GPL-3.0-only")).toBe("high");
      expect(result.value.allowedRegistryHosts).toEqual(
        new Set(["packages.example.com"])
      );
      expect(result.value.registryAuth.get("packages.example.com"))
        .toEqual({ tokenEnv: "OHRISK_PACKAGES_TOKEN" });
      expect(result.value.npmRegistryUrl).toBe("https://packages.example.com/npm");
      expect(result.value.sourceFiles).toEqual([
        "base.yml",
        "apps/api/.ohrisk.yml"
      ]);

      const distributed = evaluationPolicyForProfile(result.value, "distributed-app");
      expect(distributed.severityOverrides.get("LGPL-3.0-only")).toBe("review");
      expect(distributed.severityOverrides.get("GPL-3.0-only")).toBe("high");

      expect(matchPolicyPackageRule(
        ["@scope/critical@1.0.0", "pkg:npm/@scope/critical@1.0.0"],
        result.value.packageRules
      )).toEqual({ severity: "high", recommendation: "replace" });
      expect(matchPolicyPackageRule(
        "pkg:npm/@scope/other@2.0.0",
        result.value.packageRules
      )).toEqual({ severity: "review", action: "Confirm the distribution path." });

      const summary = summarizePolicyConfig(result.value);
      expect(summary).toMatchObject({
        enabled: true,
        allowLicenseCount: 1,
        denyLicenseCount: 1,
        packageRuleCount: 2,
        profileCount: 1,
        allowedRegistryHostCount: 1,
        registryAuthHostCount: 1,
        npmRegistryUrl: "https://packages.example.com/npm"
      });
      expect(JSON.stringify(summary)).not.toContain("OHRISK_PACKAGES_TOKEN");
    });
  });

  test("rejects inheritance outside the workspace and inheritance cycles", () => {
    withWorkspace((workspace) => {
      const project = path.join(workspace, "project");
      mkdirSync(project, { recursive: true });
      const outside = path.join(path.dirname(workspace), `${path.basename(workspace)}-outside.yml`);
      writeFileSync(outside, "version: 1\n");
      writeFileSync(
        path.join(project, ".ohrisk.yml"),
        `version: 1\nextends: ../../${path.basename(outside)}\n`
      );

      const escaped = readPolicyConfig({ projectRoot: project, workspaceRoot: workspace });
      expect(escaped.ok).toBe(false);
      if (escaped.ok) throw new Error("Expected policy traversal to fail.");
      expect(escaped.error.code).toBe("POLICY_FILE_READ_FAILED");
      rmSync(outside, { force: true });

      writeFileSync(path.join(project, "a.yml"), "version: 1\nextends: b.yml\n");
      writeFileSync(path.join(project, "b.yml"), "version: 1\nextends: a.yml\n");
      const cycle = readPolicyConfig({
        projectRoot: project,
        workspaceRoot: workspace,
        policyPath: "a.yml"
      });
      expect(cycle.ok).toBe(false);
      if (cycle.ok) throw new Error("Expected policy cycle to fail.");
      expect(cycle.error.code).toBe("POLICY_FILE_PARSE_FAILED");
      expect(cycle.error.message).toContain("cycle");
    });
  });

  test("rejects localhost, IP literals, insecure registries, and unlisted auth hosts", () => {
    const invalidPolicies = [
      ["network:", "  allowedHosts: [localhost]"],
      ["network:", "  allowedHosts: [127.0.0.1]"],
      ["network:", "  npmRegistryUrl: http://packages.example.com/npm"],
      [
        "network:",
        "  auth:",
        "    packages.example.com:",
        "      tokenEnv: TOKEN"
      ]
    ];

    for (const policyLines of invalidPolicies) {
      withWorkspace((workspace) => {
        writeFileSync(
          path.join(workspace, ".ohrisk.yml"),
          ["version: 1", ...policyLines].join("\n") + "\n"
        );
        const result = readPolicyConfig({ projectRoot: workspace });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected unsafe network policy to fail.");
        expect(result.error.code).toBe("POLICY_FILE_PARSE_FAILED");
      });
    }
  });
});
