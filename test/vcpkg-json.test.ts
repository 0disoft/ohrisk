import { describe, expect, test } from "bun:test";
import path from "node:path";

import { parseVcpkgJsonText } from "../src/graph/vcpkg-json";

describe("parseVcpkgJsonText", () => {
  test("parses installed vcpkg status records with manifest direct roots", () => {
    const result = parseVcpkgJsonText(
      JSON.stringify({
        name: "fixture-cpp",
        dependencies: [
          "spdlog",
          {
            name: "vcpkg-cmake",
            host: true
          }
        ]
      }),
      "vcpkg.json",
      {
        statusText: [
          "Package: fmt",
          "Version: 11.2.0",
          "Architecture: x64-windows",
          "Status: install ok installed",
          "",
          "Package: spdlog",
          "Version: 1.15.1",
          "Depends: fmt, vcpkg-cmake",
          "Architecture: x64-windows",
          "Status: install ok installed",
          "",
          "Package: vcpkg-cmake",
          "Version: 2024-04-23",
          "Architecture: x64-windows",
          "Status: install ok installed"
        ].join("\n"),
        statusPath: "vcpkg_installed/vcpkg/status"
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "fmt@11.2.0",
        name: "fmt",
        version: "11.2.0",
        ecosystem: "vcpkg",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-cpp", "spdlog@1.15.1", "fmt@11.2.0"]]
      },
      {
        id: "spdlog@1.15.1",
        name: "spdlog",
        version: "1.15.1",
        ecosystem: "vcpkg",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-cpp", "spdlog@1.15.1"]]
      },
      {
        id: "vcpkg-cmake@2024-04-23",
        name: "vcpkg-cmake",
        version: "2024-04-23",
        ecosystem: "vcpkg",
        dependencyType: "production",
        direct: true,
        paths: [
          ["fixture-cpp", "spdlog@1.15.1", "vcpkg-cmake@2024-04-23"],
          ["fixture-cpp", "vcpkg-cmake@2024-04-23"]
        ]
      }
    ]);
  });

  test("uses exact overrides only when installed status is unavailable", () => {
    const result = parseVcpkgJsonText(JSON.stringify({
      name: "fixture-cpp",
      dependencies: ["zlib"],
      overrides: [
        {
          name: "zlib",
          version: "1.3.1"
        }
      ]
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "zlib@1.3.1",
        name: "zlib",
        version: "1.3.1",
        ecosystem: "vcpkg",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-cpp", "zlib@1.3.1"]]
      }
    ]);
  });

  test("rejects manifests without resolved status or exact overrides", () => {
    const result = parseVcpkgJsonText(JSON.stringify({
      dependencies: [
        {
          name: "fmt",
          "version>=": "10.1.1"
        }
      ],
      "builtin-baseline": "3426db05b996481ca31e95fff3734cf23e0f51bc"
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("VCPKG_JSON_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      missingInstalledStatus: path.join("vcpkg_installed", "vcpkg", "status"),
      dependenciesWithoutExactOverride: ["fmt"]
    });
  });
});
