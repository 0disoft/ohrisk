import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseGoModFile, parseGoModText } from "../src/graph/go-mod";

const GO_H1_A = `h1:${"A".repeat(43)}=`;
const GO_H1_B = `h1:${"B".repeat(43)}=`;

describe("parseGoModText", () => {
  test("parses direct go.mod requirements and modules from go.sum", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "go 1.22",
        "",
        "require (",
        "  github.com/acme/risk v1.0.0",
        "  github.com/acme/indirect v1.1.0 // indirect",
        ")"
      ].join("\n"),
      "fixture-go/go.mod",
      {
        goSumText: [
          `github.com/acme/risk v1.0.0 ${GO_H1_A}`,
          `github.com/acme/risk v1.0.0/go.mod ${GO_H1_B}`,
          "github.com/acme/indirect v1.1.0 h1:ghi",
          `github.com/acme/transitive v0.2.0 ${GO_H1_B}`
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("example.com/fixture-go");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "github.com/acme/indirect@v1.1.0",
      "github.com/acme/risk@v1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "github.com/acme/risk@v1.0.0"))
      .toMatchObject({
        ecosystem: "go",
        integrity: GO_H1_A,
        goModIntegrity: GO_H1_B,
        dependencyType: "production",
        direct: true,
        paths: [["example.com/fixture-go", "github.com/acme/risk@v1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "github.com/acme/indirect@v1.1.0"))
      .toMatchObject({
        ecosystem: "go",
        dependencyType: "production",
        direct: false
      });
  });

  test("classifies a module imported only from a custom build context as development", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "go 1.22",
        "",
        "require github.com/acme/tool v1.0.0"
      ].join("\n"),
      "fixture-go/go.mod",
      {
        sourceFiles: [{
          path: "internal/tooling/deps.go",
          text: [
            "//go:build dependency_tools_only",
            "",
            "package tooling",
            "",
            "import _ \"github.com/acme/tool/cmd/tool\""
          ].join("\n")
        }]
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.nodes[0]).toMatchObject({
      id: "github.com/acme/tool@v1.0.0",
      dependencyType: "development",
      direct: true
    });
  });

  test("classifies a module imported only from a legacy custom build constraint as development", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "go 1.16",
        "require github.com/acme/tool v1.0.0"
      ].join("\n"),
      "go.mod",
      {
        sourceFiles: [{
          path: "tools.go",
          text: [
            "// +build tools",
            "",
            "package tooling",
            "import _ \"github.com/acme/tool/cmd/tool\""
          ].join("\n")
        }]
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.nodes[0]?.dependencyType).toBe("development");
  });

  test("keeps imports reachable through a default platform context in production", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "go 1.22",
        "require github.com/acme/runtime v1.0.0"
      ].join("\n"),
      "go.mod",
      {
        sourceFiles: [{
          path: "runtime_windows.go",
          text: [
            "//go:build optional_feature || !linux",
            "",
            "package fixture",
            "import _ \"github.com/acme/runtime/pkg\""
          ].join("\n")
        }]
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.nodes[0]?.dependencyType).toBe("production");
  });

  test("reads bounded Go source contexts next to a filesystem go.mod", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ohrisk-go-scope-"));
    try {
      mkdirSync(path.join(root, "internal", "tooling"), { recursive: true });
      writeFileSync(path.join(root, "go.mod"), [
        "module example.com/fixture-go",
        "go 1.22",
        "require github.com/acme/tool v1.0.0"
      ].join("\n"));
      writeFileSync(path.join(root, "internal", "tooling", "deps.go"), [
        "//go:build dependency_tools_only",
        "",
        "package tooling",
        "import _ \"github.com/acme/tool/cmd/tool\""
      ].join("\n"));

      const result = parseGoModFile(path.join(root, "go.mod"));

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value.nodes[0]?.dependencyType).toBe("development");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("classifies a standard Go tool directive as development", () => {
    const result = parseGoModText([
      "module example.com/fixture-go",
      "go 1.24",
      "require github.com/acme/tool v1.0.0",
      "tool github.com/acme/tool/cmd/tool"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.nodes[0]).toMatchObject({
      id: "github.com/acme/tool@v1.0.0",
      dependencyType: "development"
    });
  });

  test("keeps go.sum-only fallback modules for pre-1.17 module graphs", () => {
    const result = parseGoModText(
      [
        "module example.com/legacy-go",
        "go 1.16",
        "require github.com/acme/risk v1.0.0"
      ].join("\n"),
      "go.mod",
      {
        goSumText: [
          `github.com/acme/risk v1.0.0 ${GO_H1_A}`,
          `github.com/acme/transitive v0.2.0 ${GO_H1_B}`
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "github.com/acme/risk@v1.0.0",
      "github.com/acme/transitive@v0.2.0"
    ]);
    expect(result.value.nodes[1]).toMatchObject({
      integrity: GO_H1_B,
      direct: false
    });
  });

  test("tracks module replacement evidence without changing the required module identity", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "require github.com/acme/risk v1.0.0",
        "replace github.com/acme/risk v1.0.0 => github.com/acme/risk-fork v1.0.1"
      ].join("\n"),
      "go.mod",
      {
        goSumText: [
          `github.com/acme/risk v1.0.0 ${GO_H1_A}`,
          `github.com/acme/risk-fork v1.0.1 ${GO_H1_B}`,
          "github.com/acme/risk-fork v1.0.1/go.mod h1:ghi"
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "github.com/acme/risk@v1.0.0"
    ]);
    expect(result.value.nodes[0]).toMatchObject({
      id: "github.com/acme/risk@v1.0.0",
      name: "github.com/acme/risk",
      version: "v1.0.0",
      resolved: "go-module:github.com/acme/risk-fork@v1.0.1",
      integrity: GO_H1_B,
      direct: true,
      paths: [["example.com/fixture-go", "github.com/acme/risk@v1.0.0"]]
    });
  });

  test("uses exact module replacements before wildcard replacements", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "require github.com/acme/risk v1.0.0",
        "replace (",
        "  github.com/acme/risk => github.com/acme/risk-fork v1.0.1",
        "  github.com/acme/risk v1.0.0 => github.com/acme/risk-hotfix v1.0.2",
        ")"
      ].join("\n"),
      "go.mod"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes[0]).toMatchObject({
      id: "github.com/acme/risk@v1.0.0",
      resolved: "go-module:github.com/acme/risk-hotfix@v1.0.2"
    });
  });

  test("records local path replacements as resolved module sources", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "require github.com/acme/risk v1.0.0",
        "replace github.com/acme/risk => ./forks/risk"
      ].join("\n"),
      "go.mod"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes[0]).toMatchObject({
      id: "github.com/acme/risk@v1.0.0",
      resolved: "./forks/risk"
    });
  });

  test("rejects module replacements without a replacement version", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "require github.com/acme/risk v1.0.0",
        "replace github.com/acme/risk => github.com/acme/risk-fork"
      ].join("\n"),
      "go.mod"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed replace directive to fail.");
    }

    expect(result.error.code).toBe("GO_MOD_PARSE_FAILED");
  });
});
