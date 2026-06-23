import { describe, expect, test } from "bun:test";

import { parseCartfileResolvedText } from "../src/graph/carthage-cartfile-resolved";

describe("parseCartfileResolvedText", () => {
  test("parses github, git, and binary Carthage pins", () => {
    const result = parseCartfileResolvedText([
      'github "Alamofire/Alamofire" "5.10.2"',
      'git "https://github.com/acme/RiskKit.git" "v1.2.3"',
      'binary "https://example.com/releases/BinaryRisk.json" "1.0.0"'
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("Cartfile.resolved");
    expect(result.value.nodes).toEqual([
      {
        id: "Alamofire/Alamofire@5.10.2",
        name: "Alamofire/Alamofire",
        version: "5.10.2",
        ecosystem: "carthage",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "Alamofire/Alamofire@5.10.2"]]
      },
      {
        id: "BinaryRisk@1.0.0",
        name: "BinaryRisk",
        version: "1.0.0",
        ecosystem: "carthage",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "BinaryRisk@1.0.0"]]
      },
      {
        id: "RiskKit@v1.2.3",
        name: "RiskKit",
        version: "v1.2.3",
        ecosystem: "carthage",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "RiskKit@v1.2.3"]]
      }
    ]);
  });

  test("reports malformed Cartfile.resolved entries as typed errors", () => {
    const result = parseCartfileResolvedText('github "OnlyOwner" "1.0.0"');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("CARTFILE_RESOLVED_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "Cartfile.resolved",
      line: 1,
      entry: 'github "OnlyOwner" "1.0.0"'
    });
  });
});
