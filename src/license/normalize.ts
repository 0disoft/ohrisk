import type { LicenseEvidence } from "../evidence/types";
import type { NormalizedLicense, NormalizedLicenseSignal } from "./types";
import { spdxExceptionIdStatus, spdxLicenseIdStatus } from "./spdx-catalog";
import { isSpdxLicenseReference, parseSpdxExpression } from "./spdx";

type LicenseExpressionEvidence = {
  expression: string;
  source: "package-metadata" | "license-file";
  filePath?: string;
  fileScope?: "component";
};

type NonPackageRestrictionScope = "documentation" | "data";

type CommercialRestrictionAnalysis = {
  packageRestricted: boolean;
  nonPackageScopes: Array<{
    path: string;
    scope: NonPackageRestrictionScope;
  }>;
};

const DEPRECATED_GNU_LICENSE_EQUIVALENTS = new Map([
  ["AGPL-1.0", "AGPL-1.0-only"],
  ["AGPL-1.0+", "AGPL-1.0-or-later"],
  ["AGPL-3.0", "AGPL-3.0-only"],
  ["AGPL-3.0+", "AGPL-3.0-or-later"],
  ["GFDL-1.1", "GFDL-1.1-only"],
  ["GFDL-1.1+", "GFDL-1.1-or-later"],
  ["GFDL-1.2", "GFDL-1.2-only"],
  ["GFDL-1.2+", "GFDL-1.2-or-later"],
  ["GFDL-1.3", "GFDL-1.3-only"],
  ["GFDL-1.3+", "GFDL-1.3-or-later"],
  ["GPL-1.0", "GPL-1.0-only"],
  ["GPL-1.0+", "GPL-1.0-or-later"],
  ["GPL-2.0", "GPL-2.0-only"],
  ["GPL-2.0+", "GPL-2.0-or-later"],
  ["GPL-3.0", "GPL-3.0-only"],
  ["GPL-3.0+", "GPL-3.0-or-later"],
  ["LGPL-2.0", "LGPL-2.0-only"],
  ["LGPL-2.0+", "LGPL-2.0-or-later"],
  ["LGPL-2.1", "LGPL-2.1-only"],
  ["LGPL-2.1+", "LGPL-2.1-or-later"],
  ["LGPL-3.0", "LGPL-3.0-only"],
  ["LGPL-3.0+", "LGPL-3.0-or-later"]
]);

