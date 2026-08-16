import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildLicenseeArguments,
  buildScanCodeArguments,
  materializeHeldoutCases,
  parseLicenseeHeldoutReport,
  parseScanCodeHeldoutReport,
  runHeldoutExternalTools
} from "../scripts/license-heldout-tools";
import type { HeldoutLicenseCase } from "../scripts/license-heldout";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("held-out external license tools", () => {
  test("materializes isolated package metadata and evidence without allowing path escape", () => {
    const root = temporaryRoot();
    const cases = [heldoutCase({
      id: "metadata-and-file",
      license: "MIT",
      files: [{ path: "legal/LICENSE.txt", kind: "license", text: "fixture license" }]
    })];

    materializeHeldoutCases(root, cases);

    expect(JSON.parse(readFileSync(join(root, "metadata-and-file", "package.json"), "utf8")))
      .toMatchObject({ name: "heldout-metadata-and-file", version: "1.0.0", license: "MIT" });
    expect(readFileSync(join(root, "metadata-and-file", "legal", "LICENSE.txt"), "utf8"))
      .toBe("fixture license");
    expect(() => materializeHeldoutCases(root, [heldoutCase({
      id: "path-escape",
      files: [{ path: "../outside.txt", kind: "license", text: "forbidden" }]
    })])).toThrow("safe relative path");
    expect(existsSync(join(root, "outside.txt"))).toBe(false);
  });

  test("groups ScanCode SPDX detections by held-out case and preserves tool failures", () => {
    const observations = parseScanCodeHeldoutReport({
      headers: [{ tool_name: "scancode-toolkit", tool_version: "32.3.3" }],
      files: [
        {
          path: "metadata-case/package.json",
          package_data: [{ declared_license_expression_spdx: "MIT" }],
          scan_errors: []
        },
        {
          path: "file-case/COPYING",
          detected_license_expression_spdx: "GPL-3.0-only",
          scan_errors: []
        },
        {
          path: "error-case/LICENSE",
          scan_errors: ["bounded fixture failure"]
        }
      ]
    }, ["metadata-case", "file-case", "empty-case", "error-case"]);

    expect(observations).toEqual({
      "metadata-case": { status: "detected", expressions: ["MIT"], version: "32.3.3" },
      "file-case": {
        status: "detected",
        expressions: ["GPL-3.0-only"],
        version: "32.3.3"
      },
      "empty-case": { status: "no-detection", version: "32.3.3" },
      "error-case": {
        status: "error",
        version: "32.3.3",
        note: "ScanCode reported one or more file scan errors."
      }
    });
  });

  test("parses Licensee SPDX results without treating an empty result as an error", () => {
    expect(parseLicenseeHeldoutReport({
      licenses: [
        { spdx_id: "MIT" },
        { spdx_id: "Apache-2.0" },
        { spdx_id: "MIT" }
      ],
      matched_files: []
    }, "9.19.0")).toEqual({
      status: "detected",
      expressions: ["Apache-2.0", "MIT"],
      version: "9.19.0"
    });
    expect(parseLicenseeHeldoutReport({ licenses: [], matched_files: [] }, "9.19.0"))
      .toEqual({ status: "no-detection", version: "9.19.0" });
  });

  test("builds shell-free bounded tool argument vectors", () => {
    expect(buildScanCodeArguments("C:/heldout/cases", "C:/heldout/scancode.json")).toEqual([
      "--license",
      "--package",
      "--strip-root",
      "--json",
      "C:/heldout/scancode.json",
      "C:/heldout/cases"
    ]);
    expect(buildLicenseeArguments("C:/heldout/cases/mit")).toEqual([
      "detect",
      "C:/heldout/cases/mit",
      "--json",
      "--no-readme",
      "--packages"
    ]);
  });

  test("runs both adapters and removes all temporary inputs after collecting results", () => {
    let temporaryRoot = "";
    const result = runHeldoutExternalTools([
      heldoutCase({ id: "mit-case", license: "MIT" })
    ], {
      runCommand(command, argumentsList) {
        if (command === "scancode") {
          const outputIndex = argumentsList.indexOf("--json") + 1;
          const outputPath = argumentsList[outputIndex];
          const casesRoot = argumentsList.at(-1);
          if (!outputPath || !casesRoot) {
            throw new Error("Missing ScanCode fixture arguments.");
          }
          temporaryRoot = dirname(casesRoot);
          writeFileSync(outputPath, JSON.stringify({
            headers: [{ tool_name: "scancode-toolkit", tool_version: "32.3.3" }],
            files: [{
              path: "mit-case/package.json",
              package_data: [{ declared_license_expression_spdx: "MIT" }],
              scan_errors: []
            }]
          }));
          return { status: 0, stdout: "", stderr: "" };
        }
        if (argumentsList[0] === "version") {
          return { status: 0, stdout: "Licensee 9.19.0", stderr: "" };
        }
        return {
          status: 0,
          stdout: JSON.stringify({ licenses: [{ spdx_id: "MIT" }], matched_files: [] }),
          stderr: ""
        };
      }
    });

    expect(result[0]?.external).toEqual({
      scancode: { status: "detected", expressions: ["MIT"], version: "32.3.3" },
      licensee: { status: "detected", expressions: ["MIT"], version: "9.19.0" }
    });
    expect(temporaryRoot).not.toBe("");
    expect(existsSync(temporaryRoot)).toBe(false);
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ohrisk-heldout-tools-test-"));
  temporaryRoots.push(root);
  return root;
}

function heldoutCase(input: {
  id: string;
  license?: string;
  files?: HeldoutLicenseCase["evidence"]["files"];
}): HeldoutLicenseCase {
  return {
    id: input.id,
    sourceUrl: "https://example.test/license",
    rationale: "A deterministic external tool materialization fixture.",
    evidence: {
      ...(input.license ? { metadataLicense: input.license } : {}),
      metadataSource: "fixture",
      files: input.files ?? [],
      source: "tarball",
      warnings: []
    },
    profile: "distributed-app",
    expected: { severity: "low", confidence: "high" },
    external: {
      scancode: { status: "not-run" },
      licensee: { status: "not-run" }
    }
  };
}
