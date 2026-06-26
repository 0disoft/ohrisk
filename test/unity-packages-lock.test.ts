import path from "node:path";
import { describe, expect, test } from "bun:test";

import { parseUnityPackagesLockText } from "../src/graph/unity-packages-lock";

describe("parseUnityPackagesLockText", () => {
  test("parses Unity Package Manager lock dependencies", () => {
    const result = parseUnityPackagesLockText(JSON.stringify({
      dependencies: {
        "com.acme.risk": {
          version: "1.2.3",
          depth: 0,
          source: "registry",
          dependencies: {
            "com.acme.transitive": "2.0.0"
          },
          url: "https://packages.example.com"
        },
        "com.acme.transitive": {
          version: "2.0.0",
          depth: 1,
          source: "git",
          dependencies: {}
        },
        "com.unity.modules.ai": {
          version: "1.0.0",
          depth: 0,
          source: "builtin",
          dependencies: {}
        }
      }
    }), path.join("Game", "Packages", "packages-lock.json"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("Game");
    expect(result.value.nodes).toEqual([
      {
        id: "com.acme.risk@1.2.3",
        name: "com.acme.risk",
        version: "1.2.3",
        ecosystem: "unity",
        resolved: "https://packages.example.com",
        dependencyType: "production",
        direct: true,
        paths: [["Game", "com.acme.risk@1.2.3"]]
      },
      {
        id: "com.acme.transitive@2.0.0",
        name: "com.acme.transitive",
        version: "2.0.0",
        ecosystem: "unity",
        dependencyType: "production",
        direct: false,
        paths: [["Game", "com.acme.risk@1.2.3", "com.acme.transitive@2.0.0"]]
      }
    ]);
  });

  test("stops walking Unity package dependency cycles without dropping reachable paths", () => {
    const result = parseUnityPackagesLockText(JSON.stringify({
      dependencies: {
        "com.acme.cycle-a": {
          version: "1.0.0",
          depth: 1,
          source: "registry",
          dependencies: {
            "com.acme.cycle-b": "1.0.0"
          }
        },
        "com.acme.cycle-b": {
          version: "1.0.0",
          depth: 2,
          source: "registry",
          dependencies: {
            "com.acme.cycle-a": "1.0.0",
            "com.acme.leaf": "1.0.0"
          }
        },
        "com.acme.leaf": {
          version: "1.0.0",
          depth: 3,
          source: "registry",
          dependencies: {}
        },
        "com.acme.risk": {
          version: "1.0.0",
          depth: 0,
          source: "registry",
          dependencies: {
            "com.acme.cycle-a": "1.0.0"
          }
        }
      }
    }), path.join("Game", "Packages", "packages-lock.json"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "com.acme.cycle-a@1.0.0",
      "com.acme.cycle-b@1.0.0",
      "com.acme.leaf@1.0.0",
      "com.acme.risk@1.0.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "com.acme.cycle-b@1.0.0")?.paths)
      .toContainEqual([
        "Game",
        "com.acme.risk@1.0.0",
        "com.acme.cycle-a@1.0.0",
        "com.acme.cycle-b@1.0.0"
      ]);
    expect(result.value.nodes.find((node) => node.id === "com.acme.leaf@1.0.0")?.paths)
      .toContainEqual([
        "Game",
        "com.acme.risk@1.0.0",
        "com.acme.cycle-a@1.0.0",
        "com.acme.cycle-b@1.0.0",
        "com.acme.leaf@1.0.0"
      ]);
  });

  test("reports malformed package entries as typed errors", () => {
    const result = parseUnityPackagesLockText(JSON.stringify({
      dependencies: {
        "com.acme.risk": {
          depth: 0,
          source: "registry"
        }
      }
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("UNITY_PACKAGES_LOCK_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      packageName: "com.acme.risk",
      reason: "missing_version"
    });
  });
});
