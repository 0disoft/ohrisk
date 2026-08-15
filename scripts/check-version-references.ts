import { readFileSync } from "node:fs";

import {
  CANDIDATE_VERSION_REFERENCE_FILES,
  PUBLIC_VERSION_REFERENCE_FILES,
  readLatestReleasedVersion,
  readPackageVersion,
  synchronizedCandidateVersionText,
  synchronizedPublicVersionText
} from "./version-references";

const packageVersion = readPackageVersion();
const releasedVersion = readLatestReleasedVersion();
const failures: string[] = [];

for (const file of PUBLIC_VERSION_REFERENCE_FILES) {
  check(file, releasedVersion, synchronizedPublicVersionText);
}
for (const file of CANDIDATE_VERSION_REFERENCE_FILES) {
  check(file, packageVersion, synchronizedCandidateVersionText);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const forbiddenLatestReferences = [
  ...Object.entries(packageJson.dependencies ?? {}),
  ...Object.entries(packageJson.devDependencies ?? {})
    .filter(([name]) => name !== "@0disoft/laqu"),
  ...Object.entries(packageJson.scripts ?? {})
].filter(([, value]) => /\blatest\b/.test(value));
if (forbiddenLatestReferences.length > 0) {
  failures.push("package.json: mutable latest dependency or script reference is forbidden except for @0disoft/laqu");
}

const action = readFileSync("action.yml", "utf8");
if (/\blatest\b/.test(action)) {
  failures.push("action.yml: mutable latest version selection is forbidden");
}
if (!action.includes("action-dist/cli.js")) {
  failures.push("action.yml: bundled action-dist/cli.js execution is required");
}

if (failures.length > 0) {
  console.error(["Version reference contract failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log(`Version reference contract passed (public ${releasedVersion}, candidate ${packageVersion}).`);

function check(
  file: string,
  version: string,
  transform: (text: string, version: string) => string
): void {
  const current = readFileSync(file, "utf8");
  if (transform(current, version) !== current) {
    failures.push(`${file}: run bun run version:sync`);
  }
}
