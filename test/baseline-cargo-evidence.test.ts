import { describe, expect, test } from "bun:test";
import path from "node:path";

import { loadBaselineProjectGraph } from "../src/cli/baseline-project";
import { createError } from "../src/shared/errors";
import { err, ok } from "../src/shared/result";

describe("baseline Cargo workspace evidence", () => {
  test("reads workspace-root legal files from the requested Git ref", () => {
    const projectRoot = path.resolve("workspace");
    const files = new Map<string, string>([
      ["Cargo.lock", [
        "[[package]]",
        "name = \"watt\"",
        "version = \"1.4.0\""
      ].join("\n")],
      ["Cargo.toml", [
        "[workspace]",
        "members = [\"watt\"]",
        "",
        "[workspace.package]",
        "version = \"1.4.0\"",
        "license = \"MPL-2.0\""
      ].join("\n")],
      ["watt/Cargo.toml", [
        "[package]",
        "name = \"watt\"",
        "version.workspace = true"
      ].join("\n")],
      ["LICENSE", "Mozilla Public License Version 2.0"]
    ]);

    const result = loadBaselineProjectGraph({
      currentProject: {
        project: {
          rootDir: projectRoot,
          lockfile: {
            kind: "cargo-lock",
            path: path.join(projectRoot, "Cargo.lock")
          }
        },
        scanGraph: {
          rootName: "watt",
          lockfilePath: path.join(projectRoot, "Cargo.lock"),
          nodes: []
        }
      },
      baselineRef: "HEAD~1",
      allLockfiles: false,
      listRefFiles: () => ok([...files.keys()]),
      readRefFile: ({ relativePath }) => {
        const text = files.get(relativePath.replace(/\\/g, "/"));
        return text === undefined
          ? err(createError({
              code: "GIT_REF_FILE_NOT_FOUND",
              category: "unsupported_input",
              message: "File not found in test snapshot."
            }))
          : ok(text);
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.graph.embeddedEvidence).toEqual([{
      packageId: "watt@1.4.0",
      files: [{
        path: "LICENSE",
        kind: "license",
        text: "Mozilla Public License Version 2.0"
      }],
      source: "local",
      warnings: []
    }]);
  });
});
