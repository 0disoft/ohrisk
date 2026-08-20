import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readNpmPackResult } from "./npm-pack-output";

const repoRoot = path.join(import.meta.dir, "..");
const packageMetadata = readPackageMetadata(repoRoot);
const expectedVersion = packageMetadata.version;
const workspace = mkdtempSync(path.join(tmpdir(), "ohrisk-package-smoke-"));

try {
  const packDir = path.join(workspace, "pack");
  const consumerDir = path.join(workspace, "consumer");

  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const packStdout = run(
    "npm",
    ["pack", "--silent", "--json", "--pack-destination", packDir],
    repoRoot
  );

  const packOutput = readNpmPackResult(packStdout, packageMetadata.name);
  const filename = packOutput?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not return a package filename.");
  }

  const tarballPath = path.join(packDir, filename).replaceAll("\\", "/");
  writeFileSync(
    path.join(consumerDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          ohrisk: `file:${tarballPath}`
        }
      },
      null,
      2
    ),
    "utf8"
  );

  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], consumerDir);
  assertPublishedModuleSurface(consumerDir, repoRoot);
  const consumerBinDir = path.join(consumerDir, "node_modules", ".bin");

  const smokeOutput = runWithPath("ohrisk", ["version"], consumerDir, consumerBinDir).trim();
  const expectedOutput = `ohrisk ${expectedVersion}`;

  if (smokeOutput !== expectedOutput) {
    throw new Error(
      `Packaged CLI smoke test expected "${expectedOutput}" but received "${smokeOutput}".`
    );
  }

  const scanOutput = runWithPath("ohrisk", ["scan", "--json"], consumerDir, consumerBinDir);
  const scanReport = readJsonObject(scanOutput);
  if (scanReport.status !== "profile_risk_evaluated") {
    throw new Error(
      `Packaged CLI scan smoke test expected status "profile_risk_evaluated" but received "${String(scanReport.status)}".`
    );
  }

  const archiveName = "source.tar";
  writeFileSync(
    path.join(consumerDir, archiveName),
    createTar({
      "package.json": JSON.stringify({
        name: "packaged-archive-smoke",
        version: "1.0.0"
      })
    })
  );
  const archiveOutput = runWithPath(
    "ohrisk",
    ["scan", "--archive", archiveName, "--offline", "--json"],
    consumerDir,
    consumerBinDir
  );
  assertArchiveScanReport(readJsonObject(archiveOutput), archiveName);

  const sarifOutput = runWithPath("ohrisk", ["scan", "--sarif"], consumerDir, consumerBinDir);
  assertSarifReport(readJsonObject(sarifOutput), expectedVersion);

  const cyclonedxOutput = runWithPath(
    "ohrisk",
    ["scan", "--cyclonedx"],
    consumerDir,
    consumerBinDir
  );
  assertCycloneDxReport(readJsonObject(cyclonedxOutput));

  const markdownOutput = runWithPath(
    "ohrisk",
    ["scan", "--markdown"],
    consumerDir,
    consumerBinDir
  );
  assertMarkdownReport(markdownOutput);
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

