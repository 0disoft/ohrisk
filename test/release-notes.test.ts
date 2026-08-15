import { describe, expect, test } from "bun:test";

import { extractReleaseNotes } from "../scripts/extract-release-notes";

describe("release note extraction", () => {
  test("extracts only the exact dated candidate section", () => {
    const notes = extractReleaseNotes([
      "# Changelog",
      "",
      "## 1.15.0 - 2026-08-15",
      "",
      "- Ready to publish.",
      "",
      "## 1.14.1 - 2026-07-28",
      "",
      "- Previous release."
    ].join("\n"), "1.15.0");

    expect(notes).toBe("## 1.15.0 - 2026-08-15\n\n- Ready to publish.\n");
  });

  test("rejects an unreleased candidate before publication", () => {
    expect(() => extractReleaseNotes(
      "# Changelog\n\n## 1.15.0 - Unreleased\n\n- Not ready.\n",
      "1.15.0"
    )).toThrow("must contain a dated 1.15.0 release section");
  });

  test("rejects a dated section without release notes", () => {
    expect(() => extractReleaseNotes(
      "# Changelog\n\n## 1.15.0 - 2026-08-15\n\n## 1.14.1 - 2026-07-28\n\n- Old.\n",
      "1.15.0"
    )).toThrow("must contain release notes");
  });
});
