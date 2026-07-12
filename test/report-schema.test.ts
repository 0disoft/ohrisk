import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NormalizedLicense } from "../src/license/types";
import type { PolicyConfigSummary } from "../src/policy/config";
import type { RiskFinding } from "../src/policy/types";
import { renderDiffReport } from "../src/report/diff-report";
import { renderExplainReport } from "../src/report/explain-report";
import {
  OHRISK_COMMON_REPORT_SCHEMA,
  OHRISK_DIFF_REPORT_SCHEMA,
  OHRISK_EXPLAIN_REPORT_SCHEMA,
  OHRISK_REPORT_SCHEMA_VERSION,
  OHRISK_SCAN_REPORT_SCHEMA
} from "../src/report/schema";
import { renderScanReport } from "../src/report/scan-report";
import {
  JsonSchemaRegistry,
  type JsonSchema
} from "./support/json-schema-validator";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaCases = [
  ["common.schema.json", OHRISK_COMMON_REPORT_SCHEMA],
  ["scan-report.schema.json", OHRISK_SCAN_REPORT_SCHEMA],
  ["diff-report.schema.json", OHRISK_DIFF_REPORT_SCHEMA],
  ["explain-report.schema.json", OHRISK_EXPLAIN_REPORT_SCHEMA]
] as const;
const schemas = schemaCases.map(([filename]) => readSchema(filename));
const schemaRegistry = new JsonSchemaRegistry(schemas);

const finding: RiskFinding = {
  id: "OHRISK-example",
  fingerprint: "example-fingerprint",
  packageId: "example@1.0.0",
  severity: "high",
  reason: "The selected license requires review for this profile.",
  action: "Replace this package or escalate before shipping.",
  dependencyType: "production",
  dependencyScope: "direct",
  evidence: ["license: AGPL-3.0-only", "source: local"],
  paths: [["schema-project", "example@1.0.0"]],
  recommendation: "replace"
};

const policy: PolicyConfigSummary = {
  enabled: true,
  sourceFiles: [".ohrisk.yml"],
  allowLicenseCount: 1,
  denyLicenseCount: 1,
  severityOverrideCount: 1,
  packageRuleCount: 1,
  profileCount: 1,
  profileOverrideCount: 1,
  allowedRegistryHostCount: 1,
  registryAuthHostCount: 1,
  npmRegistryUrl: "https://packages.example.com/npm"
};

