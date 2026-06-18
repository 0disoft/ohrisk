import { describe, expect, test } from "bun:test";

import { parseArgs } from "../src/cli/args";

describe("parseArgs", () => {
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
      json: false
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
      json: true
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
      failOn: "review"
    });
  });

  test("rejects unsupported commands", () => {
    const parsed = parseArgs(["diff"]);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected unsupported command to fail.");
    }

    expect(parsed.error.code).toBe("UNSUPPORTED_COMMAND");
  });

  test("parses version command", () => {
    const parsed = parseArgs(["--version"]);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }

    expect(parsed.value).toEqual({
      kind: "version"
    });
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
});
