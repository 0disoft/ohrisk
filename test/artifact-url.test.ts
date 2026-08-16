import { describe, expect, test } from "bun:test";

import {
  parseHttpUrl,
  redactUrlCredentialsInDetails,
  safeErrorCauseForDetails,
  safeOptionalUrlForErrorDetails,
  safeUrlForErrorDetails
} from "../src/evidence/artifact-url";

describe("artifact URL safety", () => {
  test("parses only HTTP URLs with a hostname", () => {
    expect(parseHttpUrl("https://registry.example.test/package")?.hostname).toBe(
      "registry.example.test"
    );
    expect(parseHttpUrl("http://registry.example.test/package")?.protocol).toBe("http:");
    expect(parseHttpUrl("ftp://registry.example.test/package")).toBeUndefined();
    expect(parseHttpUrl("/relative/package")).toBeUndefined();
  });

  test("removes credentials, queries, and fragments from URL details", () => {
    expect(
      safeUrlForErrorDetails("https://user:secret@registry.example.test/pkg?token=secret#part")
    ).toBe("https://redacted:redacted@registry.example.test/pkg");
    expect(safeOptionalUrlForErrorDetails(undefined)).toBeUndefined();
  });

  test("redacts URL-like credentials from malformed text and error causes", () => {
    const malformed = "download failed for https:\\\\user:secret@registry.example.test\\pkg";
    expect(safeUrlForErrorDetails(malformed)).not.toContain("user:secret");
    expect(safeErrorCauseForDetails(new Error(malformed))).not.toContain("user:secret");
  });

  test("redacts only known URL detail fields without mutating the input", () => {
    const details = {
      resolved: "https://user:secret@registry.example.test/pkg?token=secret",
      packageId: "user:secret@package"
    };

    const redacted = redactUrlCredentialsInDetails(details);

    expect(redacted.resolved).toBe("https://redacted:redacted@registry.example.test/pkg");
    expect(redacted.packageId).toBe(details.packageId);
    expect(details.resolved).toContain("user:secret");
  });
});
