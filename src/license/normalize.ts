import type { LicenseEvidence } from "../evidence/types";
import type { NormalizedLicense, NormalizedLicenseSignal } from "./types";
import { parseSpdxExpression } from "./spdx";

export function normalizeLicenseEvidence(evidence: LicenseEvidence): NormalizedLicense {
  const signals: NormalizedLicenseSignal[] = [];
  const evidenceSources = describeEvidenceSources(evidence);

  if (evidence.files.some((file) => file.kind === "notice")) {
    signals.push("notice-required");
  }

  const licenseExpression = readPackageLicenseExpression(evidence);

  if (!licenseExpression) {
    signals.push("missing");

    if (evidence.files.length > 0) {
      signals.push("custom-text");
    }

    return {
      packageId: evidence.packageId,
      choices: [],
      signals,
      evidenceSources,
      confidence: "low"
    };
  }

  const parsed = parseSpdxExpression(licenseExpression);

  if (parsed.malformed) {
    signals.push("malformed");

    return {
      packageId: evidence.packageId,
      original: parsed.original,
      ...(parsed.expression ? { expression: parsed.expression } : {}),
      choices: parsed.choices,
      signals,
      evidenceSources,
      confidence: "low"
    };
  }

  return {
    packageId: evidence.packageId,
    original: parsed.original,
    ...(parsed.expression ? { expression: parsed.expression } : {}),
    choices: parsed.choices,
    signals,
    evidenceSources,
    confidence: parsed.usedAlias ? "medium" : "high"
  };
}

export function normalizeAllLicenseEvidence(evidence: LicenseEvidence[]): NormalizedLicense[] {
  return evidence.map(normalizeLicenseEvidence);
}

function readPackageLicenseExpression(evidence: LicenseEvidence): string | undefined {
  if (evidence.packageJsonLicense) {
    return evidence.packageJsonLicense;
  }

  if (Array.isArray(evidence.packageJsonLicenses)) {
    const choices = evidence.packageJsonLicenses
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (typeof item === "object" && item !== null && "type" in item) {
          const type = (item as { type?: unknown }).type;
          return typeof type === "string" ? type : undefined;
        }

        return undefined;
      })
      .filter((item): item is string => item !== undefined);

    if (choices.length > 0) {
      return choices.join(" OR ");
    }
  }

  return undefined;
}

function describeEvidenceSources(evidence: LicenseEvidence): string[] {
  const sources = [`source: ${evidence.source}`];

  if (evidence.packageJsonLicense) {
    sources.push(`package.json license: ${evidence.packageJsonLicense}`);
  }

  if (evidence.packageJsonLicenses !== undefined) {
    sources.push("package.json licenses field");
  }

  for (const file of evidence.files) {
    sources.push(`file: ${file.path} (${file.kind})`);
  }

  for (const warning of evidence.warnings) {
    sources.push(`warning: ${warning}`);
  }

  return sources;
}
