import { DEFAULT_REPORT_LANGUAGE, type ReportLanguage } from "../language";
import { ENGLISH_TEXT } from "./en";
import { KOREAN_TEXT } from "./ko";
import { SPANISH_TEXT } from "./es";
import { FRENCH_TEXT } from "./fr";
import { CHINESE_TEXT } from "./zh";
import { HINDI_TEXT } from "./hi";
import { JAPANESE_TEXT } from "./ja";
import { INDONESIAN_TEXT } from "./id";
import { TURKISH_TEXT } from "./tr";
import { RUSSIAN_TEXT } from "./ru";
import { GERMAN_TEXT } from "./de";
import type { HtmlReportText } from "./types";

export const HTML_REPORT_TEXT: Readonly<Record<ReportLanguage, HtmlReportText>> = {
  en: ENGLISH_TEXT,
  ko: KOREAN_TEXT,
  es: SPANISH_TEXT,
  fr: FRENCH_TEXT,
  zh: CHINESE_TEXT,
  hi: HINDI_TEXT,
  ja: JAPANESE_TEXT,
  id: INDONESIAN_TEXT,
  tr: TURKISH_TEXT,
  ru: RUSSIAN_TEXT,
  de: GERMAN_TEXT
};

export function htmlReportText(language: ReportLanguage | undefined): HtmlReportText {
  const selected = HTML_REPORT_TEXT[language ?? DEFAULT_REPORT_LANGUAGE] ?? ENGLISH_TEXT;
  return {
    ...ENGLISH_TEXT,
    ...selected,
    labels: { ...ENGLISH_TEXT.labels, ...selected.labels },
    messages: { ...ENGLISH_TEXT.messages, ...selected.messages },
    captions: { ...ENGLISH_TEXT.captions, ...selected.captions }
  };
}

export type {
  EvidenceRecoveryAdvice,
  EvidenceRecoveryHint,
  HtmlReportText
} from "./types";
