import type { ReportLanguage } from "../language";
import type { HtmlReportText } from "./types";

export type LocaleCatalogValidationIssue = {
  language: ReportLanguage;
  path: string;
  message: string;
};

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_-]*)\}/g;

export function validateHtmlReportCatalogs(
  catalogs: Readonly<Record<ReportLanguage, HtmlReportText>>
): LocaleCatalogValidationIssue[] {
  const english = catalogs.en;
  const issues: LocaleCatalogValidationIssue[] = [];

  for (const [language, catalog] of Object.entries(catalogs) as Array<
    [ReportLanguage, HtmlReportText]
  >) {
    validateValue({
      language,
      path: "",
      reference: english,
      candidate: catalog,
      issues
    });
  }

  return issues;
}

function validateValue(input: {
  language: ReportLanguage;
  path: string;
  reference: unknown;
  candidate: unknown;
  issues: LocaleCatalogValidationIssue[];
}): void {
  if (typeof input.reference === "function") {
    if (typeof input.candidate !== "function") {
      input.issues.push({
        language: input.language,
        path: input.path,
        message: "Expected a message formatter function."
      });
    }
    return;
  }

  if (typeof input.reference === "string") {
    if (typeof input.candidate !== "string") {
      input.issues.push({
        language: input.language,
        path: input.path,
        message: "Expected a translated string."
      });
      return;
    }

    const expectedPlaceholders = placeholders(input.reference);
    const actualPlaceholders = placeholders(input.candidate);
    if (!sameSet(expectedPlaceholders, actualPlaceholders)) {
      input.issues.push({
        language: input.language,
        path: input.path,
        message: `Placeholder mismatch: expected ${formatSet(expectedPlaceholders)}, received ${formatSet(actualPlaceholders)}.`
      });
    }
    return;
  }

  if (!isRecord(input.reference)) {
    return;
  }
  if (!isRecord(input.candidate)) {
    input.issues.push({
      language: input.language,
      path: input.path,
      message: "Expected a translation object."
    });
    return;
  }

  for (const [key, referenceValue] of Object.entries(input.reference)) {
    const nextPath = input.path ? `${input.path}.${key}` : key;
    if (!(key in input.candidate)) {
      input.issues.push({
        language: input.language,
        path: nextPath,
        message: "Missing translation key."
      });
      continue;
    }
    validateValue({
      language: input.language,
      path: nextPath,
      reference: referenceValue,
      candidate: input.candidate[key],
      issues: input.issues
    });
  }
}

function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? ""));
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function formatSet(values: ReadonlySet<string>): string {
  return values.size === 0 ? "none" : [...values].sort().map((value) => `{${value}}`).join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
