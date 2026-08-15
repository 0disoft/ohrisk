import { readFileSync } from "node:fs";

import { readPackageVersion } from "./version-references";

export function extractReleaseNotes(changelogText: string, version: string): string {
  const changelog = changelogText.replace(/\r\n/g, "\n");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+${escapedVersion}\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`, "m").exec(changelog);

  if (!heading || heading.index === undefined) {
    throw new Error(`CHANGELOG.md must contain a dated ${version} release section before publication.`);
  }

  const sectionStart = heading.index;
  const remainderStart = sectionStart + heading[0].length;
  const nextHeadingOffset = changelog.slice(remainderStart).search(/^##\s+/m);
  const sectionEnd = nextHeadingOffset === -1 ? changelog.length : remainderStart + nextHeadingOffset;
  const notes = changelog.slice(sectionStart, sectionEnd).trim();
  if (!notes.includes("\n- ")) {
    throw new Error(`CHANGELOG.md ${version} release section must contain release notes.`);
  }
  return `${notes}\n`;
}

if (import.meta.main) {
  process.stdout.write(extractReleaseNotes(readFileSync("CHANGELOG.md", "utf8"), readPackageVersion()));
}
