import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GitRefFileReader } from "../src/git/ref-file";
import { readPolicyConfigFromRef } from "../src/policy/ref-config";
import { createError } from "../src/shared/errors";
import { err, ok } from "../src/shared/result";

function withWorkspace(run: (workspace: string, project: string) => void): void {
  const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-policy-ref-test-"));
  const project = path.join(workspace, "apps", "api");
  mkdirSync(project, { recursive: true });
  try {
    run(workspace, project);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

function mapReader(files: ReadonlyMap<string, string>): GitRefFileReader {
  return ({ relativePath }) => files.has(relativePath)
    ? ok(files.get(relativePath) ?? "")
    : err(createError({
        code: "GIT_REF_FILE_NOT_FOUND",
        category: "invalid_input",
        message: "missing baseline file",
        details: { relativePath }
      }));
}

describe("baseline policy configuration", () => {
  test("loads inherited policy files from the selected git ref", () => {
    withWorkspace((workspace, project) => {
      const result = readPolicyConfigFromRef({
        projectRoot: project,
        workspaceRoot: workspace,
        ref: "main",
        readRefFile: mapReader(new Map([
          ["base.yml", [
            "version: 1",
            "licenses:",
            "  severity:",
            "    AGPL-3.0-only: high"
          ].join("\n") + "\n"],
          ["apps/api/.ohrisk.yml", [
            "version: 1",
            "extends: ../../base.yml",
            "packages:",
            "  'agpl-child@0.1.0':",
            "    severity: review"
          ].join("\n") + "\n"]
        ]))
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.severityOverrides.get("AGPL-3.0-only")).toBe("high");
      expect(result.value.packageRules.get("agpl-child@0.1.0")?.severity).toBe("review");
      expect(result.value.sourceFiles).toEqual([
        "base.yml",
        "apps/api/.ohrisk.yml"
      ]);
    });
  });

  test("returns an empty policy when the default baseline policy is absent", () => {
    withWorkspace((workspace, project) => {
      const result = readPolicyConfigFromRef({
        projectRoot: project,
        workspaceRoot: workspace,
        ref: "main",
        readRefFile: mapReader(new Map())
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.sourceFiles).toEqual([]);
    });
  });
});
