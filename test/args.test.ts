import { describe, expect, test } from "bun:test";

import { parseArgs } from "../src/cli/args";

describe("parseArgs", () => {
  test("parses help aliases", () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
      const parsed = parseArgs(argv);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }

      expect(parsed.value).toEqual({
        kind: "help"
      });
    }
  });

  test("parses scan defaults", () => {
    const parsed = parseArgs(["scan"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "scan",
      profile: "saas",
      prodOnly: false,
      json: false,
      sarif: false,
      markdown: false
    });
  });

  test("parses scan profile, prod, and json flags", () => {
    const parsed = parseArgs(["scan", "--profile", "distributed-app", "--prod", "--json"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "scan",
      profile: "distributed-app",
      prodOnly: true,
      json: true,
      sarif: false,
      markdown: false
    });
  });

  test("parses scan sarif output", () => {
    const parsed = parseArgs(["scan", "--sarif"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "scan",
      profile: "saas",
      prodOnly: false,
      json: false,
      sarif: true,
      markdown: false
    });
  });

  test("parses scan markdown output", () => {
    const parsed = parseArgs(["scan", "--markdown"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "scan",
      profile: "saas",
      prodOnly: false,
      json: false,
      sarif: false,
      markdown: true
    });
  });

  test("parses scan output path", () => {
    const parsed = parseArgs(["scan", "--json", "--output", "reports/ohrisk.json"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "scan",
      profile: "saas",
      prodOnly: false,
      json: true,
      sarif: false,
      markdown: false,
      outputPath: "reports/ohrisk.json"
    });
  });

  test("parses ci defaults", () => {
    const parsed = parseArgs(["ci"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "ci",
      profile: "saas",
      prodOnly: false,
      json: false,
      sarif: false,
      markdown: false,
      failOn: "high"
    });
  });

  test("parses ci profile, prod, json, and fail threshold", () => {
    const parsed = parseArgs([
      "ci",
      "--profile",
      "distributed-app",
      "--prod",
      "--json",
      "--fail-on",
      "review"
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "ci",
      profile: "distributed-app",
      prodOnly: true,
      json: true,
      sarif: false,
      markdown: false,
      failOn: "review"
    });
  });

  test("rejects conflicting scan output formats", () => {
    const parsed = parseArgs(["scan", "--json", "--sarif"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected conflicting output formats to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("parses explain expressions and options", () => {
    const parsed = parseArgs([
      "explain",
      "GPL-2.0-only",
      "WITH",
      "Classpath-exception-2.0",
      "--profile",
      "distributed-app",
      "--json"
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "explain",
      expression: "GPL-2.0-only WITH Classpath-exception-2.0",
      profile: "distributed-app",
      json: true
    });
  });

  test("parses diff baseline, profile, prod, json, and fail threshold", () => {
    const parsed = parseArgs([
      "diff",
      "main",
      "--profile",
      "distributed-app",
      "--prod",
      "--json",
      "--fail-on",
      "unknown",
      "--output",
      "reports/diff.json"
    ]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "diff",
      baselineRef: "main",
      profile: "distributed-app",
      prodOnly: true,
      json: true,
      markdown: false,
      outputPath: "reports/diff.json",
      failOn: "unknown"
    });
  });

  test("parses explain output path", () => {
    const parsed = parseArgs(["explain", "MIT", "--output", "reports/explain.txt"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "explain",
      expression: "MIT",
      profile: "saas",
      json: false,
      outputPath: "reports/explain.txt"
    });
  });

  test("rejects output without a value", () => {
    const parsed = parseArgs(["scan", "--output"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected missing output path to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects diff without a baseline ref", () => {
    const parsed = parseArgs(["diff"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected missing diff baseline ref to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects diff with extra baseline refs", () => {
    const parsed = parseArgs(["diff", "main", "HEAD"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected extra diff baseline ref to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects unsupported commands", () => {
    const parsed = parseArgs(["deploy"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected unsupported command to fail.");
    }

    expect(parsed.error.code).toBe("UNSUPPORTED_COMMAND");
  });

  test("parses version aliases", () => {
    for (const argv of [["--version"], ["-v"], ["version"]]) {
      const parsed = parseArgs(argv);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }

      expect(parsed.value).toEqual({
        kind: "version"
      });
    }
  });

  test("rejects unsupported profiles", () => {
    const parsed = parseArgs(["scan", "--profile", "desktop"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected unsupported profile to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects scan fail thresholds", () => {
    const parsed = parseArgs(["scan", "--fail-on", "high"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected scan fail threshold to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects unsupported ci fail thresholds", () => {
    const parsed = parseArgs(["ci", "--fail-on", "critical"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected unsupported fail threshold to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  test("rejects explain without an expression", () => {
    const parsed = parseArgs(["explain", "--profile", "saas"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected missing explain expression to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });
});
