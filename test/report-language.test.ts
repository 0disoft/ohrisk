import { describe, expect, test } from "bun:test";

import {
  reportLanguageFromLocale,
  resolveReportLanguage
} from "../src/report/language";

describe("HTML report language selection", () => {
  test.each([
    ["en-US", "en"],
    ["ko-KR", "ko"],
    ["es-ES", "es"],
    ["fr_FR.UTF-8", "fr"],
    ["zh-Hant-TW", "zh"],
    ["hi-IN", "hi"],
    ["ja-JP", "ja"],
    ["id-ID", "id"],
    ["in-ID", "id"],
    ["tr-TR", "tr"],
    ["ru-RU", "ru"],
    ["de-DE", "de"]
  ] as const)("maps OS locale %s to %s", (locale, expected) => {
    expect(reportLanguageFromLocale(locale)).toBe(expected);
  });

  test("falls back to English for unsupported or unavailable OS locales", () => {
    expect(resolveReportLanguage(undefined, "pt-BR")).toBe("en");
    expect(resolveReportLanguage(undefined, "C.UTF-8")).toBe("en");
    expect(resolveReportLanguage(undefined, undefined)).toBe("en");
  });

  test("keeps an explicit language ahead of the OS locale", () => {
    expect(resolveReportLanguage("en", "ko-KR")).toBe("en");
    expect(resolveReportLanguage("ko", "en-US")).toBe("ko");
  });
});
