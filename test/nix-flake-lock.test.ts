import { describe, expect, test } from "bun:test";

import { parseNixFlakeLockText } from "../src/graph/nix-flake-lock";

describe("parseNixFlakeLockText", () => {
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