export function normalizeLicenseEvidence(evidence: LicenseEvidence): NormalizedLicense {
  const signals: NormalizedLicenseSignal[] = [];
  const evidenceSources = describeEvidenceSources(evidence);
  const licenseFileExpressions = readLicenseFileExpressions(evidence);
  const packageLicenseFileExpressions = licenseFileExpressions.filter(
    (match) => match.fileScope !== "component"
  );
  const componentLicenseFileExpressions = licenseFileExpressions.filter(
    (match) => match.fileScope === "component"
  );
  const distinctLicenseFileExpressions = new Set(
    packageLicenseFileExpressions.map((match) => match.expression)
  );
  const packageLicenseExpression = readPackageLicenseExpression(evidence);

  if (
    distinctLicenseFileExpressions.size > 1
    && (!packageLicenseExpression || evidence.metadataLicenseKind === "classifier")
  ) {
    if (!signals.includes("conflicting-evidence")) {
      signals.push("conflicting-evidence");
    }
    evidenceSources.push(
      `conflicting file license matches: ${packageLicenseFileExpressions
        .map((match) => `${match.expression} from ${match.filePath}`)
        .join("; ")}`
    );
  }

  const conflictingLicenseClaims = evidence.conflictingLicenseClaims ?? [];
  if (conflictingLicenseClaims.length > 0) {
    if (!signals.includes("conflicting-evidence")) {
      signals.push("conflicting-evidence");
    }
    evidenceSources.push(`conflicting license claims: ${conflictingLicenseClaims.join("; ")}`);
  }

  if (evidence.files.some((file) => file.kind === "notice")) {
    signals.push("notice-required");
  }

  const commercialRestriction = analyzeCommercialRestrictions(evidence);
  if (commercialRestriction.packageRestricted) {
    signals.push("commercial-restriction");
  }
  addNonPackageRestrictionSources(evidenceSources, commercialRestriction);

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

    return withSpdxAst({
      packageId: evidence.packageId,
      original: parsed.original,
      ...(parsed.expression ? { expression: parsed.expression } : {}),
      choices: parsed.choices,
      joiner: parsed.joiner,
      ...(parsed.exceptions.length > 0 ? { exceptions: parsed.exceptions } : {}),
      signals,
      evidenceSources,
      confidence: "low"
    }, parsed.ast);
  }

  if (parsed.choices.some(isSpdxLicenseReference) && !signals.includes("custom-text")) {
    signals.push("custom-text");
  }

  if (licenseExpression.source === "package-metadata") {
    const declaredChoices = new Set(parsed.choices.map(comparableLicenseId));
    const conflictingFileMatches = packageLicenseFileExpressions.filter((match) => {
      const fileExpression = parseSpdxExpression(match.expression);
      return !fileExpression.malformed
        && fileExpression.choices.some((choice) => !declaredChoices.has(comparableLicenseId(choice)));
    });

    if (conflictingFileMatches.length > 0) {
      if (!signals.includes("conflicting-evidence")) {
        signals.push("conflicting-evidence");
      }
      evidenceSources.push(
        `conflicting metadata and file license matches: metadata ${parsed.expression}; ${conflictingFileMatches
          .map((match) => `${match.expression} from ${match.filePath}`)
          .join("; ")}`
      );
    }
  }

  parsed = appendBundledComponentLicenses({
    parsed,
    matches: componentLicenseFileExpressions,
    evidenceSources
  });

  const deprecatedLicenseIds = parsed.choices.filter(
    (choice) => spdxLicenseIdStatus(choice) === "deprecated"
  );
  const deprecatedExceptionIds = parsed.exceptions.filter(
    (exception) => spdxExceptionIdStatus(exception) === "deprecated"
  );

  for (const licenseId of deprecatedLicenseIds) {
    evidenceSources.push(`deprecated SPDX license identifier: ${licenseId}`);
  }

  for (const exceptionId of deprecatedExceptionIds) {
    evidenceSources.push(`deprecated SPDX exception identifier: ${exceptionId}`);
  }

  const usesDeprecatedSpdx = deprecatedLicenseIds.length > 0 || deprecatedExceptionIds.length > 0;

  return withSpdxAst({
    packageId: evidence.packageId,
    original: parsed.original,
    ...(parsed.expression ? { expression: parsed.expression } : {}),
    choices: parsed.choices,
    joiner: parsed.joiner,
    ...(parsed.exceptions.length > 0 ? { exceptions: parsed.exceptions } : {}),
    signals,
    evidenceSources,
    confidence: signals.includes("conflicting-evidence") || signals.includes("custom-text")
      ? "low"
      : usesDeprecatedSpdx
        || parsed.usedAlias
        || licenseExpression.source === "license-file"
        || evidence.metadataLicenseKind === "classifier"
        || evidence.packageJsonLicenses !== undefined
        ? "medium"
        : "high"
  }, parsed.ast);
}

function comparableLicenseId(licenseId: string): string {
  return DEPRECATED_GNU_LICENSE_EQUIVALENTS.get(licenseId) ?? licenseId;
}

