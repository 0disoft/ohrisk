import { describe, expect, test } from "bun:test";

import { parseGemfileLockText } from "../src/graph/ruby-gemfile-lock";

describe("parseGemfileLockText", () => {
  test("parses direct and transitive Ruby gems", () => {
    const result = parseGemfileLockText(
      [
        "GEM",
        "  remote: https://rubygems.org/",
        "  specs:",
        "    rack (3.0.8)",
        "    rails (7.1.0)",
        "      rack (>= 3.0.0)",
        "",
        "PLATFORMS",
        "  ruby",
        "",
        "DEPENDENCIES",
        "  rails",
        "",
        "BUNDLED WITH",
        "   2.5.0"
      ].join("\n"),
      "fixture-ruby/Gemfile.lock"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootName).toBe("fixture-ruby");
    expect(result.value.nodes.map((node) => node.id)).toEqual([
      "rack@3.0.8",
      "rails@7.1.0"
    ]);
    expect(result.value.nodes.find((node) => node.id === "rails@7.1.0"))
      .toMatchObject({
        ecosystem: "gem",
        dependencyType: "production",
        direct: true,
        paths: [["fixture-ruby", "rails@7.1.0"]]
      });
    expect(result.value.nodes.find((node) => node.id === "rack@3.0.8"))
      .toMatchObject({
        ecosystem: "gem",
        dependencyType: "production",
        direct: false,
        paths: [["fixture-ruby", "rails@7.1.0", "rack@3.0.8"]]
      });
  });

  test("reports lockfiles without gem specs as typed errors", () => {
    const result = parseGemfileLockText("DEPENDENCIES\n  rails\n", "Gemfile.lock");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed Gemfile.lock to fail.");
    }

    expect(result.error.code).toBe("GEMFILE_LOCK_PARSE_FAILED");
  });
});