describe("machine-readable report schemas", () => {
  test("keeps every packaged schema identifier aligned with runtime constants", () => {
    schemaRegistry.assertSupportedKeywords();

    for (const [[, identifier], schema] of schemaCases.map((entry, index) => [
      entry,
      schemas[index]
    ] as const)) {
      expect(schema).not.toBeBoolean();
      if (typeof schema === "boolean") {
        throw new Error("Expected an object JSON Schema.");
      }
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toBe(identifier);

      if (identifier === OHRISK_COMMON_REPORT_SCHEMA) {
        continue;
      }
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      expect(properties.$schema?.const).toBe(identifier);
      expect(properties.schemaVersion?.const).toBe(OHRISK_REPORT_SCHEMA_VERSION);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  test("validates complete scan, diff, and explain output documents", () => {
    const scan = renderCompleteScanReport();
    const diff = renderCompleteDiffReport();
    const explain = renderCompleteExplainReport();

    expectValid(OHRISK_SCAN_REPORT_SCHEMA, scan);
    expectValid(OHRISK_DIFF_REPORT_SCHEMA, diff);
    expectValid(OHRISK_EXPLAIN_REPORT_SCHEMA, explain);

    expect(scan.dependencyOrigins).toEqual([{
      packageId: "example@1.0.0",
      purl: "pkg:npm/example@1.0.0",
      origins: [{ kind: "package-lock", path: "nested/package-lock.json" }]
    }]);
    expect(JSON.stringify(scan)).not.toContain(scan.projectRootPathForTest);
    expect(explain.license).not.toHaveProperty("spdxAst");
    expect(explain.license).not.toHaveProperty("debug");
  });

  test("rejects malformed finding, policy, lockfile, threshold, and waiver payloads", () => {
    const scan = renderCompleteScanReport();
    const mutations: unknown[] = [
      { ...scan, unexpected: true },
      { ...scan, findings: [123] },
      { ...scan, findings: [{ ...finding, reason: undefined }] },
      { ...scan, findings: [{ ...finding, legalVerdict: "safe" }] },
      { ...scan, findings: [{ ...finding, severity: "critical" }] },
      { ...scan, lockfile: { kind: "package-lock", path: "/absolute/package-lock.json" } },
      { ...scan, policy: { ...policy, token: "must-not-exist" } },
      withoutProperty(scan, "failed"),
      {
        ...scan,
        expiredWaivers: [{ reason: "No target is invalid." }]
      }
    ];

    for (const mutation of mutations) {
      expectInvalid(OHRISK_SCAN_REPORT_SCHEMA, mutation);
    }
  });

  test("rejects incomplete diff internals and explain objects", () => {
    const diff = renderCompleteDiffReport();
    expectInvalid(OHRISK_DIFF_REPORT_SCHEMA, {
      ...diff,
      lockfileChanges: { ...diff.lockfileChanges, added: [7] }
    });
    expectInvalid(OHRISK_DIFF_REPORT_SCHEMA, {
      ...diff,
      newRisks: { high: 1, review: 0, unknown: 0 }
    });

    const explain = renderCompleteExplainReport();
    expectInvalid(OHRISK_EXPLAIN_REPORT_SCHEMA, {
      ...explain,
      license: {}
    });
    expectInvalid(OHRISK_EXPLAIN_REPORT_SCHEMA, {
      ...explain,
      finding: { ...finding, paths: [] }
    });
  });
});

function renderCompleteScanReport(): Record<string, any> {
  const projectRoot = path.join(repositoryRoot, "test", "fixtures", "schema-project");
  const lockfilePath = path.join(projectRoot, "nested", "package-lock.json");
  const secondaryLockfilePath = path.join(projectRoot, "Cargo.lock");
  const payload = JSON.parse(renderScanReport({
    project: {
      rootDir: projectRoot,
      lockfile: { kind: "package-lock", path: lockfilePath },
      lockfiles: [
        { kind: "package-lock", path: lockfilePath },
        { kind: "cargo-lock", path: secondaryLockfilePath }
      ]
    },
    graph: {
      rootName: "schema-project",
      lockfilePath,
      lockfilePaths: [lockfilePath, secondaryLockfilePath],
      nodes: [{
        id: "example@1.0.0",
        name: "example",
        version: "1.0.0",
        ecosystem: "npm",
        dependencyType: "production",
        direct: true,
        paths: [["schema-project", "example@1.0.0"]],
        origins: [{
          lockfileKind: "package-lock",
          lockfilePath
        }]
      }]
    },
    evidence: [{
      packageId: "example@1.0.0",
      packageJsonLicense: "AGPL-3.0-only",
      files: [{ path: "LICENSE", kind: "license", text: "license text" }],
      source: "local",
      warnings: []
    }],
    normalizedLicenses: [{
      packageId: "example@1.0.0",
      original: "AGPL-3.0-only",
      expression: "AGPL-3.0-only",
      choices: ["AGPL-3.0-only"],
      joiner: "single",
      signals: [],
      evidenceSources: ["package.json license: AGPL-3.0-only"],
      confidence: "high"
    }],
    riskFindings: [finding],
    profile: "saas",
    prodOnly: true,
    json: true,
    markdown: false,
    html: false,
    waiverMode: "local",
    failOn: "review",
    strictWaivers: true,
    waivedFindings: [{
      finding: { ...finding, id: "OHRISK-waived", fingerprint: "waived-fingerprint" },
      waiver: { id: "OHRISK-waived", reason: "Temporary migration." },
      matchedBy: "id"
    }],
    expiredWaivers: [{
      fingerprint: "expired-fingerprint",
      reason: "Migration window ended.",
      expiresOn: "2026-01-31"
    }],
    unmatchedWaivers: [{
      id: "OHRISK-missing",
      reason: "Dependency was removed."
    }],
    policy
  })) as Record<string, any>;

  Object.defineProperty(payload, "projectRootPathForTest", {
    value: projectRoot,
    enumerable: false
  });
  return payload;
}

function renderCompleteDiffReport(): Record<string, any> {
  return JSON.parse(renderDiffReport({
    baselineRef: "origin/main",
    profile: "distributed-app",
    prodOnly: true,
    lockfileChanges: {
      current: [
        { kind: "package-lock", path: "package-lock.json" },
        { kind: "cargo-lock", path: "Cargo.lock" }
      ],
      baseline: [
        { kind: "package-lock", path: "package-lock.json" },
        { kind: "yarn-lock", path: "yarn.lock" }
      ],
      added: [{ kind: "cargo-lock", path: "Cargo.lock" }],
      removed: [{ kind: "yarn-lock", path: "yarn.lock" }]
    },
    diff: {
      baselineFindings: [],
      currentFindings: [finding],
      newFindings: [finding]
    },
    json: true,
    markdown: false,
    failOn: "high",
    policy
  })) as Record<string, any>;
}

function renderCompleteExplainReport(): Record<string, any> {
  const normalizedLicense = {
    packageId: "input",
    original: "GPL-2.0-only WITH Classpath-exception-2.0",
    expression: "GPL-2.0-only WITH Classpath-exception-2.0",
    choices: ["GPL-2.0-only"],
    joiner: "single",
    signals: [],
    evidenceSources: ["package metadata"],
    confidence: "high",
    exceptions: ["Classpath-exception-2.0"],
    spdxAst: {
      type: "license",
      license: "GPL-2.0-only",
      exception: "Classpath-exception-2.0"
    },
    debug: "internal-only"
  } satisfies NormalizedLicense & { debug: string };

  return JSON.parse(renderExplainReport({
    expression: normalizedLicense.original,
    profile: "saas",
    normalizedLicense,
    finding,
    json: true
  })) as Record<string, any>;
}

function readSchema(filename: string): JsonSchema {
  return JSON.parse(
    readFileSync(path.join(repositoryRoot, "schemas", filename), "utf8")
  ) as JsonSchema;
}

function expectValid(identifier: string, value: unknown): void {
  const errors = schemaRegistry.validate(identifier, value);
  expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
}

function expectInvalid(identifier: string, value: unknown): void {
  const errors = schemaRegistry.validate(identifier, value);
  expect(errors.length).toBeGreaterThan(0);
}

function withoutProperty(
  value: Record<string, any>,
  property: string
): Record<string, any> {
  const copy = structuredClone(value);
  delete copy[property];
  return copy;
}
