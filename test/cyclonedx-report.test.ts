import { describe, expect, test } from "bun:test";

import type { DependencyGraph } from "../src/graph/types";
import { renderCycloneDxReport } from "../src/report/cyclonedx-report";

describe("renderCycloneDxReport", () => {
  test("preserves dependency edges when graph paths contain npm aliases", () => {
    const graph: DependencyGraph = {
      rootName: "fixture-alias-project",
      lockfilePath: "bun.lock",
      nodes: [
        {
          id: "permissive-parent@1.0.0",
          name: "permissive-parent",
          version: "1.0.0",
          ecosystem: "npm",
          installNames: ["compat-parent"],
          dependencyType: "production",
          direct: true,
          paths: [["fixture-alias-project", "compat-parent -> permissive-parent@1.0.0"]]
        },
        {
          id: "agpl-child@0.1.0",
          name: "agpl-child",
          version: "0.1.0",
          ecosystem: "npm",
          installNames: ["compat-child"],
          dependencyType: "production",
          direct: false,
          paths: [[
            "fixture-alias-project",
            "compat-parent -> permissive-parent@1.0.0",
            "compat-child -> agpl-child@0.1.0"
          ]]
        }
      ]
    };

    const payload = JSON.parse(renderCycloneDxReport({
      project: {
        rootDir: "/fixture-alias-project",
        lockfile: {
          kind: "bun",
          path: "/fixture-alias-project/bun.lock"
        }
      },
      graph,
      normalizedLicenses: [],
      riskFindings: [],
      waiverMode: "local",
      repository: {
        owner: "Mbed-TLS",
        name: "mbedtls",
        submodules: {
          mode: "ignore",
          skippedCount: 2,
          skippedPaths: ["framework", "tf-psa-crypto"],
          pathsTruncated: false
        }
      }
    })) as {
      metadata: {
        properties: Array<{
          name: string;
          value: string;
        }>;
      };
      dependencies: Array<{
        ref: string;
        dependsOn: string[];
      }>;
    };

    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:projectRoot",
      value: "."
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:lockfilePath",
      value: "bun.lock"
    });
    expect(payload.metadata.properties).not.toContainEqual({
      name: "ohrisk:projectRoot",
      value: "/fixture-alias-project"
    });
    expect(payload.metadata.properties).not.toContainEqual({
      name: "ohrisk:lockfilePath",
      value: "/fixture-alias-project/bun.lock"
    });
    expect(payload.metadata.properties).toContainEqual({
      name: "ohrisk:skippedSubmodulePaths",
      value: '["framework","tf-psa-crypto"]'
    });

    expect(payload.dependencies).toContainEqual({
      ref: "pkg:npm/permissive-parent@1.0.0",
      dependsOn: ["pkg:npm/agpl-child@0.1.0"]
    });
  });

  test("renders ecosystem-specific Package URLs for non-npm graph adapters", () => {
    const payload = JSON.parse(renderCycloneDxReport({
      project: {
        rootDir: "/fixture-polyglot-project",
        lockfile: {
          kind: "package-lock",
          path: "/fixture-polyglot-project/package-lock.json"
        }
      },
      graph: {
        rootName: "fixture-polyglot-project",
        lockfilePath: "package-lock.json",
        nodes: [
          {
            id: "requests@2.32.3",
            name: "requests",
            version: "2.32.3",
            ecosystem: "pypi",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "requests@2.32.3"]]
          },
          {
            id: "org.example:demo-core@1.0.0",
            name: "org.example:demo-core",
            version: "1.0.0",
            ecosystem: "maven",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "org.example:demo-core@1.0.0"]]
          },
          {
            id: "serde_json@1.0.117",
            name: "serde_json",
            version: "1.0.117",
            ecosystem: "cargo",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "serde_json@1.0.117"]]
          },
          {
            id: "github.com/acme/risk@v1.0.0",
            name: "github.com/acme/risk",
            version: "v1.0.0",
            ecosystem: "go",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "github.com/acme/risk@v1.0.0"]]
          },
          {
            id: "Risk.Package@1.0.0",
            name: "Risk.Package",
            version: "1.0.0",
            ecosystem: "nuget",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "Risk.Package@1.0.0"]]
          },
          {
            id: "risk-gem@1.0.0",
            name: "risk-gem",
            version: "1.0.0",
            ecosystem: "gem",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "risk-gem@1.0.0"]]
          },
          {
            id: "acme/risk@1.0.0",
            name: "acme/risk",
            version: "1.0.0",
            ecosystem: "composer",
            dependencyType: "production",
            direct: true,
            paths: [["fixture-polyglot-project", "acme/risk@1.0.0"]]
          }
        ]
      },
      normalizedLicenses: [],
      riskFindings: [],
      waiverMode: "local"
    })) as {
      components: Array<{
        "bom-ref": string;
        purl: string;
        properties: Array<{
          name: string;
          value: string;
        }>;
      }>;
    };

    expect(payload.components).toEqual([
      expect.objectContaining({
        "bom-ref": "pkg:pypi/requests@2.32.3",
        purl: "pkg:pypi/requests@2.32.3",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "pypi"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:maven/org.example/demo-core@1.0.0",
        purl: "pkg:maven/org.example/demo-core@1.0.0",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "maven"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:cargo/serde_json@1.0.117",
        purl: "pkg:cargo/serde_json@1.0.117",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "cargo"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:golang/github.com/acme/risk@v1.0.0",
        purl: "pkg:golang/github.com/acme/risk@v1.0.0",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "go"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:nuget/Risk.Package@1.0.0",
        purl: "pkg:nuget/Risk.Package@1.0.0",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "nuget"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:gem/risk-gem@1.0.0",
        purl: "pkg:gem/risk-gem@1.0.0",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "gem"
          }
        ])
      }),
      expect.objectContaining({
        "bom-ref": "pkg:composer/acme/risk@1.0.0",
        purl: "pkg:composer/acme/risk@1.0.0",
        properties: expect.arrayContaining([
          {
            name: "ohrisk:ecosystem",
            value: "composer"
          }
        ])
      })
    ]);
  });
});
