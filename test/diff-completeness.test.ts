import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli/main";
import { ok, err } from "../src/shared/result";
import { createError } from "../src/shared/errors";
import { buildScanCompleteness, incompleteEvidenceGateFailed } from "../src/policy/completeness";

test("available evidence with an unidentified license is complete", () => {
  const completeness = buildScanCompleteness({ evidence: [{
    packageId: "example@1.0.0", source: "sbom", files: [], warnings: ["No license declared"]
  }] });
  expect(completeness.status).toBe("complete");
  expect(incompleteEvidenceGateFailed({ enabled: true, allowPartialEvidence: false, completeness })).toBe(false);
});

function lockfile(hasUnavailablePackage: boolean): string {
  return JSON.stringify({
    name: "app", lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: hasUnavailablePackage ? { missing: "1.0.0" } : {} },
      ...(hasUnavailablePackage ? { "node_modules/missing": { version: "1.0.0" } } : {})
    }
  });
}

for (const unavailableSide of ["baseline", "current"] as const) {
  test(`diff gates reject unavailable ${unavailableSide} evidence independently of severity`, async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ohrisk-diff-completeness-"));
    try {
      writeFileSync(path.join(cwd, "package-lock.json"), lockfile(unavailableSide === "current"));
      const execute = async (options: string[]) => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const exitCode = await main(["diff", "main", "--offline", "--json", "--cache-dir", path.join(cwd, ".cache"), ...options], {
          cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text),
          listRefFiles: () => ok(["package-lock.json"]),
          readRefFile: ({ relativePath }) => relativePath === "package-lock.json"
            ? ok(lockfile(unavailableSide === "baseline"))
            : err(createError({ code: "GIT_REF_FILE_NOT_FOUND", category: "invalid_input", message: "Absent fixture file" }))
        });
        expect(stderr).toEqual([]);
        return { exitCode, report: JSON.parse(stdout.join("\n")) };
      };
      const strict = await execute(["--fail-on", "high"]);
      expect(strict.exitCode).toBe(1);
      expect(strict.report.completeness.status).toBe("partial");
      expect(strict.report.completeness[unavailableSide].unavailablePackageCount).toBe(1);
      expect(strict.report.evidenceGateFailed).toBe(true);
      const allowed = await execute(["--fail-on", "high", "--allow-partial-evidence"]);
      expect(allowed.exitCode).toBe(0);
      expect(allowed.report.completeness).toEqual(strict.report.completeness);
      expect(allowed.report.allowPartialEvidence).toBe(true);
      expect(allowed.report.evidenceGateFailed).toBe(false);
      const informational = await execute([]);
      expect(informational.exitCode).toBe(0);
      expect(informational.report.completeness.status).toBe("partial");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
