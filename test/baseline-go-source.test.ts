import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadBaselineProjectGraph } from "../src/cli/main";
import { ok } from "../src/shared/result";

describe("loadBaselineProjectGraph Go source context", () => {
  test("classifies baseline-only build-tag imports from the requested ref", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-baseline-go-"));
    try {
      const files: Record<string, string> = {
        "go.mod": [
          "module example.com/app",
          "go 1.22",
          "require example.com/tool v1.0.0",
          ""
        ].join("\n"),
        "go.sum": "example.com/tool v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n",
        "tools.go": [
          "//go:build tools",
          "",
          "package tools",
          "import _ \"example.com/tool/cmd/tool\"",
          ""
        ].join("\n")
      };
      const result = loadBaselineProjectGraph({
        currentProject: {
          project: {
            rootDir: projectRoot,
            lockfile: { kind: "go-mod", path: path.join(projectRoot, "go.mod") }
          },
          scanGraph: {
            rootName: "example.com/app",
            lockfilePath: "go.mod",
            nodes: []
          }
        },
        baselineRef: "main",
        allLockfiles: false,
        listRefFiles: () => ok(Object.keys(files)),
        readRefFile: ({ relativePath }) => ok(files[relativePath] ?? "")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.graph.nodes[0]?.dependencyType).toBe("development");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
