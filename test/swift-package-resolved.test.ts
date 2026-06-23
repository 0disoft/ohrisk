import { describe, expect, test } from "bun:test";

import { parseSwiftPackageResolvedText } from "../src/graph/swift-package-resolved";

describe("parseSwiftPackageResolvedText", () => {
  test("parses Swift Package.resolved v2 pins", () => {
    const result = parseSwiftPackageResolvedText(
      JSON.stringify({
        pins: [
          {
            identity: "risk-swift",
            kind: "remoteSourceControl",
            location: "https://github.com/acme/risk-swift.git",
            state: {
              revision: "0123456789abcdef",
              version: "1.0.0"
            }
          },
          {
            identity: "revision-only",
            kind: "remoteSourceControl",
            location: "https://github.com/acme/revision-only.git",
            state: {
              revision: "abcdef0123456789"
            }
          }
        ],
        version: 2
      }),
      "fixture-swift/Package.resolved"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-swift");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "revision-only@abcdef0123456789",
      "risk-swift@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "risk-swift@1.0.0"))
      .toMatchObject({
        ecosystem: "swift",
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-swift", "risk-swift@1.0.0"]]
      });
  });

  test("parses Swift Package.resolved v1 package fields", () => {
    const result = parseSwiftPackageResolvedText(
      JSON.stringify({
        object: {
          pins: [
            {
              package: "RiskSwift",
              repositoryURL: "https://github.com/acme/risk-swift.git",
              state: {
                branch: null,
                revision: "0123456789abcdef",
                version: "1.0.0"
              }
            }
          ]
        },
        version: 1
      }),
      "Package.resolved"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength(1);
    expect(result.value.nodes[0]).toMatchObject({
      id: "RiskSwift@1.0.0",
      name: "RiskSwift",
      version: "1.0.0",
      ecosystem: "swift"
    });
  });

  test("reports malformed Package.resolved pins as typed errors", () => {
    const result = parseSwiftPackageResolvedText(
      JSON.stringify({
        pins: [
          {
            identity: "missing-state"
          }
        ],
        version: 2
      }),
      "Package.resolved"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed Package.resolved to fail.");
    }

    expect(result.error.code).toBe("SWIFT_PACKAGE_RESOLVED_PARSE_FAILED");
  });
});
