import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseProjectDependencyGraph } from "../src/ecosystems/registry";
import { mergeDependencyGraphs } from "../src/graph/merge";
import type { DependencyNode } from "../src/graph/types";
import { discoverProject, projectLockfiles } from "../src/project/discover";

function withMixedProject(run: (projectRoot: string) => void): void {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-multi-lockfile-"));
  try {
    writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "mixed-project",
      version: "1.0.0",
      dependencies: { "left-pad": "1.3.0" }
    }, null, 2) + "\n");
    writeFileSync(path.join(projectRoot, "package-lock.json"), JSON.stringify({
      name: "mixed-project",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "mixed-project",
          version: "1.0.0",
          dependencies: { "left-pad": "1.3.0" }
        },
        "node_modules/left-pad": {
          version: "1.3.0",
          resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
          integrity: "sha512-XI5MPzVNApjAyhQz5pXXQnGN4V1NVnhfKQ8wE4wcI3BmiWz9Md4nZ0A0KSJykPpC3c8gZzLBQUYbLFv7x0YpDQ=="
        }
      }
    }, null, 2) + "\n");
    writeFileSync(path.join(projectRoot, "Cargo.toml"), [
      "[package]",
      "name = \"mixed-rust\"",
      "version = \"0.1.0\"",
      "",
      "[dependencies]",
      "serde = \"1.0.0\""
    ].join("\n") + "\n");
    writeFileSync(path.join(projectRoot, "Cargo.lock"), [
      "version = 3",
      "",
      "[[package]]",
      "name = \"mixed-rust\"",
      "version = \"0.1.0\"",
      "dependencies = [",
      " \"serde\",",
      "]",
      "",
      "[[package]]",
      "name = \"serde\"",
      "version = \"1.0.0\"",
      "source = \"registry+https://github.com/rust-lang/crates.io-index\"",
      "checksum = \"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\""
    ].join("\n") + "\n");

    run(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

function npmNode(input: Partial<DependencyNode> & Pick<DependencyNode, "id">): DependencyNode {
  return {
    id: input.id,
    name: input.name ?? "shared",
    version: input.version ?? "1.0.0",
    ecosystem: "npm",
    dependencyType: input.dependencyType ?? "production",
    direct: input.direct ?? true,
    paths: input.paths ?? [["root", input.id]],
    ...(input.resolved ? { resolved: input.resolved } : {}),
    ...(input.integrity ? { integrity: input.integrity } : {})
  };
}

describe("multi-lockfile projects", () => {
  test("requires explicit opt-in and discovers all lockfiles in one project root", () => {
    withMixedProject((projectRoot) => {
      const defaultDiscovery = discoverProject({ cwd: projectRoot });
      expect(defaultDiscovery.ok).toBe(false);
      if (defaultDiscovery.ok) throw new Error("Expected ambiguous lockfiles to fail.");
      expect(defaultDiscovery.error.code).toBe("MULTIPLE_LOCKFILES");
      expect(defaultDiscovery.error.message).toContain("--all");

      const discovery = discoverProject({ cwd: projectRoot, allLockfiles: true });
      expect(discovery.ok).toBe(true);
      if (!discovery.ok) throw new Error(discovery.error.message);

      expect(projectLockfiles(discovery.value).map((lockfile) => lockfile.kind)).toEqual([
        "cargo-lock",
        "package-lock"
      ]);
      expect(discovery.value.rootDir).toBe(projectRoot);
    });
  });

  test("parses and merges every selected ecosystem with package provenance", () => {
    withMixedProject((projectRoot) => {
      const discovery = discoverProject({ cwd: projectRoot, allLockfiles: true });
      if (!discovery.ok) throw new Error(discovery.error.message);

      const graph = parseProjectDependencyGraph(discovery.value);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw new Error(graph.error.message);

      expect(graph.value.lockfilePaths).toEqual([
        path.join(projectRoot, "Cargo.lock"),
        path.join(projectRoot, "package-lock.json")
      ]);
      expect(graph.value.nodes.map((node) => `${node.ecosystem}:${node.name}`)).toEqual([
        "npm:left-pad",
        "cargo:serde"
      ]);
      expect(graph.value.nodes[0]?.origins).toEqual([{
        lockfileKind: "package-lock",
        lockfilePath: path.join(projectRoot, "package-lock.json")
      }]);
      expect(graph.value.nodes[1]?.origins).toEqual([{
        lockfileKind: "cargo-lock",
        lockfilePath: path.join(projectRoot, "Cargo.lock")
      }]);
    });
  });

  test("allows nested uv local sources inside the repository scan root", () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-uv-repository-root-"));
    try {
      const datasetsDir = path.join(repositoryRoot, "datasets");
      const localSourceDir = path.join(repositoryRoot, "dev");
      mkdirSync(datasetsDir, { recursive: true });
      mkdirSync(localSourceDir, { recursive: true });
      writeFileSync(path.join(localSourceDir, "pyproject.toml"), [
        "[project]",
        "name = \"flower-dev\"",
        "version = \"1.2.3\"",
        "license = \"Apache-2.0\""
      ].join("\n") + "\n");
      writeFileSync(path.join(localSourceDir, "LICENSE"), "Apache License\n");
      const lockfilePath = path.join(datasetsDir, "uv.lock");
      writeFileSync(lockfilePath, [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"datasets\"",
        "version = \"0.1.0\"",
        "source = { virtual = \".\" }",
        "dependencies = [{ name = \"flower-dev\" }]",
        "",
        "[[package]]",
        "name = \"flower-dev\"",
        "version = \"1.2.3\"",
        "source = { directory = \"../dev\" }"
      ].join("\n") + "\n");

      const graph = parseProjectDependencyGraph({
        rootDir: repositoryRoot,
        lockfile: { kind: "uv-lock", path: lockfilePath }
      });

      expect(graph.ok).toBe(true);
      if (!graph.ok) throw new Error(graph.error.message);
      expect(graph.value.nodes).toEqual([
        expect.objectContaining({
          id: "flower-dev@1.2.3",
          name: "flower-dev",
          version: "1.2.3"
        })
      ]);
      expect(graph.value.embeddedEvidence).toEqual([
        expect.objectContaining({
          packageId: "flower-dev@1.2.3",
          metadataLicense: "Apache-2.0",
          source: "local"
        })
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test("rejects nested uv local sources outside the repository scan root", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-uv-outside-root-"));
    try {
      const repositoryRoot = path.join(temporaryRoot, "repository");
      const datasetsDir = path.join(repositoryRoot, "datasets");
      const outsideDir = path.join(temporaryRoot, "outside");
      mkdirSync(datasetsDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(path.join(outsideDir, "pyproject.toml"), [
        "[project]",
        "name = \"outside\"",
        "version = \"1.0.0\""
      ].join("\n") + "\n");
      const lockfilePath = path.join(datasetsDir, "uv.lock");
      writeFileSync(lockfilePath, [
        "version = 1",
        "revision = 3",
        "",
        "[[package]]",
        "name = \"outside\"",
        "version = \"1.0.0\"",
        "source = { directory = \"../../outside\" }"
      ].join("\n") + "\n");

      const graph = parseProjectDependencyGraph({
        rootDir: repositoryRoot,
        lockfile: { kind: "uv-lock", path: lockfilePath }
      });

      expect(graph.ok).toBe(false);
      if (graph.ok) throw new Error("Expected an outside local source to fail.");
      expect(graph.error.code).toBe("UV_LOCK_PARSE_FAILED");
      expect(graph.error.message).toContain("stay inside the project root");
      expect(graph.error.details).toMatchObject({
        sourcePath: "../../outside"
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("deduplicates by Package URL while preserving the first report identity", () => {
    const merged = mergeDependencyGraphs([
      {
        source: { lockfileKind: "package-lock", lockfilePath: "/workspace/package-lock.json" },
        graph: {
          lockfilePath: "/workspace/package-lock.json",
          nodes: [npmNode({
            id: "shared@1.0.0",
            resolved: "https://registry.example.test/shared-a.tgz",
            integrity: "sha512-first"
          })]
        }
      },
      {
        source: { lockfileKind: "yarn-lock", lockfilePath: "/workspace/yarn.lock" },
        graph: {
          lockfilePath: "/workspace/yarn.lock",
          nodes: [npmNode({
            id: "shared-npm-1.0.0",
            resolved: "https://registry.example.test/shared-b.tgz",
            integrity: "sha512-second",
            dependencyType: "development",
            direct: false,
            paths: [["root", "parent", "shared-npm-1.0.0"]]
          })]
        }
      }
    ]);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      id: "shared@1.0.0",
      name: "shared",
      version: "1.0.0",
      dependencyType: "production",
      direct: true,
      origins: [
        { lockfileKind: "package-lock", lockfilePath: "/workspace/package-lock.json" },
        { lockfileKind: "yarn-lock", lockfilePath: "/workspace/yarn.lock" }
      ]
    });
    expect(merged.nodes[0]?.paths).toContainEqual(["root", "parent", "shared@1.0.0"]);
    expect(merged.warnings).toEqual([
      "Multiple lockfiles resolve pkg:npm/shared@1.0.0 to different artifact locations.",
      "Multiple lockfiles declare different integrity values for pkg:npm/shared@1.0.0."
    ]);
  });
});
