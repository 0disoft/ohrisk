export const REPORT_LANGUAGES = ["en", "ko", "es", "fr", "zh", "hi", "ja", "id", "tr", "ru", "de"] as const;

export type ReportLanguage = typeof REPORT_LANGUAGES[number];

export const DEFAULT_REPORT_LANGUAGE: ReportLanguage = "en";

const REPORT_LANGUAGE_ALIASES: Readonly<Record<string, ReportLanguage>> = {
  in: "id"
};

export function isReportLanguage(value: string): value is ReportLanguage {
  return (REPORT_LANGUAGES as readonly string[]).includes(value);
}

export function supportedReportLanguages(): ReportLanguage[] {
  return [...REPORT_LANGUAGES];
}

export function reportLanguageFromLocale(locale: string | undefined): ReportLanguage | undefined {
  const primaryLanguage = locale
    ?.trim()
    .split(/[._@-]/, 1)[0]
    ?.toLowerCase();

  if (!primaryLanguage) {
    return undefined;
  }

  if (isReportLanguage(primaryLanguage)) {
    return primaryLanguage;
  }

  return REPORT_LANGUAGE_ALIASES[primaryLanguage];
}

export function resolveReportLanguage(
  explicitLanguage: ReportLanguage | undefined,
  systemLocale: string | undefined
): ReportLanguage {
  return explicitLanguage
    ?? reportLanguageFromLocale(systemLocale)
    ?? DEFAULT_REPORT_LANGUAGE;
}

export function detectSystemLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}
