import type { NormalizedLicense } from "../license/types";
import type { RiskFinding } from "../policy/types";
import type { UsageProfile } from "../policy/profiles";
import {
  OHRISK_EXPLAIN_REPORT_SCHEMA,
  OHRISK_REPORT_SCHEMA_VERSION
} from "./schema";

export type ExplainReportInput = {
  expression: string;
  profile: UsageProfile;
  normalizedLicense: NormalizedLicense;
  finding: RiskFinding;
  json: boolean;
};

export function renderExplainReport(input: ExplainReportInput): string {
  if (input.json) {
    return JSON.stringify(
      {
        $schema: OHRISK_EXPLAIN_REPORT_SCHEMA,
        schemaVersion: OHRISK_REPORT_SCHEMA_VERSION,
        status: "license_explained",
        expression: input.expression,
        profile: input.profile,
        license: serializableNormalizedLicense(input.normalizedLicense),
        finding: input.finding
      },
      null,
      2
    );
  }

  return [
    "Ohrisk explain",
    `Expression: ${input.expression}`,
    `Profile: ${input.profile}`,
    `Severity: ${input.finding.severity}`,
    `Recommendation: ${input.finding.recommendation}`,
    `Action: ${input.finding.action}`,
    `Reason: ${input.finding.reason}`,
    `Normalized: ${formatNormalizedExpression(input.normalizedLicense)}`,
    `Signals: ${input.normalizedLicense.signals.length > 0 ? input.normalizedLicense.signals.join(", ") : "none"}`,
    "",
    "Note: Ohrisk reports profile-specific risk, not a legal safe or unsafe verdict."
  ].join("\n");
}

function serializableNormalizedLicense(license: NormalizedLicense): Omit<NormalizedLicense, "spdxAst"> {
  return {
    packageId: license.packageId,
    ...(license.original !== undefined ? { original: license.original } : {}),
    ...(license.expression !== undefined ? { expression: license.expression } : {}),
    choices: license.choices,
    joiner: license.joiner,
    signals: license.signals,
    evidenceSources: license.evidenceSources,
    confidence: license.confidence,
    ...(license.exceptions !== undefined ? { exceptions: license.exceptions } : {})
  };
}

function formatNormalizedExpression(license: NormalizedLicense): string {
  if (license.expression) {
    return license.expression;
  }

  if (license.choices.length > 0) {
    return license.choices.join(` ${license.joiner.toUpperCase()} `);
  }

  return "unknown";
}