function assertPublishedModuleSurface(consumerDir: string, repoRoot: string): void {
  const schemaSmokePath = path.join(consumerDir, "schema-smoke.mjs");
  writeFileSync(
    schemaSmokePath,
    [
      'import commonSchema from "ohrisk/schemas/common" with { type: "json" };',
      'import scanSchema from "ohrisk/schemas/scan-report" with { type: "json" };',
      'import diffSchema from "ohrisk/schemas/diff-report" with { type: "json" };',
      'import explainSchema from "ohrisk/schemas/explain-report" with { type: "json" };',
      'import waiverSchema from "ohrisk/schemas/waiver-file" with { type: "json" };',
      'import explicitScanSchema from "ohrisk/schemas/scan-report.schema.json" with { type: "json" };',
      "",
      "const expected = new Map([",
      '  [commonSchema.$id, "urn:ohrisk:schema:common:3.5.0"],',
      '  [scanSchema.$id, "urn:ohrisk:schema:scan-report:3.5.0"],',
      '  [diffSchema.$id, "urn:ohrisk:schema:diff-report:3.5.0"],',
      '  [explainSchema.$id, "urn:ohrisk:schema:explain-report:3.5.0"],',
      '  [waiverSchema.$id, "urn:ohrisk:schema:waiver-file:1.0.0"],',
      '  [explicitScanSchema.$id, "urn:ohrisk:schema:scan-report:3.5.0"]',
      "]);",
      "",
      "for (const [actual, wanted] of expected) {",
      "  if (actual !== wanted) {",
      "    throw new Error(`Expected schema ${wanted} but received ${String(actual)}.`);",
      "  }",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  run("node", [schemaSmokePath], consumerDir);

  const typeSmokePath = path.join(consumerDir, "report-types-smoke.ts");
  writeFileSync(
    typeSmokePath,
    [
      "import type {",
      "  DiffReport,",
      "  ExplainReport,",
      "  Finding,",
      "  ReportSchemaVersion,",
      "  ScanReport,",
      "  WaiverFile,",
      "  WaiverFileSchemaId",
      '} from "ohrisk/report-types";',
      'import scanSchema from "ohrisk/schemas/scan-report" with { type: "json" };',
      'import diffSchema from "ohrisk/schemas/diff-report" with { type: "json" };',
      "",
      "declare const scanReport: ScanReport;",
      "declare const diffReport: DiffReport;",
      "declare const explainReport: ExplainReport;",
      "const finding: Finding | undefined = scanReport.findings[0];",
      "const introduced: Finding[] = diffReport.findings;",
      "const explained: Finding = explainReport.finding;",
      'const schemaVersion: ReportSchemaVersion = "3.5.0";',
      'const waiverSchemaId: WaiverFileSchemaId = "urn:ohrisk:schema:waiver-file:1.0.0";',
      "const waiverFile: WaiverFile = { waivers: [] };",
      "void [",
      "  finding,",
      "  introduced,",
      "  explained,",
      "  schemaVersion,",
      "  waiverSchemaId,",
      "  waiverFile,",
      "  scanSchema,",
      "  diffSchema",
      "];",
      ""
    ].join("\n"),
    "utf8"
  );

  const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  run(
    "node",
    [
      tscPath,
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--skipLibCheck",
      "false",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--resolveJsonModule",
      typeSmokePath
    ],
    consumerDir
  );
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout ?? "";
}

function runWithPath(command: string, args: string[], cwd: string, binDir: string): string {
  const pathKey = pathEnvironmentKey();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ""}`
    }
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `cwd: ${cwd}`,
        `exit: ${result.status}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout ?? "";
}

function pathEnvironmentKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function readPackageMetadata(rootDir: string): { name: string; version: string } {
  const packageJson = readJsonObject(readFileSync(path.join(rootDir, "package.json"), "utf8"));

  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json must contain string name and version fields.");
  }

  return { name: packageJson.name, version: packageJson.version };
}

function readJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error("Expected a JSON object.");
  }

  return parsed;
}

function assertSarifReport(report: Record<string, unknown>, expectedVersion: string): void {
  if (report.version !== "2.1.0") {
    throw new Error(
      `Packaged CLI SARIF smoke test expected SARIF version "2.1.0" but received "${String(report.version)}".`
    );
  }

  const runs = report.runs;
  if (!Array.isArray(runs) || !isJsonObject(runs[0])) {
    throw new Error("Packaged CLI SARIF smoke test expected at least one run.");
  }

  const tool = runs[0].tool;
  const driver = isJsonObject(tool) && isJsonObject(tool.driver) ? tool.driver : undefined;
  if (!driver || driver.semanticVersion !== expectedVersion) {
    throw new Error(
      `Packaged CLI SARIF smoke test expected semanticVersion "${expectedVersion}" but received "${String(driver?.semanticVersion)}".`
    );
  }
}

function assertCycloneDxReport(report: Record<string, unknown>): void {
  if (report.bomFormat !== "CycloneDX") {
    throw new Error(
      `Packaged CLI CycloneDX smoke test expected bomFormat "CycloneDX" but received "${String(report.bomFormat)}".`
    );
  }

  if (report.specVersion !== "1.5") {
    throw new Error(
      `Packaged CLI CycloneDX smoke test expected specVersion "1.5" but received "${String(report.specVersion)}".`
    );
  }
}

function assertMarkdownReport(report: string): void {
  if (!report.includes("# Ohrisk scan")) {
    throw new Error("Packaged CLI Markdown smoke test expected an Ohrisk scan heading.");
  }

  if (!report.includes("- Risks:")) {
    throw new Error("Packaged CLI Markdown smoke test expected the risk summary.");
  }

  if (!report.includes("## Next")) {
    throw new Error("Packaged CLI Markdown smoke test expected the next-action section.");
  }
}

function assertArchiveScanReport(report: Record<string, unknown>, archiveName: string): void {
  const archive = isJsonObject(report.archive) ? report.archive : undefined;
  const lockfile = isJsonObject(report.lockfile) ? report.lockfile : undefined;
  if (
    archive?.name !== archiveName
    || archive.format !== "tar"
    || archive.root !== "."
    || typeof archive.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(archive.sha256)
  ) {
    throw new Error("Packaged CLI archive smoke test returned invalid archive provenance.");
  }
  if (
    lockfile?.kind !== "package-json"
    || lockfile.path !== `${archiveName}!/package.json`
  ) {
    throw new Error("Packaged CLI archive smoke test returned invalid lockfile provenance.");
  }
}

function createTar(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [filePath, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const header = Buffer.alloc(512);
    header.write(filePath, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(" ", 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    chunks.push(
      header,
      data,
      Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length)
    );
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
