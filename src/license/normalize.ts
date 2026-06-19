import type { LicenseEvidence } from "../evidence/types";
import type { NormalizedLicense, NormalizedLicenseSignal } from "./types";
import { parseSpdxExpression } from "./spdx";

type LicenseExpressionEvidence = {
  expression: string;
  source: "package-metadata" | "license-file";
  filePath?: string;
};

export function normalizeLicenseEvidence(evidence: LicenseEvidence): NormalizedLicense {
  const signals: NormalizedLicenseSignal[] = [];
  const evidenceSources = describeEvidenceSources(evidence);

  if (evidence.files.some((file) => file.kind === "notice")) {
    signals.push("notice-required");
  }

  if (hasExplicitCommercialRestriction(evidence)) {
    signals.push("commercial-restriction");
  }

  let licenseExpression = readLicenseExpressionEvidence(evidence);

  if (!licenseExpression) {
    signals.push("missing");

    if (evidence.files.length > 0) {
      signals.push("custom-text");
    }

    return {
      packageId: evidence.packageId,
      choices: [],
      joiner: "single",
      signals,
      evidenceSources,
      confidence: "low"
    };
  }

  let parsed = parseSpdxExpression(licenseExpression.expression);
  const licenseFileExpression = licenseExpression.source === "package-metadata"
    ? readLicenseFileExpression(evidence)
    : undefined;

  if (parsed.malformed && licenseFileExpression) {
    licenseExpression = licenseFileExpression;
    parsed = parseSpdxExpression(licenseExpression.expression);
  }

  if (licenseExpression.source === "license-file") {
    addLicenseFileMatchSource(evidenceSources, licenseExpression);
  }

  if (parsed.malformed) {
    signals.push("malformed");

    if (evidence.files.length > 0) {
      signals.push("custom-text");
    }

    return {
      packageId: evidence.packageId,
      original: parsed.original,
      ...(parsed.expression ? { expression: parsed.expression } : {}),
      choices: parsed.choices,
      joiner: parsed.joiner,
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
    joiner: parsed.joiner,
    signals,
    evidenceSources,
    confidence: parsed.usedAlias || licenseExpression.source === "license-file" ? "medium" : "high"
  };
}

export function normalizeAllLicenseEvidence(evidence: LicenseEvidence[]): NormalizedLicense[] {
  return evidence.map(normalizeLicenseEvidence);
}

function hasExplicitCommercialRestriction(evidence: LicenseEvidence): boolean {
  return [
    ...collectPackageLicenseTexts(evidence),
    ...evidence.files.map((file) => file.text)
  ].some(hasCommercialRestrictionText);
}

function collectPackageLicenseTexts(evidence: LicenseEvidence): string[] {
  const texts: string[] = [];

  if (evidence.packageJsonLicense) {
    texts.push(evidence.packageJsonLicense);
  }

  const licenseObjectType = readLicenseObjectType(evidence.packageJsonLicenses);
  if (licenseObjectType) {
    texts.push(licenseObjectType);
  }

  if (Array.isArray(evidence.packageJsonLicenses)) {
    for (const item of evidence.packageJsonLicenses) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }

      if (typeof item === "object" && item !== null && "type" in item) {
        const type = (item as { type?: unknown }).type;
        if (typeof type === "string") {
          texts.push(type);
        }
      }
    }
  }

  return texts;
}

function hasCommercialRestrictionText(text: string): boolean {
  return /\bCommons Clause\b/i.test(text)
    || /\bBusiness Source License\b/i.test(text)
    || /\bBUSL\b/i.test(text)
    || /\bServer Side Public License\b/i.test(text)
    || /\bSSPL\b/i.test(text)
    || /\bElastic License\b/i.test(text)
    || /\bPolyForm\b/i.test(text)
    || /\bNon-Commercial\b/i.test(text)
    || /\bnoncommercial\b/i.test(text)
    || /\bnot for commercial use\b/i.test(text)
    || /\bcommercial use\s+(?:is\s+)?(?:prohibited|restricted|not permitted)\b/i.test(text);
}

function readLicenseExpressionEvidence(evidence: LicenseEvidence): LicenseExpressionEvidence | undefined {
  const packageExpression = readPackageLicenseExpression(evidence);
  if (packageExpression) {
    return {
      expression: packageExpression,
      source: "package-metadata"
    };
  }

  return readLicenseFileExpression(evidence);
}

