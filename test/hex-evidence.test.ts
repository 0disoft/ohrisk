import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectHexPackageEvidence } from "../src/evidence/hex-package";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("collectHexPackageEvidence", () => {
  test("reads license evidence from a local Hex dependency source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-hex-evidence-"));
    tempRoots.push(projectRoot);

    const packageDir = path.join(projectRoot, "deps", "risk_hex");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "mix.exs"),
      [
        "defmodule RiskHex.MixProject do",
        "  use Mix.Project",
        "  def project do",
        "    [app: :risk_hex, version: \"1.0.0\", package: [licenses: [\"AGPL-3.0-only\"]]]",
        "  end",
        "end"
      ].join("\n"),
      "utf8"
    );

    const evidence = collectHexPackageEvidence({
      packageId: "risk_hex@1.0.0",
      packageName: "risk_hex",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk_hex@1.0.0",
      source: "local",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "mix.exs"
    });
  });

  test("reads license metadata from a local Rebar3 dependency source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-hex-evidence-"));
    tempRoots.push(projectRoot);

    const packageDir = path.join(projectRoot, "deps", "risk_hex");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "rebar.config"),
      [
        "{erl_opts, [debug_info]}.",
        "{licenses, [\"AGPL-3.0-only\"]}."
      ].join("\n"),
      "utf8"
    );

    const evidence = collectHexPackageEvidence({
      packageId: "risk_hex@1.0.0",
      packageName: "risk_hex",
      projectRoot
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toMatchObject({
      packageId: "risk_hex@1.0.0",
      source: "local",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "rebar.config"
    });
  });
});
