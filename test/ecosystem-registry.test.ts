import { describe, expect, test } from "bun:test";

import {
  collectRegisteredEcosystemEvidence,
  discoverProjectLockfiles,
  ecosystemAdapterForLockfile,
  registeredEcosystemAdapters
} from "../src/ecosystems/registry";
import { supportedLockfileKinds } from "../src/project/discover";

describe("ecosystem adapter registry", () => {
  test("registers exactly one adapter for every supported lockfile kind", () => {
    const adapters = registeredEcosystemAdapters();
    expect(adapters.length).toBeGreaterThan(10);
    expect(new Set(adapters.map((adapter) => adapter.id)).size).toBe(adapters.length);

    for (const kind of supportedLockfileKinds()) {
      const adapter = ecosystemAdapterForLockfile(kind);
      expect(adapter, `missing adapter for ${kind}`).toBeDefined();
      expect(adapter?.lockfileKinds).toContain(kind);
      expect(typeof adapter?.discover).toBe("function");
      expect(typeof adapter?.parse).toBe("function");
      expect(typeof adapter?.collectEvidence).toBe("function");
    }
  });

  test("routes discovery and local evidence through the owning adapter", () => {
    const project = {
      rootDir: "/workspace",
      lockfile: { kind: "cargo-lock" as const, path: "/workspace/Cargo.lock" },
      lockfiles: [
        { kind: "cargo-lock" as const, path: "/workspace/Cargo.lock" },
        { kind: "go-mod" as const, path: "/workspace/go.mod" }
      ]
    };

    expect(discoverProjectLockfiles(project)).toEqual(project.lockfiles);
    const evidence = collectRegisteredEcosystemEvidence({
      node: {
        id: "unsupported@1.0.0",
        name: "unsupported",
        version: "1.0.0",
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["root", "unsupported@1.0.0"]]
      },
      projectRoot: "/workspace"
    });
    expect(evidence).toBeUndefined();
  });
});
