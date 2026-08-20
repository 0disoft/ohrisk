import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main, type CliIO } from "../src/cli/main";
import { createTarGz } from "./helpers/tar";

describe("archive CLI project discovery", () => {
  test("automatically merges supported lockfiles at one archive project root", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-archive-auto-merge-"));
    const archivePath = path.join(projectRoot, "repository.tar.gz");

    try {
      writeFileSync(archivePath, createTarGz({
        "archive-app/Cargo.toml": [
          "[package]",
          'name = "archive-app"',
          'version = "0.1.0"',
          'edition = "2024"'
        ].join("\n") + "\n",
        "archive-app/Cargo.lock": [
          "version = 3",
          "",
          "[[package]]",
          'name = "archive-app"',
          'version = "0.1.0"'
        ].join("\n") + "\n",
        "archive-app/package.json": JSON.stringify({
          name: "archive-app",
          version: "0.1.0"
        }),
        "archive-app/package-lock.json": JSON.stringify({
          name: "archive-app",
          version: "0.1.0",
          lockfileVersion: 3,
          packages: {
            "": {
              name: "archive-app",
              version: "0.1.0"
            }
          }
        })
      }));

      const stdout: string[] = [];
      const stderr: string[] = [];
      const io: CliIO = {
        cwd: projectRoot,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text)
      };
      const exitCode = await main([
        "scan",
        "--html",
        "--archive",
        archivePath,
        "--offline"
      ], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      const html = stdout.join("\n");
      expect(html.toLowerCase()).toContain("<!doctype html");
      expect(html).toContain("Cargo.lock");
      expect(html).toContain("package-lock.json");
    } finally {
      rmSync(projectRoot, { force: true, recursive: true });
    }
  });
});
