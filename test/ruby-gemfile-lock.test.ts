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

  test("uses literal Gemfile group blocks for development dependency classification", () => {
    const result = parseGemfileLockText(
      [
        "GEM",
        "  remote: https://rubygems.org/",
        "  specs:",
        "    debug-tool (1.0.0)",
        "      rack (>= 3.0.0)",
        "    rack (3.0.8)",
        "    rails (7.1.0)",
        "",
        "PLATFORMS",
        "  ruby",
        "",
        "DEPENDENCIES",
        "  debug-tool",
        "  rails",
        "",
        "BUNDLED WITH",
        "   2.5.0"
      ].join("\n"),
      "fixture-ruby/Gemfile.lock",
      {
        gemfileText: [
          "source 'https://rubygems.org'",
          "",
          "gem 'rails'",
          "",
          "group :development, :test do",
          "  gem 'debug-tool'",
          "end"
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "rails@7.1.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "debug-tool@1.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "rack@3.0.8"))
      .toMatchObject({
        dependencyType: "development",
        direct: false,
        paths: [["fixture-ruby", "debug-tool@1.0.0", "rack@3.0.8"]]
      });
  });

  test("keeps Gemfile group classification across nested Ruby blocks", () => {
    const result = parseGemfileLockText(
      [
        "GEM",
        "  remote: https://rubygems.org/",
        "  specs:",
        "    debug-after-block (1.0.0)",
        "    debug-inside-block (1.0.0)",
        "",
        "PLATFORMS",
        "  ruby",
        "",
        "DEPENDENCIES",
        "  debug-after-block",
        "  debug-inside-block",
        "",
        "BUNDLED WITH",
        "   2.5.0"
      ].join("\n"),
      "fixture-ruby/Gemfile.lock",
      {
        gemfileText: [
          "group :development do",
          "  platforms :ruby do",
          "    gem 'debug-inside-block'",
          "  end",
          "  gem 'debug-after-block'",
          "end"
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "debug-inside-block@1.0.0"))
      .toMatchObject({ dependencyType: "development" });
    expect(result.value.nodes.find((node) => node.id === "debug-after-block@1.0.0"))
      .toMatchObject({ dependencyType: "development" });
  });

  test("uses literal Gemfile inline group options for development dependency classification", () => {
    const result = parseGemfileLockText(
      [
        "GEM",
        "  remote: https://rubygems.org/",
        "  specs:",
        "    debug-inline (1.0.0)",
        "      rack (>= 3.0.0)",
        "    debug-string-group (1.0.0)",
        "    rack (3.0.8)",
        "    rails (7.1.0)",
        "",
        "PLATFORMS",
        "  ruby",
        "",
        "DEPENDENCIES",
        "  debug-inline",
        "  debug-string-group",
        "  rails",
        "",
        "BUNDLED WITH",
        "   2.5.0"
      ].join("\n"),
      "fixture-ruby/Gemfile.lock",
      {
        gemfileText: [
          "gem 'rails'",
          "gem 'debug-inline', group: [:development, :test]",
          "gem 'debug-string-group', groups: 'test'"
        ].join("\n")
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.nodes.find((node) => node.id === "rails@7.1.0"))
      .toMatchObject({
        dependencyType: "production",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "debug-inline@1.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "debug-string-group@1.0.0"))
      .toMatchObject({
        dependencyType: "development",
        direct: true
      });
    expect(result.value.nodes.find((node) => node.id === "rack@3.0.8"))
      .toMatchObject({
        dependencyType: "development",
        direct: false,
        paths: [["fixture-ruby", "debug-inline@1.0.0", "rack@3.0.8"]]
      });
  });
});
