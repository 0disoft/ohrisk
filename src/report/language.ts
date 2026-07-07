export const REPORT_LANGUAGES = ["en", "ko"] as const;

export type ReportLanguage = typeof REPORT_LANGUAGES[number];

export const DEFAULT_REPORT_LANGUAGE: ReportLanguage = "en";

export function isReportLanguage(value: string): value is ReportLanguage {
  return (REPORT_LANGUAGES as readonly string[]).includes(value);
}

export function supportedReportLanguages(): ReportLanguage[] {
  return [...REPORT_LANGUAGES];
}
