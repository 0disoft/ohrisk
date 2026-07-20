import path from "node:path";

import { OHRISK_VERSION } from "../cli/version";
import type { RiskFinding, RiskSeverity } from "../policy/types";
import type { WaivedRiskFinding } from "../policy/waivers";
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

type SarifResult = {
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
  suppressions?: Array<{
    kind: "external";
    justification: string;
  }>;
  properties: {
    packageId: string;
    reason: string;
    recommendation: string;
    action: string;
    dependencyType: string;
    dependencyScope: string;
    paths: string[][];
    evidence: string[];
    findingId: string;
    fingerprint: string;
    waived?: boolean;
    waiverMatchedBy?: "id" | "fingerprint";
    waiverReason?: string;
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
  const lockfileUri = sarifLockfileUri(input);

  return JSON.stringify(
    {
      $schema: SARIF_SCHEMA_URL,
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Ohrisk",
              semanticVersion: OHRISK_VERSION,
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
          properties: {
            ohriskWaiverMode: input.waiverMode,
            ohriskActiveFindingCount: input.riskFindings.length,
            ohriskWaivedFindingCount: input.waivedFindings.length,
            ohriskExpiredWaiverCount: input.expiredWaivers.length,
            ohriskUnmatchedWaiverCount: input.unmatchedWaivers.length,
            ...(input.repository
              ? {
                  ohriskRepositoryOwner: input.repository.owner,
                  ohriskRepositoryName: input.repository.name,
                  ohriskSubmoduleMode: input.repository.submodules.mode,
                  ohriskSkippedSubmoduleCount: input.repository.submodules.skippedCount,
                  ohriskSkippedSubmodulePaths: input.repository.submodules.skippedPaths,
                  ohriskSubmodulePathsTruncated: input.repository.submodules.pathsTruncated,
                  ohriskSkippedSymbolicLinkCount: input.repository.symbolicLinks.skippedCount,
                  ohriskSkippedSymbolicLinkPaths: input.repository.symbolicLinks.skippedPaths,
                  ohriskSymbolicLinkPathsTruncated: input.repository.symbolicLinks.pathsTruncated,
                  ohriskSkippedNonPortablePathCount: input.repository.nonPortablePaths.skippedCount,
                  ohriskSkippedNonPortablePaths: input.repository.nonPortablePaths.skippedPaths,
                  ohriskNonPortablePathsTruncated: input.repository.nonPortablePaths.pathsTruncated
                }
              : {}),
            ...(input.project.source
              ? {
                  ohriskArchiveName: input.project.source.displayPath,
                  ohriskArchiveFormat: input.project.source.format,
                  ohriskArchiveSha256: input.project.source.sha256,
                  ohriskArchiveRoot: input.project.source.entryRoot
                }
              : {}),
            ...sarifWaiverDriftProperties(input)
          },
          results: [
            ...input.riskFindings.map((finding) => resultFor(finding, lockfileUri)),
            ...input.waivedFindings.map((waived) => suppressedResultFor(waived, lockfileUri))
          ]
        }
      ]
    },
    null,
    2
  );
}

function sarifLockfileUri(input: ScanReportInput): string {
  const relativePath = path.relative(input.project.rootDir, input.project.lockfile.path)
    .replace(/\\/g, "/") || path.basename(input.project.lockfile.path);
  if (!input.project.source) {
    return relativePath;
  }

  const root = input.project.source.entryRoot === "."
    ? ""
    : `${input.project.source.entryRoot}/`;
  return `${input.project.source.displayPath}!/${root}${relativePath}`;
}

function sarifWaiverDriftProperties(input: ScanReportInput):
  | {
      ohriskStrictWaivers: true;
      ohriskWaiverDriftFailed: boolean;
      ohriskWaiverDriftCount: number;
    }
  | Record<string, never> {
  if (!input.strictWaivers) {
    return {};
  }

  const waiverDriftCount = input.expiredWaivers.length + input.unmatchedWaivers.length;
  return {
    ohriskStrictWaivers: true,
    ohriskWaiverDriftFailed: waiverDriftCount > 0,
    ohriskWaiverDriftCount: waiverDriftCount
  };
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

function resultFor(finding: RiskFinding, lockfileUri: string): SarifResult {
  const ruleId = ruleIdFor(finding.severity);

  return {
    ruleId,
    ruleIndex: RULE_INDEX_BY_ID.get(ruleId) ?? 0,
    level: sarifLevelFor(finding.severity),
    message: {
      text: `${finding.packageId}: ${finding.reason} Dependency: ${finding.dependencyType} ${finding.dependencyScope}. Recommendation: ${finding.recommendation}. Action: ${finding.action}`
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
      primaryLocationLineHash: finding.fingerprint
    },
    properties: {
      findingId: finding.id,
      fingerprint: finding.fingerprint,
      packageId: finding.packageId,
      reason: finding.reason,
      recommendation: finding.recommendation,
      action: finding.action,
      dependencyType: finding.dependencyType,
      dependencyScope: finding.dependencyScope,
      paths: finding.paths,
      evidence: finding.evidence
    }
  };
}

function suppressedResultFor(waived: WaivedRiskFinding, lockfileUri: string): SarifResult {
  const result = resultFor(waived.finding, lockfileUri);

  return {
    ...result,
    suppressions: [
      {
        kind: "external",
        justification: waived.waiver.reason
      }
    ],
    properties: {
      ...result.properties,
      waived: true,
      waiverMatchedBy: waived.matchedBy,
      waiverReason: waived.waiver.reason
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
