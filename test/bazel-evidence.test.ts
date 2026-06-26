import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectBazelModuleEvidence } from "../src/evidence/bazel-module";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectBazelModuleEvidence", () => {
  test("reads license evidence from a local Bazel registry local_path source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bazel-evidence-"));
    tempRoots.push(projectRoot);

    const sourceDir = writeBazelLocalPathModule({
      projectRoot,
      packageName: "risk_bazel",
      version: "1.0.0"
    });
    writeFileSync(path.join(sourceDir, "LICENSE"), "SPDX-License-Identifier: AGPL-3.0-only", "utf8");

    const evidence = collectBazelModuleEvidence({
      packageId: "risk_bazel@1.0.0",
      packageName: "risk_bazel",
      version: "1.0.0",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk_bazel@1.0.0",
      source: "local",
      files: [
        {
          path: "LICENSE",
          kind: "license",
          text: "SPDX-License-Identifier: AGPL-3.0-only"
        }
      ]
    });
  });

  test("stops collecting Bazel module evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-bazel-evidence-limit-"));
    tempRoots.push(projectRoot);

    const sourceDir = writeBazelLocalPathModule({
      projectRoot,
      packageName: "risk_bazel",
      version: "1.0.0"
    });
    for (let index = 0; index < 51; index += 1) {
      const suffix = index.toString().padStart(2, "0");
      writeFileSync(path.join(sourceDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
    }

    const evidence = collectBazelModuleEvidence({
      packageId: "risk_bazel@1.0.0",
      packageName: "risk_bazel",
      version: "1.0.0",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value.files).toHaveLength(50);
    expect(evidence.value.warnings).toContain(
      "Bazel module evidence file limit reached at 50 files."
    );
    expect(evidence.value.warnings).not.toContain(
      "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Bazel module source."
    );
  });
});

function writeBazelLocalPathModule(input: {
  projectRoot: string;
  packageName: string;
  version: string;
}): string {
  const sourceDir = path.join(input.projectRoot, "sources", input.packageName);
  const moduleDir = path.join(input.projectRoot, "modules", input.packageName, input.version);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(
    path.join(input.projectRoot, "bazel_registry.json"),
    JSON.stringify({ module_base_path: "sources" }),
    "utf8"
  );
  writeFileSync(
    path.join(moduleDir, "source.json"),
    JSON.stringify({ type: "local_path", path: input.packageName }),
    "utf8"
  );
  return sourceDir;
}
