import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JsonSchemaRegistry,
  type JsonSchema
} from "./support/json-schema-validator";

const temporaryDirectories: string[] = [];
const noticesCli = path.join(import.meta.dir, "..", "bin", "ohrisk-notices.mjs");
const resultSchemaId = "urn:ohrisk:schema:notices-result:1.0.0";
const schemaRegistry = new JsonSchemaRegistry([readSchema("notices-result.schema.json")]);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ohrisk-notices", () => {
  test("generates deterministic deduplicated notices and a schema-valid result", () => {
    const workspace = temporaryDirectory();
    writeFileSync(path.join(workspace, "LICENSE.txt"), "Shared license text\r\n", "utf8");
    writeFileSync(path.join(workspace, "NOTICE.txt"), "Shared notice text\n", "utf8");
    writeJson(path.join(workspace, "sbom.json"), ohriskSbom([
      component("pkg:npm/zeta@2.0.0", "zeta", "2.0.0", "Apache-2.0", "notice-required"),
      component("pkg:npm/alpha@1.0.0", "alpha", "1.0.0", "MIT")
    ]));
    writeJson(path.join(workspace, "evidence.json"), evidence([
      {
        purl: "pkg:npm/zeta@2.0.0",
        licenseFiles: ["LICENSE.txt"],
        noticeFiles: ["NOTICE.txt"]
      },
      {
        purl: "pkg:npm/alpha@1.0.0",
        copyright: ["Copyright Example"],
        licenseFiles: ["LICENSE.txt"]
      }
    ]));

    const first = run(workspace, [
      "--sbom", "sbom.json",
      "--evidence", "evidence.json",
      "--output", "THIRD_PARTY_NOTICES.md",
      "--json"
    ]);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    const result = JSON.parse(first.stdout) as unknown;
    expect(schemaRegistry.validate(resultSchemaId, result)).toEqual([]);
    expect(result).toMatchObject({
      componentCount: 2,
      completeComponentCount: 2,
      incompleteComponentCount: 0,
      evidenceDocumentCount: 2,
      incomplete: false
    });
    const firstNotices = readFileSync(path.join(workspace, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(firstNotices.indexOf("## alpha 1.0.0")).toBeLessThan(firstNotices.indexOf("## zeta 2.0.0"));
    expect(firstNotices.match(/Shared license text/g)).toHaveLength(1);
    expect(firstNotices).toContain("Copyright Example");

    const second = run(workspace, [
      "--sbom", "sbom.json",
      "--evidence", "evidence.json",
      "--output", "THIRD_PARTY_NOTICES.md",
      "--json"
    ]);
    expect(second.status).toBe(0);
    expect(readFileSync(path.join(workspace, "THIRD_PARTY_NOTICES.md"), "utf8")).toBe(firstNotices);
  });

  test("writes an incomplete artifact and fails closed by default", () => {
    const workspace = temporaryDirectory();
    writeJson(path.join(workspace, "sbom.json"), ohriskSbom([
      component("pkg:npm/missing@1.0.0", "missing", "1.0.0", null, "notice-required")
    ]));

    const result = run(workspace, ["--sbom", "sbom.json", "--json"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      incomplete: true,
      incompletePackages: [{
        purl: "pkg:npm/missing@1.0.0",
        missing: ["license-declaration", "license-text", "notice-file"]
      }]
    });
    expect(readFileSync(path.join(workspace, "THIRD_PARTY_NOTICES.md"), "utf8"))
      .toContain("pkg:npm/missing@1.0.0");
  });

  test("requires Ohrisk metadata instead of trusting generic CycloneDX input", () => {
    const workspace = temporaryDirectory();
    writeJson(path.join(workspace, "generic.json"), {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      components: []
    });

    const result = run(workspace, ["--sbom", "generic.json"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a bounded Ohrisk CycloneDX 1.5 report");
  });

  test("rejects stale evidence schemas and duplicate component properties", () => {
    const workspace = temporaryDirectory();
    writeJson(path.join(workspace, "sbom.json"), ohriskSbom([
      {
        ...component("pkg:npm/example@1.0.0", "example", "1.0.0", "MIT"),
        properties: [
          { name: "ohrisk:ecosystem", value: "npm" },
          { name: "ohrisk:ecosystem", value: "cargo" },
          { name: "ohrisk:dependencyType", value: "production" },
          { name: "ohrisk:direct", value: "true" }
        ]
      }
    ]));
    writeJson(path.join(workspace, "evidence.json"), {
      $schema: "urn:ohrisk:schema:notices-evidence:1.0.0",
      packages: []
    });

    const duplicate = run(workspace, ["--sbom", "sbom.json"]);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain("duplicate CycloneDX property ohrisk:ecosystem");

    writeJson(path.join(workspace, "sbom.json"), ohriskSbom([]));
    const stale = run(workspace, ["--sbom", "sbom.json", "--evidence", "evidence.json"]);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain("not an Ohrisk notices evidence manifest");
  });

  test("keeps backticks and Markdown table delimiters inert", () => {
    const workspace = temporaryDirectory();
    const purl = "pkg:npm/example`code@1.0.0";
    writeFileSync(path.join(workspace, "LICENSE.txt"), "License text\n", "utf8");
    writeJson(path.join(workspace, "sbom.json"), ohriskSbom([
      component(purl, "example\\|injected", "1.0.0", "LicenseRef-`custom`")
    ]));
    writeJson(path.join(workspace, "evidence.json"), evidence([
      { purl, licenseFiles: ["LICENSE.txt"] }
    ]));

    const result = run(workspace, ["--sbom", "sbom.json", "--evidence", "evidence.json"]);

    expect(result.status).toBe(0);
    const notices = readFileSync(path.join(workspace, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain("example\\\\\\|injected");
    expect(notices).toContain("``pkg:npm/example`code@1.0.0``");
    expect(notices).toContain("`` LicenseRef-`custom` ``");
  });
});

function ohriskSbom(components: unknown[]): Record<string, unknown> {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: { type: "application", name: "fixture", "bom-ref": "project" },
      properties: [
        { name: "ohrisk:projectRoot", value: "." },
        { name: "ohrisk:lockfileKind", value: "package-lock" },
        { name: "ohrisk:lockfilePath", value: "package-lock.json" },
        { name: "ohrisk:waiverMode", value: "local" }
      ]
    },
    components,
    dependencies: []
  };
}

function component(
  purl: string,
  name: string,
  version: string,
  license: string | null,
  signals = ""
): Record<string, unknown> {
  return {
    type: "library",
    "bom-ref": purl,
    name,
    version,
    purl,
    scope: "required",
    ...(license === null ? {} : { licenses: [{ expression: license }] }),
    properties: [
      { name: "ohrisk:ecosystem", value: "npm" },
      { name: "ohrisk:dependencyType", value: "production" },
      { name: "ohrisk:direct", value: "true" },
      { name: "ohrisk:licenseSignals", value: signals }
    ]
  };
}

function evidence(packages: unknown[]): Record<string, unknown> {
  return {
    $schema: "urn:ohrisk:schema:notices-evidence:1.0.0",
    schemaVersion: "1.0.0",
    packages
  };
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ohrisk-notices-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function readSchema(filename: string): JsonSchema {
  return JSON.parse(
    readFileSync(path.join(import.meta.dir, "..", "schemas", filename), "utf8")
  ) as JsonSchema;
}

function run(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [noticesCli, ...args], {
    cwd,
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