function readPackageLicenseExpression(evidence: LicenseEvidence): string | undefined {
  if (evidence.packageJsonLicense) {
    return evidence.packageJsonLicense;
  }

  const licenseObjectType = readLicenseObjectType(evidence.packageJsonLicenses);
  if (licenseObjectType) {
    return licenseObjectType;
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

function readLicenseFileExpression(evidence: LicenseEvidence): LicenseExpressionEvidence | undefined {
  for (const file of evidence.files) {
    if (file.kind !== "license" && file.kind !== "copying") {
      continue;
    }

    const expression = recognizeStandardLicenseText(file.text);
    if (expression) {
      return {
        expression,
        source: "license-file",
        filePath: file.path
      };
    }
  }

  return undefined;
}

function recognizeStandardLicenseText(text: string): string | undefined {
  const spdxIdentifier = readSpdxLicenseIdentifier(text);
  if (spdxIdentifier) {
    return spdxIdentifier;
  }

  if (/\bGNU AFFERO GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 3\b/i.test(text)) {
    return "AGPL-3.0-only";
  }

  if (/\bGNU LESSER GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 3\b/i.test(text)) {
    return "LGPL-3.0-only";
  }

  if (/\bGNU LESSER GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 2\.1\b/i.test(text)) {
    return "LGPL-2.1-only";
  }

  if (/\bGNU LIBRARY GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 2\b/i.test(text)) {
    return "LGPL-2.0-only";
  }

  if (/\bGNU GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 3\b/i.test(text)) {
    return "GPL-3.0-only";
  }

  if (/\bGNU GENERAL PUBLIC LICENSE\b[\s\S]*\bVersion 2\b/i.test(text)) {
    return "GPL-2.0-only";
  }

  if (/\bMozilla Public License\b[\s\S]*\bVersion 2\.0\b/i.test(text)) {
    return "MPL-2.0";
  }

  if (/\bEclipse Public License\b[\s\S]*\bVersion 2\.0\b/i.test(text)) {
    return "EPL-2.0";
  }

  if (/\bApache License\b[\s\S]*\bVersion 2\.0\b/i.test(text)) {
    return "Apache-2.0";
  }

  if (/\bCreative Commons Legal Code\b[\s\S]*\bCC0 1\.0 Universal\b/i.test(text)) {
    return "CC0-1.0";
  }

  if (/\bfree and unencumbered software released into the public domain\b/i.test(text)) {
    return "Unlicense";
  }

  if (
    /\bPermission is hereby granted, free of charge, to any person obtaining a copy\b/i.test(text)
    && /\bTHE SOFTWARE IS PROVIDED "AS IS"/i.test(text)
  ) {
    return "MIT";
  }

  if (
    /\bPermission to use, copy, modify, and\/or distribute this software\b/i.test(text)
    && /\bTHE SOFTWARE IS PROVIDED "AS IS"/i.test(text)
  ) {
    return "ISC";
  }

  if (
    /\bThis software is provided ['"]as-is['"], without any express or implied warranty\b/i.test(text)
    && /\bPermission is granted to anyone to use this software for any purpose\b/i.test(text)
    && /\bThe origin of this software must not be misrepresented\b/i.test(text)
  ) {
    return "Zlib";
  }

  if (/\bRedistribution and use in source and binary forms\b/i.test(text)) {
    return /\bNeither the name of\b/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  }

  return undefined;
}

function readSpdxLicenseIdentifier(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/\bSPDX-License-Identifier:\s*(.+)$/i);
    const expression = match?.[1] ? cleanSpdxIdentifierExpression(match[1]) : undefined;
    if (expression) {
      return expression;
    }
  }

  return undefined;
}

function cleanSpdxIdentifierExpression(value: string): string {
  return value
    .replace(/\s*\*\/\s*$/, "")
    .replace(/\s*-->\s*$/, "")
    .trim();
}

function addLicenseFileMatchSource(
  evidenceSources: string[],
  licenseExpression: LicenseExpressionEvidence
): void {
  evidenceSources.push(`file license match: ${licenseExpression.expression} from ${licenseExpression.filePath}`);
}

function readLicenseObjectType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) {
    return undefined;
  }

  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
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
