import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseJuliaManifestText } from "../src/graph/julia-manifest";

describe("parseJuliaManifestText", () => {
  test("parses Julia Manifest package records and parent paths", () => {
    const result = parseJuliaManifestText([
      "julia_version = \"1.10.4\"",
      "manifest_format = \"2.0\"",
      "",
      "[[deps.RiskJulia]]",
      "deps = [\"LinearAlgebra\", \"TransitiveJulia\"]",
      "git-tree-sha1 = \"abc123\"",
      "uuid = \"11111111-1111-1111-1111-111111111111\"",
      "version = \"1.2.3\"",
      "",
      "[[deps.TransitiveJulia]]",
      "deps = []",
      "uuid = \"22222222-2222-2222-2222-222222222222\"",
      "version = \"0.2.0\"",
      "",
      "[[deps.LinearAlgebra]]",
      "uuid = \"37e2e46d-f89d-539d-b4ee-838fcccc9c8e\""
    ].join("\n"), path.join("analysis", "Manifest.toml"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("analysis");
    expect(result.value.nodes).toEqual([
      {
        id: "RiskJulia@1.2.3",
        name: "RiskJulia",
        version: "1.2.3",
        ecosystem: "julia",
        resolved: "abc123",
        dependencyType: "unknown",
        direct: true,
        paths: [["analysis", "RiskJulia@1.2.3"]]
      },
      {
        id: "TransitiveJulia@0.2.0",
        name: "TransitiveJulia",
        version: "0.2.0",
        ecosystem: "julia",
        dependencyType: "unknown",
        direct: false,
        paths: [["analysis", "RiskJulia@1.2.3", "TransitiveJulia@0.2.0"]]
      }
    ]);
  });

  test("reports manifests without versioned packages as typed errors", () => {
    const result = parseJuliaManifestText([
      "[[deps.LinearAlgebra]]",
      "uuid = \"37e2e46d-f89d-539d-b4ee-838fcccc9c8e\""
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("JULIA_MANIFEST_PARSE_FAILED");
  });

  test("uses Project.toml deps and test extras for dependency classification", () => {
    const result = parseJuliaManifestText([
      "julia_version = \"1.10.4\"",
      "manifest_format = \"2.0\"",
      "",
      "[[deps.RiskJulia]]",
      "deps = [\"TransitiveJulia\"]",
      "uuid = \"11111111-1111-1111-1111-111111111111\"",
      "version = \"1.2.3\"",
      "",
      "[[deps.TransitiveJulia]]",
      "deps = []",
      "uuid = \"22222222-2222-2222-2222-222222222222\"",
      "version = \"0.2.0\"",
      "",
      "[[deps.TestRiskJulia]]",
      "deps = [\"TestTransitiveJulia\"]",
      "uuid = \"33333333-3333-3333-3333-333333333333\"",
      "version = \"3.0.0\"",
      "",
      "[[deps.TestTransitiveJulia]]",
      "deps = []",
      "uuid = \"44444444-4444-4444-4444-444444444444\"",
      "version = \"4.0.0\""
    ].join("\n"), path.join("analysis", "Manifest.toml"), {
      projectText: [
        "[deps]",
        "RiskJulia = \"11111111-1111-1111-1111-111111111111\"",
        "",
        "[extras]",
        "TestRiskJulia = \"33333333-3333-3333-3333-333333333333\"",
        "",
        "[targets]",
        "test = [\"TestRiskJulia\"]"
      ].join("\n")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "RiskJulia@1.2.3"))
      .toMatchObject({
        dependencyType: "production",
        direct: true,
        paths: [["analysis", "RiskJulia@1.2.3"]]
      });
    expect(result.value.nodes.find((node) => node.id === "TransitiveJulia@0.2.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: false,
        paths: [["analysis", "RiskJulia@1.2.3", "TransitiveJulia@0.2.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "TestRiskJulia@3.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true,
        paths: [["analysis", "TestRiskJulia@3.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "TestTransitiveJulia@4.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: false,
        paths: [["analysis", "TestRiskJulia@3.0.0", "TestTransitiveJulia@4.0.0"]]
      });
  });
});
