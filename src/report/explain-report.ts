import type { NormalizedLicense } from "../license/types";
import type { RiskFinding } from "../policy/types";
import type { UsageProfile } from "../policy/profiles";

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
        status: "license_explained",
        expression: input.expression,
        profile: input.profile,
        license: input.normalizedLicense,
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
    `Reason: ${input.finding.reason}`,
    `Normalized: ${formatNormalizedExpression(input.normalizedLicense)}`,
    `Signals: ${input.normalizedLicense.signals.length > 0 ? input.normalizedLicense.signals.join(", ") : "none"}`,
    "",
    "Note: Ohrisk reports profile-specific risk, not a legal safe or unsafe verdict."
  ].join("\n");
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
