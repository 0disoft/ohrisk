import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBunLockfile, parseBunLockText } from "../src/graph/npm-bun-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseBunLockfile", () => {
  test("parses direct and transitive dependencies from a Bun lockfile", () => {
    const result = parseBunLockfile(path.join(fixturesDir, "bun-project", "bun.lock"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-bun-project");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "dual-license@2.0.0",
      "missing-license@4.0.0",
      "permissive-parent@1.0.0"
    ]);

    const parent = result.value.nodes.find((node) => node.id === "permissive-parent@1.0.0");
    expect(parent?.direct).toBe(true);
    expect(parent?.dependencyType).toBe("production");
    expect(parent?.paths).toEqual([["fixture-bun-project", "permissive-parent@1.0.0"]]);

    const child = result.value.nodes.find((node) => node.id === "agpl-child@0.1.0");
    expect(child?.direct).toBe(false);
    expect(child?.dependencyType).toBe("production");
    expect(child?.paths).toEqual([
      ["fixture-bun-project", "permissive-parent@1.0.0", "agpl-child@0.1.0"]
    ]);

    const devRisk = result.value.nodes.find((node) => node.id === "dev-risk@3.0.0");
    expect(devRisk?.dependencyType).toBe("development");

    const missingLicense = result.value.nodes.find((node) => node.id === "missing-license@4.0.0");
    expect(missingLicense?.direct).toBe(true);
    expect(missingLicense?.dependencyType).toBe("production");
    expect(missingLicense?.paths).toEqual([["fixture-bun-project", "missing-license@4.0.0"]]);
  });

  test("reports malformed Bun lockfiles as typed errors", () => {
    const result = parseBunLockText("{ this is not json", "broken-bun.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed lockfile to fail.");
    }

    expect(result.error.code).toBe("BUN_LOCK_PARSE_FAILED");
  });
});
