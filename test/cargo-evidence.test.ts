import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { collectCargoCrateEvidence } from "../src/evidence/cargo-crate";
import { collectCargoPackageEvidence } from "../src/evidence/cargo-package";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import { createTarGz } from "./helpers/tar";

const CARGO_CRATES_IO_SOURCE = "registry+https://github.com/rust-lang/crates.io-index";
const CARGO_CHECKSUM_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const CARGO_CHECKSUM_INTEGRITY = "sha256-AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("collectCargoPackageEvidence", () => {
  test("reads license evidence from local Cargo registry source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license = \"Apache-2.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(crateDir, "LICENSE"),
        "Apache License\nVersion 2.0, January 2004\n",
        "utf8"
      );
      writeCargoChecksum(crateDir, CARGO_CHECKSUM_HEX);

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: CARGO_CRATES_IO_SOURCE,
        integrity: CARGO_CHECKSUM_INTEGRITY
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toMatchObject({
        packageId: "risk-crate@1.0.0",
        metadataLicense: "Apache-2.0",
        metadataSource: "Cargo.toml",
        source: "local"
      });
      expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);

      const normalized = normalizeLicenseEvidence(evidence.value);
      expect(normalized).toMatchObject({
        expression: "Apache-2.0",
        choices: ["Apache-2.0"],
        confidence: "high"
      });
      expect(normalized.evidenceSources).toContain("Cargo.toml license: Apache-2.0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores Cargo license-file paths outside the package directory", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-"));
    const registryRoot = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef"
    );
    const crateDir = path.join(registryRoot, "risk-crate-1.0.0");

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(
        path.join(crateDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\"",
          "license-file = \"../LICENSE\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(registryRoot, "LICENSE"),
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n",
        "utf8"
      );
      writeCargoChecksum(crateDir, CARGO_CHECKSUM_HEX);

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: CARGO_CRATES_IO_SOURCE,
        integrity: CARGO_CHECKSUM_INTEGRITY
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toEqual([]);
      expect(evidence.value.warnings).toContain("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Cargo package source.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("stops collecting Cargo package evidence files at the configured limit", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-evidence-limit-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      for (let index = 0; index < 51; index += 1) {
        const suffix = index.toString().padStart(2, "0");
        writeFileSync(path.join(crateDir, `LICENSE-${suffix}.txt`), `license ${suffix}`, "utf8");
      }
      writeFileSync(path.join(crateDir, "Cargo.toml"), [
        "[package]",
        "name = \"risk-crate\"",
        "version = \"1.0.0\"",
        "license = \"MIT\""
      ].join("\n"), "utf8");
      writeCargoChecksum(crateDir, CARGO_CHECKSUM_HEX);

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: CARGO_CRATES_IO_SOURCE,
        integrity: CARGO_CHECKSUM_INTEGRITY
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value.files).toHaveLength(50);
      expect(evidence.value.warnings).not.toContain(
        "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in Cargo package source."
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reads identity- and checksum-verified crates.io archive evidence", () => {
    const crate = createTarGz({
      "risk-crate-1.0.0/Cargo.toml": [
        "[package]",
        "name = \"risk-crate\"",
        "version = \"1.0.0\"",
        "license = \"Apache-2.0\""
      ].join("\n"),
      "risk-crate-1.0.0/LICENSE": "Apache License\nVersion 2.0, January 2004\n"
    });
    const integrity = `sha256-${createHash("sha256").update(crate).digest("base64")}`;

    const evidence = collectCargoCrateEvidence({
      packageId: "risk-crate@1.0.0",
      packageName: "risk-crate",
      version: "1.0.0",
      integrity,
      crate,
      artifactMaxBytes: 1024 * 1024
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value).toMatchObject({
      packageId: "risk-crate@1.0.0",
      metadataLicense: "Apache-2.0",
      metadataSource: "Cargo.toml",
      source: "tarball",
      warnings: []
    });
    expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
  });

  test("rejects Cargo crate checksum and manifest identity mismatches", () => {
    const crate = createTarGz({
      "risk-crate-1.0.0/Cargo.toml": [
        "[package]",
        "name = \"different-crate\"",
        "version = \"1.0.0\"",
        "license = \"MIT\""
      ].join("\n")
    });

    const checksumMismatch = collectCargoCrateEvidence({
      packageId: "risk-crate@1.0.0",
      packageName: "risk-crate",
      version: "1.0.0",
      integrity: `sha256-${Buffer.alloc(32).toString("base64")}`,
      crate,
      artifactMaxBytes: 1024 * 1024
    });
    expect(checksumMismatch.ok).toBe(false);
    if (!checksumMismatch.ok) {
      expect(checksumMismatch.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
    }

    const identityMismatch = collectCargoCrateEvidence({
      packageId: "risk-crate@1.0.0",
      packageName: "risk-crate",
      version: "1.0.0",
      integrity: `sha256-${createHash("sha256").update(crate).digest("base64")}`,
      crate,
      artifactMaxBytes: 1024 * 1024
    });
    expect(identityMismatch.ok).toBe(false);
    if (!identityMismatch.ok) {
      expect(identityMismatch.error.code).toBe("PACKAGE_EVIDENCE_READ_FAILED");
      expect(identityMismatch.error.details?.reason).toBe("cargo_crate_identity_mismatch");
    }
  });

  test("prioritizes an arbitrarily named nested Cargo license-file", () => {
    const files: Record<string, string> = {
      "risk-crate-1.0.0/Cargo.toml": [
        "[package]",
        "name = \"risk-crate\"",
        "version = \"1.0.0\"",
        "license-file = \"legal/terms.txt\""
      ].join("\n"),
      "risk-crate-1.0.0/legal/terms.txt": "Custom license terms"
    };
    for (let index = 0; index < 51; index += 1) {
      files[`risk-crate-1.0.0/LICENSE-${index.toString().padStart(2, "0")}`] = `license ${index}`;
    }
    const crate = createTarGz(files);

    const evidence = collectCargoCrateEvidence({
      packageId: "risk-crate@1.0.0",
      packageName: "risk-crate",
      version: "1.0.0",
      integrity: `sha256-${createHash("sha256").update(crate).digest("base64")}`,
      crate,
      artifactMaxBytes: 1024 * 1024
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value.files).toHaveLength(50);
    expect(evidence.value.files[0]).toMatchObject({
      path: "legal/terms.txt",
      kind: "license",
      text: "Custom license terms"
    });
  });

  test("does not substitute crates.io cache evidence for another Cargo source", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-source-boundary-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(path.join(crateDir, "Cargo.toml"), [
        "[package]",
        "name = \"risk-crate\"",
        "version = \"1.0.0\"",
        "license = \"MIT\""
      ].join("\n"), "utf8");
      writeCargoChecksum(crateDir, CARGO_CHECKSUM_HEX);

      const evidence = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: "registry+https://packages.example.test/index",
        integrity: CARGO_CHECKSUM_INTEGRITY
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }
      expect(evidence.value.source).toBe("unavailable");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects mismatched local Cargo manifest identity and checksum metadata", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-local-integrity-"));
    const crateDir = path.join(
      projectRoot,
      ".cargo",
      "registry",
      "src",
      "index.crates.io-abcdef",
      "risk-crate-1.0.0"
    );

    try {
      mkdirSync(crateDir, { recursive: true });
      writeFileSync(path.join(crateDir, "Cargo.toml"), [
        "[package]",
        "name = \"different-crate\"",
        "version = \"1.0.0\"",
        "license = \"MIT\""
      ].join("\n"), "utf8");
      writeCargoChecksum(crateDir, CARGO_CHECKSUM_HEX);

      const identityMismatch = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: CARGO_CRATES_IO_SOURCE,
        integrity: CARGO_CHECKSUM_INTEGRITY
      });
      expect(identityMismatch.ok).toBe(true);
      if (!identityMismatch.ok) throw new Error(identityMismatch.error.message);
      expect(identityMismatch.value).toMatchObject({ source: "unavailable" });

      writeFileSync(path.join(crateDir, "Cargo.toml"), [
        "[package]",
        "name = \"risk-crate\"",
        "version = \"1.0.0\"",
        "license = \"MIT\""
      ].join("\n"), "utf8");
      writeCargoChecksum(crateDir, "f".repeat(64));
      const checksumMismatch = collectCargoPackageEvidence({
        packageId: "risk-crate@1.0.0",
        packageName: "risk-crate",
        version: "1.0.0",
        projectRoot,
        resolved: CARGO_CRATES_IO_SOURCE,
        integrity: CARGO_CHECKSUM_INTEGRITY
      });
      expect(checksumMismatch.ok).toBe(true);
      if (!checksumMismatch.ok) throw new Error(checksumMismatch.error.message);
      expect(checksumMismatch.value).toMatchObject({ source: "unavailable" });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function writeCargoChecksum(crateDir: string, packageChecksum: string): void {
  writeFileSync(
    path.join(crateDir, ".cargo-checksum.json"),
    JSON.stringify({ package: packageChecksum, files: {} }),
    "utf8"
  );
}
