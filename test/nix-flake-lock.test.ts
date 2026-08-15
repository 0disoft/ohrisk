import { describe, expect, test } from "bun:test";

import { BOUNDED_PATHS_MAX_PATHS_PER_NODE } from "../src/graph/bounded-dependency-paths";
import { parseNixFlakeLockText } from "../src/graph/nix-flake-lock";
import { buildFindingId } from "../src/policy/finding-id";

describe("parseNixFlakeLockText", () => {
  test("bounds combinatorial path explosion in converging Nix DAGs", () => {
    const result = parseNixFlakeLockText(buildNixDiamondFixture(10), "flake.lock");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const maxPaths = Math.max(...result.value.nodes.map((node) => node.paths.length));
    expect(maxPaths).toBeLessThanOrEqual(BOUNDED_PATHS_MAX_PATHS_PER_NODE);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated"
    }));
  });

  test("keeps descendants reachable after converging path truncation", () => {
    const result = parseNixFlakeLockText(buildNixDiamondFixture(10, true), "flake.lock");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const descendant = result.value.nodes.find((node) => node.id === "github:acme/descendant@eeeeeeeeeeeeeeee");
    expect(descendant).toBeDefined();
    expect(descendant?.paths.length).toBeGreaterThan(0);
  });

  test("summarizes deep Nix chains without losing reachable nodes", () => {
    const result = parseNixFlakeLockText(buildNixChainFixture(512), "flake.lock");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.length).toBe(512);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_path_depth_summarized"
    }));
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBeGreaterThan(0);
    }
  });

  test("keeps graph, paths, and diagnostics stable under input key order changes", () => {
    const forward = parseNixFlakeLockText(buildNixConvergingFixture(false, false), "flake.lock");
    const reversed = parseNixFlakeLockText(buildNixConvergingFixture(true, false), "flake.lock");

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) {
      throw new Error("Fixture parse failed.");
    }

    expect(reversed.value.nodes.map((node) => ({ id: node.id, paths: node.paths })))
      .toEqual(forward.value.nodes.map((node) => ({ id: node.id, paths: node.paths })));
    expect(reversed.value.diagnostics).toEqual(forward.value.diagnostics);
  });

  test("deduplicates duplicated Nix input edges deterministically", () => {
    const plain = parseNixFlakeLockText(buildNixConvergingFixture(false, false), "flake.lock");
    const duplicated = parseNixFlakeLockText(buildNixConvergingFixture(false, true), "flake.lock");

    expect(plain.ok).toBe(true);
    expect(duplicated.ok).toBe(true);
    if (!plain.ok || !duplicated.ok) {
      throw new Error("Fixture parse failed.");
    }

    expect(duplicated.value.nodes.map((node) => ({ id: node.id, paths: node.paths })))
      .toEqual(plain.value.nodes.map((node) => ({ id: node.id, paths: node.paths })));
  });

  test("keeps every reachable node and descendant when a tiny stored-path budget is exhausted", () => {
    const result = parseNixFlakeLockText(
      buildNixDiamondFixture(2, true),
      "flake.lock",
      { limits: { maxTraversalPaths: 1 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const expectedIds = [
      "github:acme/diamond-0@0000000000000000",
      "github:acme/diamond-1@0000000000000001",
      "github:acme/diamond-2@0000000000000002",
      "github:acme/diamond-3@0000000000000003",
      "github:acme/diamond-4@0000000000000004",
      "github:acme/diamond-5@0000000000000005",
      "github:acme/diamond-6@0000000000000006",
      "github:acme/sink@dddddddddddddddd",
      "github:acme/descendant@eeeeeeeeeeeeeeee"
    ].sort();
    expect(result.value.nodes.map((node) => node.id).sort()).toEqual(expectedIds);
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBeGreaterThan(0);
    }
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated",
      limit: 1
    }));
  });

  test("keeps every reachable node and descendant when a tiny segment budget is exhausted", () => {
    const result = parseNixFlakeLockText(
      buildNixDiamondFixture(2, true),
      "flake.lock",
      { limits: { maxStoredPathSegments: 8 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.length).toBe(9);
    for (const node of result.value.nodes) {
      expect(node.paths.length).toBeGreaterThan(0);
    }
    expect(result.value.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });

  test("keeps multi-parent paths up to the per-node cap at the convergence point", () => {
    const result = parseNixFlakeLockText(buildNixDiamondFixture(10), "flake.lock");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const sink = result.value.nodes.find(
      (node) => node.id === "github:acme/sink@dddddddddddddddd"
    );
    expect(sink).toBeDefined();
    expect(sink?.paths.length).toBe(BOUNDED_PATHS_MAX_PATHS_PER_NODE);
    expect(result.value.diagnostics).toContainEqual(expect.objectContaining({
      code: "dependency_paths_truncated"
    }));
  });

  test("keeps multi-parent path union at shallow convergence points", () => {
    const result = parseNixFlakeLockText(buildNixConvergingFixture(false, false), "flake.lock");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const shared = result.value.nodes.find(
      (node) => node.id === "github:acme/shared@cccccccccccccccc"
    );
    expect(shared?.paths).toEqual([
      [".", "mid-a", "shared"],
      [".", "mid-b", "shared"]
    ]);
    expect(result.value.diagnostics ?? []).toEqual([]);
  });

  test("keeps finding IDs stable under input order changes", () => {
    const forward = parseNixFlakeLockText(buildNixConvergingFixture(false, false), "flake.lock");
    const reversed = parseNixFlakeLockText(buildNixConvergingFixture(true, false), "flake.lock");

    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) {
      throw new Error("Fixture parse failed.");
    }

    const findingIds = (result: typeof forward): string[] => result.value.nodes.map((node) =>
      buildFindingId({
        packageId: node.id,
        dependencyType: node.dependencyType,
        dependencyScope: node.direct ? "direct" : "transitive",
        paths: node.paths
      })
    );
    expect(findingIds(reversed)).toEqual(findingIds(forward));
  });

  test("parses reachable Nix flake inputs", () => {
    const result = parseNixFlakeLockText(JSON.stringify({
      version: 7,
      root: "root",
      nodes: {
        root: {
          inputs: {
            nixpkgs: "nixpkgs",
            "flake-utils": "flake-utils"
          }
        },
        nixpkgs: {
          locked: {
            type: "github",
            owner: "NixOS",
            repo: "nixpkgs",
            rev: "0123456789abcdef",
            narHash: "sha256-nixpkgs"
          }
        },
        "flake-utils": {
          inputs: {
            systems: "systems"
          },
          locked: {
            type: "github",
            owner: "numtide",
            repo: "flake-utils",
            rev: "abcdef0123456789",
            narHash: "sha256-utils"
          }
        },
        systems: {
          locked: {
            type: "github",
            owner: "nix-systems",
            repo: "default",
            rev: "1111222233334444",
            narHash: "sha256-systems"
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "github:nix-systems/default@1111222233334444",
        name: "github:nix-systems/default",
        version: "1111222233334444",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: false,
        paths: [[".", "flake-utils", "systems"]]
      },
      {
        id: "github:NixOS/nixpkgs@0123456789abcdef",
        name: "github:NixOS/nixpkgs",
        version: "0123456789abcdef",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "nixpkgs"]]
      },
      {
        id: "github:numtide/flake-utils@abcdef0123456789",
        name: "github:numtide/flake-utils",
        version: "abcdef0123456789",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "flake-utils"]]
      }
    ]);
  });

  test("stops walking dependency cycles without dropping reachable paths", () => {
    const result = parseNixFlakeLockText(JSON.stringify({
      version: 7,
      root: "root",
      nodes: {
        root: {
          inputs: {
            risk: "risk"
          }
        },
        risk: {
          inputs: {
            "cycle-a": "cycle-a"
          },
          locked: {
            type: "github",
            owner: "acme",
            repo: "risk",
            rev: "1111111111111111",
            narHash: "sha256-risk"
          }
        },
        "cycle-a": {
          inputs: {
            "cycle-b": "cycle-b"
          },
          locked: {
            type: "github",
            owner: "acme",
            repo: "cycle-a",
            rev: "2222222222222222",
            narHash: "sha256-cycle-a"
          }
        },
        "cycle-b": {
          inputs: {
            "cycle-a": "cycle-a",
            leaf: "leaf"
          },
          locked: {
            type: "github",
            owner: "acme",
            repo: "cycle-b",
            rev: "3333333333333333",
            narHash: "sha256-cycle-b"
          }
        },
        leaf: {
          locked: {
            type: "github",
            owner: "acme",
            repo: "leaf",
            rev: "4444444444444444",
            narHash: "sha256-leaf"
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes).toEqual([
      {
        id: "github:acme/cycle-a@2222222222222222",
        name: "github:acme/cycle-a",
        version: "2222222222222222",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: false,
        paths: [[".", "risk", "cycle-a"]]
      },
      {
        id: "github:acme/cycle-b@3333333333333333",
        name: "github:acme/cycle-b",
        version: "3333333333333333",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: false,
        paths: [[".", "risk", "cycle-a", "cycle-b"]]
      },
      {
        id: "github:acme/leaf@4444444444444444",
        name: "github:acme/leaf",
        version: "4444444444444444",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: false,
        paths: [[".", "risk", "cycle-a", "cycle-b", "leaf"]]
      },
      {
        id: "github:acme/risk@1111111111111111",
        name: "github:acme/risk",
        version: "1111111111111111",
        ecosystem: "nix",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "risk"]]
      }
    ]);
  });

  test("reports missing nodes as typed errors", () => {
    const result = parseNixFlakeLockText(
      JSON.stringify({
        root: "root",
        nodes: {
          root: {
            inputs: {
              nixpkgs: "nixpkgs"
            }
          }
        }
      }),
      "fixtures/nix/flake.lock"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("NIX_FLAKE_LOCK_PARSE_FAILED");
    expect(result.error.details).toMatchObject({
      lockfilePath: "fixtures/nix/flake.lock",
      reason: "input_target_missing",
      node: "root",
      target: "nixpkgs"
    });
  });
});

function buildNixDiamondFixture(depth: number, includeDescendant = false): string {
  const nodes: Record<string, unknown> = {};
  const levelIds: string[][] = [];
  let counter = 0;

  for (let level = 0; level <= depth; level += 1) {
    const ids: string[] = [];
    for (let index = 0; index < 2 ** level; index += 1) {
      const key = `diamond-${counter}`;
      ids.push(key);
      nodes[key] = {
        locked: {
          type: "github",
          owner: "acme",
          repo: `diamond-${counter}`,
          rev: String(counter).padStart(16, "0"),
          narHash: "sha256-diamond"
        }
      };
      counter += 1;
    }
    levelIds.push(ids);
  }

  const sinkKey = "diamond-sink";
  nodes[sinkKey] = {
    locked: {
      type: "github",
      owner: "acme",
      repo: "sink",
      rev: "dddddddddddddddd",
      narHash: "sha256-sink"
    }
  };
  if (includeDescendant) {
    nodes["diamond-descendant"] = {
      locked: {
        type: "github",
        owner: "acme",
        repo: "descendant",
        rev: "eeeeeeeeeeeeeeee",
        narHash: "sha256-descendant"
      }
    };
  }

  const rootLevel = requiredFixtureItem(levelIds, 0, "root level");
  const rootKey = requiredFixtureItem(rootLevel, 0, "root node");
  nodes.root = { inputs: { [rootKey]: rootKey } };
  for (let level = 0; level < depth; level += 1) {
    const currentLevel = requiredFixtureItem(levelIds, level, `level ${level}`);
    const nextLevel = requiredFixtureItem(levelIds, level + 1, `level ${level + 1}`);
    for (const [index, key] of currentLevel.entries()) {
      (nodes[key] as Record<string, unknown>).inputs = {
        left: requiredFixtureItem(nextLevel, index * 2, `left child at level ${level + 1}`),
        right: requiredFixtureItem(nextLevel, index * 2 + 1, `right child at level ${level + 1}`)
      };
    }
  }
  for (const key of requiredFixtureItem(levelIds, depth, `leaf level ${depth}`)) {
    (nodes[key] as Record<string, unknown>).inputs = {
      ...(includeDescendant ? { child: "diamond-descendant" } : {}),
      sink: sinkKey
    };
  }

  return JSON.stringify({ version: 7, root: "root", nodes });
}

function requiredFixtureItem<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing ${label} in generated Nix fixture.`);
  }
  return item;
}

function buildNixChainFixture(length: number): string {
  const nodes: Record<string, unknown> = { root: { inputs: { "chain-0": "chain-0" } } };
  for (let index = 0; index < length; index += 1) {
    const key = `chain-${index}`;
    nodes[key] = {
      ...(index < length - 1 ? { inputs: { next: `chain-${index + 1}` } } : {}),
      locked: {
        type: "github",
        owner: "acme",
        repo: "chain",
        rev: String(index).padStart(16, "0"),
        narHash: "sha256-chain"
      }
    };
  }

  return JSON.stringify({ version: 7, root: "root", nodes });
}

function buildNixConvergingFixture(reverseOrder: boolean, duplicateEdges: boolean): string {
  const nodes: Record<string, unknown> = {
    root: {
      inputs: {
        "mid-a": "mid-a",
        "mid-b": "mid-b"
      }
    },
    "mid-a": {
      inputs: { shared: "shared" },
      locked: {
        type: "github",
        owner: "acme",
        repo: "mid-a",
        rev: "aaaaaaaaaaaaaaaa",
        narHash: "sha256-mid-a"
      }
    },
    "mid-b": {
      inputs: { shared: "shared" },
      locked: {
        type: "github",
        owner: "acme",
        repo: "mid-b",
        rev: "bbbbbbbbbbbbbbbb",
        narHash: "sha256-mid-b"
      }
    },
    shared: {
      locked: {
        type: "github",
        owner: "acme",
        repo: "shared",
        rev: "cccccccccccccccc",
        narHash: "sha256-shared"
      }
    }
  };

  if (duplicateEdges) {
    (nodes["mid-a"] as Record<string, unknown>).inputs = {
      shared: "shared",
      "shared-again": "shared"
    };
    (nodes["mid-b"] as Record<string, unknown>).inputs = {
      shared: "shared",
      "shared-again": "shared"
    };
  }

  const body = {
    version: 7,
    root: "root",
    nodes
  };
  if (!reverseOrder) {
    return JSON.stringify(body);
  }

  const reversedNodes: Record<string, unknown> = {};
  for (const key of Object.keys(nodes).reverse()) {
    reversedNodes[key] = nodes[key];
  }
  return JSON.stringify({ ...body, nodes: reversedNodes });
}
