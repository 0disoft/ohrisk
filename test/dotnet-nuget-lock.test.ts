import { describe, expect, test } from "bun:test";

import { parseNugetLockText } from "../src/graph/dotnet-nuget-lock";

describe("parseNugetLockText", () => {
  test("parses direct and transitive NuGet dependencies", () => {
    const result = parseNugetLockText(
      JSON.stringify({
        version: 1,
        dependencies: {
          ".NETCoreApp,Version=v8.0": {
            "Risk.Package": {
              type: "Direct",
              requested: "[1.0.0, )",
              resolved: "1.0.0",
              dependencies: {
                "Transitive.Package": "2.0.0"
              }
            },
            "Transitive.Package": {
              type: "Transitive",
              resolved: "2.0.0"
            }
          }
        }
      }),
      "fixture-dotnet/packages.lock.json"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-dotnet");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "Risk.Package@1.0.0",
      "Transitive.Package@2.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "Risk.Package@1.0.0"))
      .toMatchObject({
        ecosystem: "nuget",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-dotnet", "Risk.Package@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "Transitive.Package@2.0.0"))
      .toMatchObject({
        ecosystem: "nuget",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-dotnet", "Risk.Package@1.0.0", "Transitive.Package@2.0.0"]]
      });
  });

  test("reports malformed packages.lock.json entries as typed errors", () => {
    const result = parseNugetLockText(
      JSON.stringify({
        version: 1,
        dependencies: {
          net8: {
            "Missing.Version": {
              type: "Direct"
            }
          }
        }
      }),
      "packages.lock.json"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed packages.lock.json to fail.");
    }

    expect(result.error.code).toBe("NUGET_LOCK_PARSE_FAILED");
  });
});
