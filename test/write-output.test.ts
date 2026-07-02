import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeReportFile } from "../src/report/write-output";

describe("writeReportFile", () => {
  test("writes project-relative report paths", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-"));

    try {
      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":true}"
      });

      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.error.message);
      }

      expect(written.value).toBe(path.join(projectRoot, "reports", "scan.json"));
      expect(readFileSync(written.value, "utf8")).toBe("{\"ok\":true}\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects report output paths that are not project-relative files", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-invalid-"));
    const invalidPaths = [
      "../scan.json",
      "reports/../scan.json",
      "/tmp/scan.json",
      "C:\\tmp\\scan.json",
      "C:tmp\\scan.json",
      "\\\\server\\share\\scan.json"
    ];

    try {
      for (const outputPath of invalidPaths) {
        const written = writeReportFile({
          cwd: projectRoot,
          outputPath,
          contents: "{\"ok\":false}"
        });

        expect(written.ok).toBe(false);
        if (written.ok) {
          throw new Error(`Expected ${outputPath} to be rejected.`);
        }

        expect(written.error.code).toBe("REPORT_OUTPUT_PATH_OUTSIDE_PROJECT");
      }

      expect(existsSync(path.join(projectRoot, "scan.json"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects project-relative report paths that resolve through a symlink outside the project", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-symlink-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-outside-"));
    const linkedReports = path.join(projectRoot, "reports");

    try {
      try {
        symlinkSync(outsideRoot, linkedReports, "junction");
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected symlinked report output path to be rejected.");
      }

      expect(written.error.code).toBe("REPORT_OUTPUT_PATH_OUTSIDE_PROJECT");
      expect(existsSync(path.join(outsideRoot, "scan.json"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("rejects dangling symlink report file paths before writing outside the project", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-dangling-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-dangling-outside-"));
    const reportsDir = path.join(projectRoot, "reports");
    const outsideTarget = path.join(outsideRoot, "scan.json");

    try {
      mkdirSync(reportsDir, { recursive: true });
      try {
        symlinkSync(outsideTarget, path.join(reportsDir, "scan.json"));
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected dangling symlink report output path to be rejected.");
      }

      expect(written.error.code).toBe("REPORT_OUTPUT_PATH_OUTSIDE_PROJECT");
      expect(existsSync(outsideTarget)).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
