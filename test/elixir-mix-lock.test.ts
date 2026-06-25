import { describe, expect, test } from "bun:test";

import { parseMixLockText } from "../src/graph/elixir-mix-lock";

describe("parseMixLockText", () => {
  test("parses Hex package pins from mix.lock", () => {
    const result = parseMixLockText([
      "%{",
      '  "dep_hex": {:hex, :dep_hex, "2.0.0", "checksum", [:mix], [], "hexpm", "checksum"},',
      '  "risk_hex": {:hex, :risk_hex, "1.0.0", "checksum", [:mix], [{:dep_hex, "~> 2.0", [hex: :dep_hex, repo: "hexpm", optional: false]}], "hexpm", "checksum"}',
      "}"
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.lockfilePath).toBe("mix.lock");
    expect(result.value.nodes).toEqual([
      {
        id: "dep_hex@2.0.0",
        name: "dep_hex",
        version: "2.0.0",
        ecosystem: "hex",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "dep_hex@2.0.0"]]
      },
      {
        id: "risk_hex@1.0.0",
        name: "risk_hex",
        version: "1.0.0",
        ecosystem: "hex",
        dependencyType: "unknown",
        direct: true,
        paths: [[".", "risk_hex@1.0.0"]]
      }
    ]);
  });

  test("reports lockfiles without Hex package entries as typed errors", () => {
    const result = parseMixLockText("%{}");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected parse failure");
    }

    expect(result.error.code).toBe("MIX_LOCK_PARSE_FAILED");
    expect(result.error.details).toEqual({
      lockfilePath: "mix.lock"
    });
  });

  test("uses mix.exs literal only options for root dependency classification", () => {
    const result = parseMixLockText(
      [
        "%{",
        '  "dev_hex": {:hex, :dev_hex, "2.0.0", "checksum", [:mix], [], "hexpm", "checksum"},',
        '  "prod_hex": {:hex, :prod_hex, "1.0.0", "checksum", [:mix], [], "hexpm", "checksum"},',
        '  "unknown_hex": {:hex, :unknown_hex, "3.0.0", "checksum", [:mix], [], "hexpm", "checksum"}',
        "}"
      ].join("\n"),
      "mix.lock",
      {
        mixExsText: [
          "defmodule Risk.MixProject do",
          "  defp deps do",
          "    [",
          '      {:prod_hex, "~> 1.0"},',
          '      {:dev_hex, "~> 2.0", only: [:dev, :test]},',
          '      {:missing_hex, "~> 4.0", only: :test}',
          "    ]",
          "  end",
          "end"
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.map((node) => ({
      id: node.id,
      dependencyType: node.dependencyType
    }))).toEqual([
      {
        id: "dev_hex@2.0.0",
        dependencyType: "development"
      },
      {
        id: "prod_hex@1.0.0",
        dependencyType: "production"
      },
      {
        id: "unknown_hex@3.0.0",
        dependencyType: "unknown"
      }
    ]);
  });
});
