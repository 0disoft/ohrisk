import { describe, expect, test } from "bun:test";

import {
  HTML_REPORT_TEXT,
  htmlReportText,
  validateHtmlReportCatalogs,
  type HtmlReportText
} from "../src/report/html-report-text";
import type { ReportLanguage } from "../src/report/language";

describe("HTML report locale catalogs", () => {
  test("contains every English key with matching placeholders", () => {
    expect(validateHtmlReportCatalogs(HTML_REPORT_TEXT)).toEqual([]);
  });

  test("detects placeholder drift before a translation ships", () => {
    const brokenKorean: HtmlReportText = {
      ...HTML_REPORT_TEXT.ko,
      messages: {
        ...HTML_REPORT_TEXT.ko.messages,
        filterStatusTemplate: "{visible}개 표시"
      }
    };
    const catalogs = {
      ...HTML_REPORT_TEXT,
      ko: brokenKorean
    } as Readonly<Record<ReportLanguage, HtmlReportText>>;

    expect(validateHtmlReportCatalogs(catalogs)).toContainEqual({
      language: "ko",
      path: "messages.filterStatusTemplate",
      message: "Placeholder mismatch: expected {total}, {visible}, received {visible}."
    });
  });

  test("falls back to English for an unknown runtime locale", () => {
    expect(htmlReportText("unsupported" as ReportLanguage).title)
      .toBe(HTML_REPORT_TEXT.en.title);
  });
});
