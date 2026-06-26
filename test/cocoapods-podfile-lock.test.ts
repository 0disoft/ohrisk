import { describe, expect, test } from "bun:test";

import { parsePodfileLockText } from "../src/graph/cocoapods-podfile-lock";

describe("parsePodfileLockText", () => {
  test("parses direct and transitive CocoaPods dependencies", () => {
    const result = parsePodfileLockText(
      [
        "PODS:",
        "  - RiskPod (1.0.0):",
        "    - TransitivePod (~> 2.0)",
        "  - TransitivePod (2.0.0)",
        "",
        "DEPENDENCIES:",
        "  - RiskPod (~> 1.0)",
        "",
        "SPEC CHECKSUMS:",
        "  RiskPod: abc123",
        "",
        "COCOAPODS: 1.16.2"
      ].join("\n"),
      "fixture-ios/Podfile.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-ios");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "RiskPod@1.0.0",
      "TransitivePod@2.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "RiskPod@1.0.0"))
      .toMatchObject({
        ecosystem: "cocoapods",
        dependencyType: "unknown",
        direct: true,
        paths: [["fixture-ios", "RiskPod@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "TransitivePod@2.0.0"))
      .toMatchObject({
        ecosystem: "cocoapods",
        dependencyType: "unknown",
        direct: false,
        paths: [["fixture-ios", "RiskPod@1.0.0", "TransitivePod@2.0.0"]]
      });
  });

  test("stops walking CocoaPods dependency cycles without dropping reachable paths", () => {
    const result = parsePodfileLockText(
      [
        "PODS:",
        "  - CycleA (1.0.0):",
        "    - CycleB (~> 1.0)",
        "  - CycleB (1.0.0):",
        "    - CycleA (~> 1.0)",
        "    - LeafPod (~> 1.0)",
        "  - LeafPod (1.0.0)",
        "  - RiskPod (1.0.0):",
        "    - CycleA (~> 1.0)",
        "",
        "DEPENDENCIES:",
        "  - RiskPod (~> 1.0)",
        "",
        "SPEC CHECKSUMS:",
        "  RiskPod: abc123",
        "",
        "COCOAPODS: 1.16.2"
      ].join("\n"),
      "fixture-ios/Podfile.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "CycleA@1.0.0",
      "CycleB@1.0.0",
      "LeafPod@1.0.0",
      "RiskPod@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "CycleB@1.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-ios", "RiskPod@1.0.0", "CycleA@1.0.0", "CycleB@1.0.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "LeafPod@1.0.0"))
      .toMatchObject({
        direct: false,
        paths: [["fixture-ios", "RiskPod@1.0.0", "CycleA@1.0.0", "CycleB@1.0.0", "LeafPod@1.0.0"]]
      });
  });

  test("collapses CocoaPods subspecs to their root pod identity", () => {
    const result = parsePodfileLockText(
      [
        "PODS:",
        "  - Firebase/Analytics (11.0.0):",
        "    - Firebase/CoreOnly",
        "  - Firebase/CoreOnly (11.0.0)",
        "",
        "DEPENDENCIES:",
        "  - Firebase/Analytics"
      ].join("\n"),
      "Podfile.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toHaveLength(1);
    expect(result.value.nodes[0]).toMatchObject({
      id: "Firebase@11.0.0",
      name: "Firebase",
      version: "11.0.0",
      ecosystem: "cocoapods",
      direct: true
    });
  });

  test("reports malformed top-level PODS entries as typed errors", () => {
    const result = parsePodfileLockText(
      [
        "PODS:",
        "  - MissingVersion",
        "",
        "DEPENDENCIES:",
        "  - MissingVersion"
      ].join("\n"),
      "Podfile.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed Podfile.lock to fail.");
    }

    expect(result.error.code).toBe("PODFILE_LOCK_PARSE_FAILED");
  });
});
