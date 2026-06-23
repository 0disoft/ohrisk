import { describe, expect, test } from "bun:test";

import {
  parseDirectoryPackagesPropsText,
  parseDotnetProjectText,
  parseNugetLockText,
  parseNugetPackagesConfigText,
  parseNugetProjectAssetsText
} from "../src/graph/dotnet-nuget-lock";

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

describe("parseNugetProjectAssetsText", () => {
  test("parses restored NuGet assets with direct and transitive dependencies", () => {
    const result = parseNugetProjectAssetsText(
      JSON.stringify({
        version: 3,
        targets: {
          ".NETCoreApp,Version=v8.0": {
            "Risk.Package/1.0.0": {
              type: "package",
              dependencies: {
                "Transitive.Package": "2.0.0"
              }
            },
            "Transitive.Package/2.0.0": {
              type: "package"
            }
          }
        },
        libraries: {
          "Risk.Package/1.0.0": {
            type: "package"
          },
          "Transitive.Package/2.0.0": {
            type: "package"
          }
        },
        projectFileDependencyGroups: {
          net8: [
            "Risk.Package >= 1.0.0"
          ]
        }
      }),
      "fixture-dotnet/obj/project.assets.json"
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

  test("reports malformed project.assets.json package keys as typed errors", () => {
    const result = parseNugetProjectAssetsText(
      JSON.stringify({
        version: 3,
        targets: {
          net8: {
            "MissingVersion": {
              type: "package"
            }
          }
        }
      }),
      "obj/project.assets.json"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed project.assets.json to fail.");
    }

    expect(result.error.code).toBe("NUGET_ASSETS_PARSE_FAILED");
  });
});

describe("parseDotnetProjectText", () => {
  test("parses direct PackageReference dependencies from a .csproj file", () => {
    const result = parseDotnetProjectText(
      [
        "<Project Sdk=\"Microsoft.NET.Sdk\">",
        "  <ItemGroup>",
        "    <PackageReference Include=\"Risk.Package\" Version=\"1.0.0\" />",
        "    <PackageReference Include=\"Exact.Range\">",
        "      <Version>[2.0.0]</Version>",
        "    </PackageReference>",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n"),
      "Fixture.App.csproj"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("Fixture.App");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "Exact.Range@2.0.0",
      "Risk.Package@1.0.0"
    ]);
    expect(result.value.nodes.every((node) => node.direct)).toBe(true);
    expect(result.value.nodes.every((node) => node.dependencyType === "production")).toBe(true);
  });

  test("rejects PackageReference entries without literal resolved versions", () => {
    const result = parseDotnetProjectText(
      [
        "<Project Sdk=\"Microsoft.NET.Sdk\">",
        "  <ItemGroup>",
        "    <PackageReference Include=\"Central.Package\" />",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n"),
      "Central.App.csproj"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected centrally managed PackageReference to fail.");
    }

    expect(result.error.code).toBe("DOTNET_PROJECT_PARSE_FAILED");
  });

  test("uses Directory.Packages.props PackageVersion entries for centrally managed PackageReferences", () => {
    const centralVersions = parseDirectoryPackagesPropsText(
      [
        "<Project>",
        "  <ItemGroup>",
        "    <PackageVersion Include=\"Central.Package\" Version=\"3.2.1\" />",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n"),
      "Directory.Packages.props"
    );

    expect(centralVersions.ok).toBe(true);
    if (!centralVersions.ok) {
      throw new Error(centralVersions.error.message);
    }

    const result = parseDotnetProjectText(
      [
        "<Project Sdk=\"Microsoft.NET.Sdk\">",
        "  <ItemGroup>",
        "    <PackageReference Include=\"Central.Package\" />",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n"),
      "Central.App.csproj",
      {
        centralPackageVersions: centralVersions.value
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      expect.objectContaining({
        id: "Central.Package@3.2.1",
        name: "Central.Package",
        version: "3.2.1",
        ecosystem: "nuget",
        dependencyType: "production",
        direct: true,
        paths: [["Central.App", "Central.Package@3.2.1"]]
      })
    ]);
  });

  test("rejects centrally managed PackageReferences when PackageVersion is ambiguous", () => {
    const centralVersions = parseDirectoryPackagesPropsText(
      [
        "<Project>",
        "  <ItemGroup>",
        "    <PackageVersion Include=\"Central.Package\" Version=\"3.2.1\" Condition=\"'$(TargetFramework)' == 'net8.0'\" />",
        "    <PackageVersion Include=\"Central.Package\" Version=\"4.0.0\" Condition=\"'$(TargetFramework)' == 'net9.0'\" />",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n")
    );

    expect(centralVersions.ok).toBe(true);
    if (!centralVersions.ok) {
      throw new Error(centralVersions.error.message);
    }

    const result = parseDotnetProjectText(
      [
        "<Project Sdk=\"Microsoft.NET.Sdk\">",
        "  <ItemGroup>",
        "    <PackageReference Include=\"Central.Package\" />",
        "  </ItemGroup>",
        "</Project>"
      ].join("\n"),
      "Central.App.csproj",
      {
        centralPackageVersions: centralVersions.value
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected ambiguous central PackageVersion to fail.");
    }

    expect(result.error.code).toBe("DOTNET_PROJECT_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      packageName: "Central.Package",
      centralVersion: "ambiguous"
    });
  });
});

describe("parseNugetPackagesConfigText", () => {
  test("parses flat NuGet packages.config entries", () => {
    const result = parseNugetPackagesConfigText(
      [
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
        "<packages>",
        "  <package id=\"Risk.Package\" version=\"1.0.0\" targetFramework=\"net48\" />",
        "  <package id=\"Dev.Tool\" version=\"2.0.0\" developmentDependency=\"true\" />",
        "</packages>"
      ].join("\n"),
      "fixture-dotnet/packages.config"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-dotnet");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "Dev.Tool@2.0.0",
      "Risk.Package@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "Risk.Package@1.0.0"))
      .toMatchObject({
        ecosystem: "nuget",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-dotnet", "Risk.Package@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "Dev.Tool@2.0.0"))
      .toMatchObject({
        ecosystem: "nuget",
        dependencyType: "development",
        direct: true,
        paths: [["fixture-dotnet", "Dev.Tool@2.0.0"]]
      });
  });

  test("reports malformed packages.config entries as typed errors", () => {
    const result = parseNugetPackagesConfigText(
      [
        "<packages>",
        "  <package id=\"Missing.Version\" />",
        "</packages>"
      ].join("\n"),
      "packages.config"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed packages.config to fail.");
    }

    expect(result.error.code).toBe("NUGET_PACKAGES_CONFIG_PARSE_FAILED");
  });
});
