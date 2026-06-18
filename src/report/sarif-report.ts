import { readFileSync } from "node:fs";
import path from "node:path";

import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { ScanReportInput } from "./scan-report";

type SarifRule = {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  defaultConfiguration: {
    level: "error" | "warning" | "note";
  };
  help: {
    text: string;
    markdown: string;
  };
  properties: {
    tags: string[];
    precision: "high" | "medium";
    "problem.severity": "error" | "warning" | "recommendation";
    "security-severity"?: string;
  };
};

const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";

const RULES: SarifRule[] = [
  ruleFor("high", "High license risk", "A dependency has license evidence that is high risk for the selected profile."),
  ruleFor("unknown", "Unknown license evidence", "A dependency has missing, malformed, or unrecognized license evidence."),
  ruleFor("review", "License needs review", "A dependency should be reviewed before shipping under the selected profile."),
  ruleFor("low", "Low license risk", "A dependency has known low-risk license evidence for the selected profile.")
];

const RULE_INDEX_BY_ID = new Map(RULES.map((rule, index) => [rule.id, index]));

export function renderSarifReport(input: ScanReportInput): string {
  const lockfileUri = path.relative(input.project.rootDir, input.project.lockfile.path)
    .replace(/\\/g, "/") || path.basename(input.project.lockfile.path);

  return JSON.stringify(
    {
      $schema: SARIF_SCHEMA_URL,
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Ohrisk",
              semanticVersion: readPackageVersion(),
              informationUri: "https://github.com/0disoft/ohrisk",
              rules: RULES
            }
          },
          runAutomationDetails: {
            id: `ohrisk/${input.profile}${input.prodOnly ? "/prod" : "/all"}`
          },
          invocations: [
            {
              executionSuccessful: true,
              workingDirectory: {
                uri: "./"
              }
            }
          ],
          results: input.riskFindings.map((finding) => resultFor(finding, lockfileUri))
        }
      ]
    },
    null,
    2
  );
}

function ruleFor(severity: RiskSeverity, name: string, description: string): SarifRule {
  const level = sarifLevelFor(severity);
  const rule: SarifRule = {
    id: ruleIdFor(severity),
    name,
    shortDescription: {
      text: name
    },
    fullDescription: {
      text: description
    },
    defaultConfiguration: {
      level
    },
    help: {
      text: `${description} Ohrisk reports profile-specific risk, not a legal safe or unsafe verdict.`,
      markdown: `${description}\n\nOhrisk reports profile-specific risk, not a legal safe or unsafe verdict.`
    },
    properties: {
      tags: ["security", "license", "supply-chain"],
      precision: severity === "unknown" ? "medium" : "high",
      "problem.severity": problemSeverityFor(severity)
    }
  };

  const securitySeverity = securitySeverityFor(severity);
  if (securitySeverity) {
    rule.properties["security-severity"] = securitySeverity;
  }

  return rule;
}

function resultFor(finding: RiskFinding, lockfileUri: string): {
  ruleId: string;
  ruleIndex: number;
  level: "error" | "warning" | "note";
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region: {
        startLine: number;
      };
    };
  }>;
  partialFingerprints: {
    primaryLocationLineHash: string;
  };
  properties: {
    packageId: string;
    recommendation: string;
    paths: string[][];
    evidence: string[];
  };
} {
  const ruleId = ruleIdFor(finding.severity);

  return {
    ruleId,
    ruleIndex: RULE_INDEX_BY_ID.get(ruleId) ?? 0,
    level: sarifLevelFor(finding.severity),
    message: {
      text: `${finding.packageId}: ${finding.reason} Recommendation: ${finding.recommendation}.`
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: lockfileUri
          },
          region: {
            startLine: 1
          }
        }
      }
    ],
    partialFingerprints: {
      primaryLocationLineHash: stableFingerprintFor(finding)
    },
    properties: {
      packageId: finding.packageId,
      recommendation: finding.recommendation,
      paths: finding.paths,
      evidence: finding.evidence
    }
  };
}

function ruleIdFor(severity: RiskSeverity): string {
  return `ohrisk/license-${severity}`;
}

function sarifLevelFor(severity: RiskSeverity): "error" | "warning" | "note" {
  switch (severity) {
    case "high":
      return "error";
    case "unknown":
    case "review":
      return "warning";
    case "low":
      return "note";
  }
}

function problemSeverityFor(severity: RiskSeverity): "error" | "warning" | "recommendation" {
  switch (severity) {
    case "high":
      return "error";
    case "unknown":
    case "review":
      return "warning";
    case "low":
      return "recommendation";
  }
}

function securitySeverityFor(severity: RiskSeverity): string | undefined {
  switch (severity) {
    case "high":
      return "8.0";
    case "unknown":
      return "5.0";
    case "review":
      return "4.0";
    case "low":
      return undefined;
  }
}

function stableFingerprintFor(finding: RiskFinding): string {
  return [
    finding.packageId,
    finding.severity,
    finding.recommendation,
    finding.paths.map((items) => items.join(">")).join("|")
  ].join("::");
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { version?: unknown };

  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}
