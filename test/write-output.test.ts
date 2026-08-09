import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
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

  test("replaces existing regular report files", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-replace-"));
    const reportsDir = path.join(projectRoot, "reports");
    const reportPath = path.join(reportsDir, "scan.json");

    try {
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(reportPath, "{\"old\":true}\n", "utf8");

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":true}"
      });

      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.error.message);
      }

      expect(readFileSync(reportPath, "utf8")).toBe("{\"ok\":true}\n");
      expect(listReportTempFiles(reportsDir)).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("cleans temporary report files when final replacement fails", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-cleanup-"));
    const reportsDir = path.join(projectRoot, "reports");

    try {
      mkdirSync(path.join(reportsDir, "scan.json"), { recursive: true });

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected directory output path replacement to fail.");
      }

      expect(written.error.code).toBe("REPORT_WRITE_FAILED");
      expect(listReportTempFiles(reportsDir)).toEqual([]);
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

  test("rejects nested output through an outside symlink before creating intermediate directories", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-symlink-tail-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-outside-tail-"));
    const linkedReports = path.join(projectRoot, "reports");
    const expectedSideEffect = path.join(outsideRoot, "created-before-reject");

    try {
      try {
        symlinkSync(outsideRoot, linkedReports, "junction");
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/created-before-reject/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected symlinked report output path to be rejected.");
      }

      expect(written.error.code).toBe("REPORT_OUTPUT_PATH_OUTSIDE_PROJECT");
      expect(existsSync(expectedSideEffect)).toBe(false);
      expect(readdirSync(outsideRoot)).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("rejects output through a middle symlink component pointing outside the project", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-middle-symlink-"));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-middle-outside-"));
    const outDir = path.join(projectRoot, "out");
    const expectedSideEffect = path.join(outsideRoot, "created-before-reject");

    try {
      mkdirSync(outDir, { recursive: true });
      try {
        symlinkSync(outsideRoot, path.join(outDir, "reports"), "junction");
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "out/reports/created-before-reject/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected symlinked report output path to be rejected.");
      }

      expect(written.error.code).toBe("REPORT_OUTPUT_PATH_OUTSIDE_PROJECT");
      expect(existsSync(expectedSideEffect)).toBe(false);
      expect(readdirSync(outsideRoot)).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("allows parent symlinks that resolve inside the project", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-inside-link-"));
    const realReports = path.join(projectRoot, "generated", "reports");

    try {
      mkdirSync(realReports, { recursive: true });
      try {
        symlinkSync(realReports, path.join(projectRoot, "reports"), "junction");
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":true}"
      });

      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.error.message);
      }

      expect(readFileSync(path.join(realReports, "scan.json"), "utf8")).toBe("{\"ok\":true}\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("creates missing intermediate directories through an inside-project parent symlink", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-inside-link-tail-"));
    const generatedDir = path.join(projectRoot, "generated");

    try {
      mkdirSync(generatedDir, { recursive: true });
      try {
        symlinkSync(generatedDir, path.join(projectRoot, "reports"), "junction");
      } catch {
        return;
      }

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/deep/nested/scan.json",
        contents: "{\"ok\":true}"
      });

      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.error.message);
      }

      expect(readFileSync(path.join(generatedDir, "deep", "nested", "scan.json"), "utf8")).toBe(
        "{\"ok\":true}\n"
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects output paths whose parent component is a regular file without side effects", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-file-parent-"));

    try {
      writeFileSync(path.join(projectRoot, "reports"), "not a directory\n", "utf8");

      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/scan.json",
        contents: "{\"ok\":false}"
      });

      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("Expected file-as-parent report output path to be rejected.");
      }

      expect(written.error.code).toBe("REPORT_WRITE_FAILED");
      expect(existsSync(path.join(projectRoot, "reports", "scan.json"))).toBe(false);
      expect(readFileSync(path.join(projectRoot, "reports"), "utf8")).toBe("not a directory\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("writes nested project-relative report paths with missing intermediate directories", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-write-report-deep-nested-"));

    try {
      const written = writeReportFile({
        cwd: projectRoot,
        outputPath: "reports/deep/nested/scan.json",
        contents: "{\"ok\":true}"
      });

      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.error.message);
      }

      const reportPath = path.join(projectRoot, "reports", "deep", "nested", "scan.json");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf8")).toBe("{\"ok\":true}\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
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

function listReportTempFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath).filter((entry) => entry.startsWith(".ohrisk-report-"));
}
