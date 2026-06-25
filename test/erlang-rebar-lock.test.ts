import { describe, expect, test } from "bun:test";

import { parseRebarLockText } from "../src/graph/erlang-rebar-lock";

describe("parseRebarLockText", () => {
  test("parses Hex package pins from rebar.lock with root dependency classification", () => {
    const result = parseRebarLockText([
      '{"1.2.3",',
      "[",
      ' {<<"risk_hex">>,{pkg,<<"risk_hex">>,<<"1.0.0">>},0},',
      ' {dep_hex,{pkg,<<"dep_hex">>,<<"2.0.0">>},1},',
      ' {<<"git_dep">>,{git,"https://example.invalid/git_dep.git",{ref,"abc"}},0}',
      "]}.",
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("rebar.lock");
    expect(result.value.nodes).toEqual([
      {
        id: "dep_hex@2.0.0",
        name: "dep_hex",
        version: "2.0.0",
        ecosystem: "hex",
        dependencyType: "unknown",
        direct: false,
        paths: [[".", "dep_hex@2.0.0"]]
      },
      {
        id: "risk_hex@1.0.0",
        name: "risk_hex",
        version: "1.0.0",
        ecosystem: "hex",
        dependencyType: "production",
        direct: true,
        paths: [[".", "risk_hex@1.0.0"]]
      }
    ]);
  });

  test("reports lockfiles without Hex pkg entries as typed errors", () => {
    const result = parseRebarLockText([
      '{"1.2.3",',
      "[",
      ' {<<"git_dep">>,{git,"https://example.invalid/git_dep.git",{ref,"abc"}},0},',
      ' {path_dep,{path,"../path_dep"},0}',
      "]}.",
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("REBAR_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "rebar.lock",
      reason: "unsupported_rebar_dependency_entries",
      unsupportedDependencyTypes: ["git", "path"],
      unsupportedDependencyNames: ["git_dep", "path_dep"]
    });
  });
});
