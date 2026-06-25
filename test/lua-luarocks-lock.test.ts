import { describe, expect, test } from "bun:test";

import { parseLuarocksLockText } from "../src/graph/lua-luarocks-lock";

describe("parseLuarocksLockText", () => {
  test("parses LuaRocks dependency pins from luarocks.lock", () => {
    const result = parseLuarocksLockText([
      "return {",
      "  dependencies = {",
      '    ["lua-cjson"] = "2.1.0-1",',
      '    lpeg = "1.1.0-2"',
      "  }",
      "}"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("luarocks.lock");
    expect(result.value.nodes).toEqual([
      {
        id: "lpeg@1.1.0-2",
        name: "lpeg",
        version: "1.1.0-2",
        ecosystem: "luarocks",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "lpeg@1.1.0-2"]]
      },
      {
        id: "lua-cjson@2.1.0-1",
        name: "lua-cjson",
        version: "2.1.0-1",
        ecosystem: "luarocks",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "lua-cjson@2.1.0-1"]]
      }
    ]);
  });

  test("reports lockfiles without literal dependency pins as typed errors", () => {
    const result = parseLuarocksLockText("return { dependencies = {} }");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("LUAROCKS_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "luarocks.lock",
      reason: "no_dependencies"
    });
  });

  test("reports non-string dependency entries as unsupported input", () => {
    const result = parseLuarocksLockText([
      "return {",
      "  dependencies = {",
      "    typed_dep = { version = \"1.0.0-1\" },",
      "    optional_dep = true",
      "  }",
      "}"
    ].join("\n"));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("LUAROCKS_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "luarocks.lock",
      reason: "unsupported_luarocks_dependency_entries",
      unsupportedDependencyNames: ["optional_dep", "typed_dep"],
      unsupportedDependencyValueKinds: ["boolean", "table"]
    });
  });
});