function withSpdxAst(
  license: NormalizedLicense,
  ast: NormalizedLicense["spdxAst"]
): NormalizedLicense {
  if (!ast) {
    return license;
  }

  Object.defineProperty(license, "spdxAst", {
    value: ast,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return license;
}

export function normalizeAllLicenseEvidence(evidence: LicenseEvidence[]): NormalizedLicense[] {
  return evidence.map(normalizeLicenseEvidence);
}

function analyzeCommercialRestrictions(evidence: LicenseEvidence): CommercialRestrictionAnalysis {
  const nonPackageScopes = new Map<string, CommercialRestrictionAnalysis["nonPackageScopes"][number]>();
  let packageRestricted = collectPackageLicenseTexts(evidence).some(hasCommercialRestrictionText);

  for (const file of evidence.files) {
    for (const statement of commercialRestrictionStatements(file.text)) {
      if (!hasCommercialRestrictionText(statement)) {
        continue;
      }

      const scopes = restrictionScopes(statement);
      const explicitlyNonPackage = isExplicitlyNonPackageRestriction(statement, scopes);
      if (!explicitlyNonPackage) {
        packageRestricted = true;
      }

      if (scopes.documentation && explicitlyNonPackage) {
        const key = `documentation:${file.path}`;
        nonPackageScopes.set(key, { path: file.path, scope: "documentation" });
      }

      if (scopes.data && explicitlyNonPackage) {
        const key = `data:${file.path}`;
        nonPackageScopes.set(key, { path: file.path, scope: "data" });
      }
    }
  }

  return {
    packageRestricted,
    nonPackageScopes: [...nonPackageScopes.values()]
  };
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

  if (evidence.metadataLicense) {
    texts.push(evidence.metadataLicense);
  }

  if (evidence.sbomDeclaredLicense) {
    texts.push(evidence.sbomDeclaredLicense);
  }

  if (evidence.sbomConcludedLicense) {
    texts.push(evidence.sbomConcludedLicense);
  }

  const metadataLicenseObjectType = readLicenseObjectType(evidence.metadataLicenses);
  if (metadataLicenseObjectType) {
    texts.push(metadataLicenseObjectType);
  }

  if (Array.isArray(evidence.metadataLicenses)) {
    for (const item of evidence.metadataLicenses) {
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

const COMMERCIAL_RESTRICTION_LICENSE_NAME_PATTERNS = [
  /\bCommons Clause\b/i,
  /\bBusiness Source License\b/i,
  /\bBUSL\b/i,
  /\bServer Side Public License\b/i,
  /\bSSPL\b/i,
  /\bElastic License\b/i,
  /\bPolyForm\b/i,
  /\bCreative Commons\b[^\r\n]*(?:NonCommercial|Non-Commercial|\bNC\b)/i,
  /\bCC-BY-NC(?:-[0-9.]+)?\b/i,
  /\bNon-Commercial\b(?=\s+(?:License|Software|Use|Only)\b)/i,
  /\bnoncommercial\b(?=\s+(?:License|Software|Use|Only)\b)/i
];

const COMMERCIAL_USE_DENIAL_PATTERNS = [
  /\bnot for commercial use\b/i,
  /\bno commercial use\b/i,
  /\bcommercial use\s+(?:is\s+)?(?:prohibited|restricted|not permitted|forbidden|disallowed)\b/i,
  /\bmay not be used for commercial purposes\b/i,
  /\bmust not be used for commercial purposes\b/i,
  /\bshall not be used for commercial purposes\b/i,
  /\bcannot be used for commercial purposes\b/i
];

const PACKAGE_RESTRICTION_SCOPE_PATTERN =
  /\b(?:software|source\s+code|codebase|package|library|program|application|module|toolkit)\b/i;
const DOCUMENTATION_RESTRICTION_SCOPE_PATTERN =
  /\b(?:documentation|docs?|manuals?|tutorials?)\b/i;
const DATA_RESTRICTION_SCOPE_PATTERN =
  /\b(?:corpora?|corpus|datasets?|data[ -]?sets?|training\s+data|test\s+data|model\s+weights?)\b/i;

function hasCommercialRestrictionText(text: string): boolean {
  return COMMERCIAL_RESTRICTION_LICENSE_NAME_PATTERNS.some((pattern) => pattern.test(text))
    || COMMERCIAL_USE_DENIAL_PATTERNS.some((pattern) => pattern.test(text));
}

function commercialRestrictionStatements(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}|\n(?=\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+))/u)
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
}

function restrictionScopes(statement: string): {
  package: boolean;
  documentation: boolean;
  data: boolean;
} {
  return {
    package: PACKAGE_RESTRICTION_SCOPE_PATTERN.test(statement),
    documentation: DOCUMENTATION_RESTRICTION_SCOPE_PATTERN.test(statement),
    data: DATA_RESTRICTION_SCOPE_PATTERN.test(statement)
  };
}

function isExplicitlyNonPackageRestriction(
  statement: string,
  scopes: ReturnType<typeof restrictionScopes>
): boolean {
  if (scopes.package || (!scopes.documentation && !scopes.data)) {
    return false;
  }

  const scopedSubject = statement.match(NON_PACKAGE_RESTRICTION_SUBJECT_PATTERN);
  if (scopedSubject) {
    const remainder = statement.slice(scopedSubject[0].length);
    return !/^\s*(?:,|(?:and|or)\b)/iu.test(remainder);
  }

  const scopedObject = statement.match(NON_PACKAGE_RESTRICTION_OBJECT_PATTERN);
  if (!scopedObject) {
    return false;
  }

  const remainder = statement.slice((scopedObject.index ?? 0) + scopedObject[0].length);
  return !/^\s*(?:,|(?:and|or)\b)/iu.test(remainder);
}

const NON_PACKAGE_RESTRICTION_SUBJECT_PATTERN =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:the\s+)?(?:(?!(?:and|or)\b)[\w@./-]+\s+){0,3}(?:documentation|docs?|manuals?|tutorials?|corpora?|corpus|datasets?|data[ -]?sets?|training\s+data|test\s+data|model\s+weights?)\b/iu;
const NON_PACKAGE_RESTRICTION_OBJECT_PATTERN =
  /\bcommercial\s+use\s+(?:of|for)\s+(?:the\s+)?(?:documentation|docs?|manuals?|tutorials?|corpora?|corpus|datasets?|data[ -]?sets?|training\s+data|test\s+data|model\s+weights?)\b/iu;

function addNonPackageRestrictionSources(
  evidenceSources: string[],
  analysis: CommercialRestrictionAnalysis
): void {
  for (const item of analysis.nonPackageScopes) {
    evidenceSources.push(`restriction scope: ${item.scope} in ${item.path}`);
  }
}

function readLicenseExpressionEvidence(evidence: LicenseEvidence): LicenseExpressionEvidence | undefined {
  const packageExpression = readPackageLicenseExpression(evidence);
  if (packageExpression) {
    const licenseFileExpression = evidence.metadataLicenseKind === "classifier"
      && packageExpression === evidence.metadataLicense
      ? readLicenseFileExpression(evidence)
      : undefined;
    if (
      licenseFileExpression
      && parseSpdxExpression(licenseFileExpression.expression).expression
        !== parseSpdxExpression(packageExpression).expression
    ) {
      return licenseFileExpression;
    }

    return {
      expression: packageExpression,
      source: "package-metadata"
    };
  }

  return readLicenseFileExpression(evidence);
}

function readPackageLicenseExpression(evidence: LicenseEvidence): string | undefined {
  if (evidence.packageJsonLicense && !isAbsentLicenseExpression(evidence.packageJsonLicense)) {
    return evidence.packageJsonLicense;
  }

  const licenseObjectType = readLicenseObjectType(evidence.packageJsonLicenses);
  if (licenseObjectType && !isAbsentLicenseExpression(licenseObjectType)) {
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
      .filter((item): item is string => item !== undefined && !isAbsentLicenseExpression(item));

    if (choices.length > 0) {
      return choices.join(" OR ");
    }
  }

  if (evidence.metadataLicense && !isAbsentLicenseExpression(evidence.metadataLicense)) {
    return evidence.metadataLicense;
  }

  const metadataLicenseObjectType = readLicenseObjectType(evidence.metadataLicenses);
  if (metadataLicenseObjectType && !isAbsentLicenseExpression(metadataLicenseObjectType)) {
    return metadataLicenseObjectType;
  }

  if (Array.isArray(evidence.metadataLicenses)) {
    const choices = evidence.metadataLicenses
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
      .filter((item): item is string => item !== undefined && !isAbsentLicenseExpression(item));

    if (choices.length > 0) {
      return choices.join(" OR ");
    }
  }

  return undefined;
}

function isAbsentLicenseExpression(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "NOASSERTION" || normalized === "NONE";
}

function readLicenseFileExpression(evidence: LicenseEvidence): LicenseExpressionEvidence | undefined {
  const matches = readLicenseFileExpressions(evidence).filter(
    (match) => match.fileScope !== "component"
  );
  if (new Set(matches.map((match) => match.expression)).size !== 1) {
    return undefined;
  }

  return matches[0];
}

function readLicenseFileExpressions(evidence: LicenseEvidence): LicenseExpressionEvidence[] {
  const matches: LicenseExpressionEvidence[] = [];
  for (const file of evidence.files) {
    if (file.kind !== "license" && file.kind !== "copying") {
      continue;
    }

    const expression = recognizeStandardLicenseText(file.text);
    if (expression && !isAbsentLicenseExpression(expression)) {
      matches.push({
        expression,
        source: "license-file",
        filePath: file.path,
        ...(file.scope === "component" ? { fileScope: "component" } : {})
      });
    }
  }

  return matches;
}

function appendBundledComponentLicenses(input: {
  parsed: ReturnType<typeof parseSpdxExpression>;
  matches: LicenseExpressionEvidence[];
  evidenceSources: string[];
}): ReturnType<typeof parseSpdxExpression> {
  const baseChoices = new Set(input.parsed.choices.map(comparableLicenseId));
  const additions = new Map<string, LicenseExpressionEvidence[]>();

  for (const match of input.matches) {
    const component = parseSpdxExpression(match.expression);
    if (
      component.malformed
      || component.choices.every((choice) => baseChoices.has(comparableLicenseId(choice)))
    ) {
      continue;
    }
    const matches = additions.get(component.expression ?? match.expression) ?? [];
    matches.push(match);
    additions.set(component.expression ?? match.expression, matches);
  }

  if (additions.size === 0 || !input.parsed.expression) {
    return input.parsed;
  }

  for (const [expression, matches] of additions) {
    input.evidenceSources.push(
      `bundled component license match: ${expression} from ${matches
        .map((match) => match.filePath)
        .join(", ")}`
    );
  }

  const expression = [
    `(${input.parsed.expression})`,
    ...[...additions.keys()].map((item) => `(${item})`)
  ].join(" AND ");
  const combined = parseSpdxExpression(expression);
  return combined.malformed ? input.parsed : combined;
}

function recognizeStandardLicenseText(text: string): string | undefined {
  const spdxIdentifier = readSpdxLicenseIdentifier(text);
  if (spdxIdentifier) {
    return spdxIdentifier;
  }

  if (/\bMozilla Public License\b[\s\S]*\bVersion 2\.0\b/i.test(text)) {
    return "MPL-2.0";
  }

  if (/\bEclipse Public License\b[\s\S]*\bVersion 2\.0\b/i.test(text)) {
    return "EPL-2.0";
  }

  if (isRecognizableApacheLicenseText(text)) {
    return "Apache-2.0";
  }

  if (/\bCreative Commons Legal Code\b[\s\S]*\bCC0 1\.0 Universal\b/i.test(text)) {
    return "CC0-1.0";
  }

  if (
    /\bsubject to your choice of exactly one of\b/i.test(text)
    && /\bThe FreeType License\b/i.test(text)
    && /\bGNU General Public License(?: \(GPL\))?, version 2 or later\b/i.test(text)
  ) {
    return "FTL OR GPL-2.0-or-later";
  }

  const gnuLicense = recognizeGnuLicenseText(text);
  if (gnuLicense) {
    return gnuLicense;
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
    if (
      /\bprovided\s+that\s+the\s+above\s+copyright\s+notice\s+and\s+this\s+permission\s+notice\s+appear\s+in\s+all\s+copies\b/i.test(text)
    ) {
      return "ISC";
    }
    if (/\bfor any purpose with or without fee is hereby granted\b/i.test(text)) {
      return "0BSD";
    }
  }

  if (
    /\bThis software is provided ['"]as-is['"], without any express or implied warranty\b/i.test(text)
    && /\bPermission is granted to anyone to use this software for any purpose\b/i.test(text)
    && /\bThe origin of this software must not be misrepresented\b/i.test(text)
  ) {
    return "Zlib";
  }

  if (/\bRedistribution and use in source and binary forms\b/i.test(text)) {
    if (
      /\bAll advertising materials mentioning features or use of this software must display the following acknowledgement\b/i.test(text)
    ) {
      return "BSD-4-Clause";
    }
    return /\bNeither the name of\b/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  }

  return undefined;
}

const GNU_LICENSE_SIGNATURES = [
  {
    expression: "AGPL-3.0-only",
    pattern: /\bGNU AFFERO GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 3\b/i
  },
  {
    expression: "LGPL-3.0-only",
    pattern: /\bGNU LESSER GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 3\b/i
  },
  {
    expression: "LGPL-2.1-only",
    pattern: /\bGNU LESSER GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 2\.1\b/i
  },
  {
    expression: "LGPL-2.0-only",
    pattern: /\bGNU LIBRARY GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 2\b/i
  },
  {
    expression: "GPL-3.0-only",
    pattern: /\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 3\b/i
  },
  {
    expression: "GPL-2.0-only",
    pattern: /\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?\bVersion 2\b/i
  }
] as const;

function recognizeGnuLicenseText(text: string): string | undefined {
  if (!/\bTERMS AND CONDITIONS\b/i.test(text)) {
    return undefined;
  }

  let earliest: { expression: string; index: number } | undefined;

  for (const signature of GNU_LICENSE_SIGNATURES) {
    const match = signature.pattern.exec(text);
    if (match && (!earliest || match.index < earliest.index)) {
      earliest = { expression: signature.expression, index: match.index };
    }
  }

  return earliest?.expression;
}

function isRecognizableApacheLicenseText(text: string): boolean {
  const fullLicense = /\bApache License\b[\s\S]*\bVersion 2\.0\b/i.test(text)
    && /\bTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\b/i.test(text);
  const standardHeader = /\bLicensed under the Apache License, Version 2\.0\b/i.test(text)
    && /\bAS IS["”]? BASIS\b/i.test(text)
    && /\blimitations under the License\b/i.test(text);
  return fullLicense || standardHeader;
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

  if (evidence.packageJsonPrivate) {
    sources.push("package.json private: true");
  }

  if (evidence.packageJsonLicenses !== undefined) {
    sources.push("package.json licenses field");
  }

  const metadataSource = evidence.metadataSource ?? "package metadata";
  if (evidence.metadataLicense) {
    const metadataLabel = evidence.metadataLicenseKind === "classifier" ? "classifier" : "license";
    sources.push(`${metadataSource} ${metadataLabel}: ${evidence.metadataLicense}`);
  }

  if (evidence.metadataLicenses !== undefined) {
    sources.push(`${metadataSource} licenses field`);
  }

  if (evidence.sbomDeclaredLicense) {
    sources.push(`SPDX licenseDeclared: ${evidence.sbomDeclaredLicense}`);
  }

  if (evidence.sbomConcludedLicense) {
    sources.push(`SPDX licenseConcluded: ${evidence.sbomConcludedLicense}`);
  }

  for (const file of evidence.files) {
    sources.push(`file: ${file.path} (${file.kind})`);
  }

  for (const warning of evidence.warnings) {
    sources.push(`warning: ${warning}`);
  }

  return sources;
}
