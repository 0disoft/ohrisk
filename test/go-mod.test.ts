import { describe, expect, test } from "bun:test";

import { parseGoModText } from "../src/graph/go-mod";

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
          "github.com/acme/risk v1.0.0 h1:abc",
          "github.com/acme/risk v1.0.0/go.mod h1:def",
          "github.com/acme/indirect v1.1.0 h1:ghi",
          "github.com/acme/transitive v0.2.0 h1:jkl"
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
      "github.com/acme/risk@v1.0.0",
      "github.com/acme/transitive@v0.2.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "github.com/acme/risk@v1.0.0"))
      .toMatchObject({
        ecosystem: "go",
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
    expect(result.value.nodes.find((node) => node.id === "github.com/acme/transitive@v0.2.0"))
      .toMatchObject({
        ecosystem: "go",
        dependencyType: "production",
        direct: false
      });
  });

  test("rejects replace directives instead of scanning the wrong module", () => {
    const result = parseGoModText(
      [
        "module example.com/fixture-go",
        "",
        "require github.com/acme/risk v1.0.0",
        "replace github.com/acme/risk => ../risk"
      ].join("\n"),
      "go.mod"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected replace directives to fail.");
    }

    expect(result.error.code).toBe("GO_MOD_PARSE_FAILED");
  });
});
