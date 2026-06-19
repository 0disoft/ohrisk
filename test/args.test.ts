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

  test("parses supported help targets", () => {
    for (const target of ["scan", "ci", "diff", "explain", "help", "version"]) {
      const parsed = parseArgs(["help", target]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }

      expect(parsed.value).toEqual({
        kind: "help",
        target
      });
    }
  });

  test("parses command help flags as command-specific help", () => {
    for (const [argv, target] of [
      [["scan", "--help"], "scan"],
      [["scan", "-h"], "scan"],
      [["ci", "--help"], "ci"],
      [["diff", "--help"], "diff"],
      [["explain", "--help"], "explain"],
      [["help", "--help"], "help"],
      [["version", "--help"], "version"]
    ] as const) {
      const parsed = parseArgs([...argv]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }

      expect(parsed.value).toEqual({
        kind: "help",
        target
      });
    }
  });

  test("rejects unsupported or extra top-level help arguments", () => {
    const unsupported = parseArgs(["help", "deploy"]);
    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) {
      throw new Error("Expected unsupported help target to fail.");
    }

    expect(unsupported.error.code).toBe("UNSUPPORTED_COMMAND");
    expect(unsupported.error.details?.supportedCommands).toContain("scan");

    const extraTarget = parseArgs(["help", "scan", "extra"]);
    expect(extraTarget.ok).toBe(false);
    if (extraTarget.ok) {
      throw new Error("Expected extra help target argument to fail.");
    }

    expect(extraTarget.error.code).toBe("INVALID_ARGUMENT");
    expect(extraTarget.error.details?.extraArgs).toEqual(["scan", "extra"]);

    const extraFlag = parseArgs(["--help", "scan"]);
    expect(extraFlag.ok).toBe(false);
    if (extraFlag.ok) {
      throw new Error("Expected extra --help argument to fail.");
    }

    expect(extraFlag.error.code).toBe("INVALID_ARGUMENT");
    expect(extraFlag.error.details?.extraArgs).toEqual(["scan"]);
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
      markdown: false,
      cyclonedx: false,
      noWaivers: false
    });
  });

  test("parses scan profile, prod, and json flags", () => {
    const parsed = parseArgs([
      "scan",
      "--lockfile",
      "package-lock.json",
      "--profile",
      "distributed-app",
      "--prod",
      "--json"
    ]);

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
      markdown: false,
      cyclonedx: false,
      noWaivers: false,
      lockfilePath: "package-lock.json"
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
      markdown: false,
      cyclonedx: false,
      noWaivers: false
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
      markdown: true,
      cyclonedx: false,
      noWaivers: false
    });
  });

  test("parses scan CycloneDX output", () => {
    const parsed = parseArgs(["scan", "--cyclonedx"]);

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
      markdown: false,
      cyclonedx: true,
      noWaivers: false
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
      cyclonedx: false,
      noWaivers: false,
      outputPath: "reports/ohrisk.json"
    });
  });

  test("parses scan without local waivers", () => {
    const parsed = parseArgs(["scan", "--no-waivers"]);

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
      markdown: false,
      cyclonedx: false,
      noWaivers: true
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
      cyclonedx: false,
      noWaivers: false,
      failOn: "high",
      strictWaivers: false
    });
  });

  test("parses ci profile, prod, json, fail threshold, and strict waiver checks", () => {
    const parsed = parseArgs([
      "ci",
      "--lockfile",
      "pnpm-lock.yaml",
      "--profile",
      "distributed-app",
      "--prod",
      "--json",
      "--fail-on",
      "review",
      "--strict-waivers"
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
      cyclonedx: false,
      noWaivers: false,
      lockfilePath: "pnpm-lock.yaml",
      failOn: "review",
      strictWaivers: true
    });
  });

  test("parses ci without local waivers", () => {
    const parsed = parseArgs(["ci", "--no-waivers"]);

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
      cyclonedx: false,
      noWaivers: true,
      failOn: "high",
      strictWaivers: false
    });
  });

  test("rejects conflicting scan output formats", () => {
    const parsed = parseArgs(["scan", "--json", "--sarif"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected conflicting output formats to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.details?.supportedOutputOptions).toEqual([
      "--json",
      "--sarif",
      "--markdown",
      "--cyclonedx"
    ]);
  });

  test("rejects conflicting CycloneDX scan output formats", () => {
    const parsed = parseArgs(["scan", "--cyclonedx", "--markdown"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected conflicting CycloneDX output formats to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.details?.supportedOutputOptions).toEqual([
      "--json",
      "--sarif",
      "--markdown",
      "--cyclonedx"
    ]);
  });

  test("rejects conflicting diff output formats without advertising sarif", () => {
    const parsed = parseArgs(["diff", "main", "--json", "--markdown"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected conflicting diff output formats to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.details?.supportedOutputOptions).toEqual(["--json", "--markdown"]);
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
      "--lockfile",
      "bun.lock",
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
      lockfilePath: "bun.lock",
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

  test("rejects option-looking tokens as missing option values", () => {
    const cases = [
      {
        argv: ["scan", "--output", "--json"],
        message: "--output requires a value."
      },
      {
        argv: ["scan", "--lockfile", "--prod"],
        message: "--lockfile requires a value."
      },
      {
        argv: ["scan", "--profile", "--json"],
        message: "--profile requires a value."
      },
      {
        argv: ["ci", "--fail-on", "--json"],
        message: "--fail-on requires a value."
      },
      {
        argv: ["diff", "main", "--output", "--markdown"],
        message: "--output requires a value."
      },
      {
        argv: ["explain", "MIT", "--output", "--json"],
        message: "--output requires a value."
      }
    ];

    for (const testCase of cases) {
      const parsed = parseArgs(testCase.argv);

      expect(parsed.ok).toBe(false);
      if (parsed.ok) {
        throw new Error(`Expected ${testCase.argv.join(" ")} to fail.`);
      }

      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.error.message).toBe(testCase.message);
    }
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

  test("rejects extra version arguments", () => {
    for (const argv of [["--version", "scan"], ["-v", "scan"], ["version", "scan"]]) {
      const parsed = parseArgs(argv);

      expect(parsed.ok).toBe(false);
      if (parsed.ok) {
        throw new Error("Expected extra version argument to fail.");
      }

      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.error.details?.extraArgs).toEqual(["scan"]);
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
    expect(parsed.error.details?.supportedOptions).toContain("--help");
    expect(parsed.error.details?.supportedOptions).toContain("-h");
  });

  test("rejects scan strict waiver checks", () => {
    const parsed = parseArgs(["scan", "--strict-waivers"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected scan strict waiver checks to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.details?.supportedOptions).not.toContain("--strict-waivers");
  });

  test("rejects strict waiver checks when local waivers are disabled", () => {
    const parsed = parseArgs(["ci", "--no-waivers", "--strict-waivers"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected strict waiver checks without waivers to fail.");
    }

    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    expect(parsed.error.message).toContain("--no-waivers cannot be combined with --strict-waivers");
  });

  test("reports help options for unknown diff and explain options", () => {
    for (const argv of [["diff", "main", "--bad"], ["explain", "MIT", "--bad"]]) {
      const parsed = parseArgs(argv);

      expect(parsed.ok).toBe(false);
      if (parsed.ok) {
        throw new Error("Expected unknown option to fail.");
      }

      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.error.details?.supportedOptions).toContain("--help");
      expect(parsed.error.details?.supportedOptions).toContain("-h");
    }
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
