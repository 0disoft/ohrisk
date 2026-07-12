import { readFileSync } from "node:fs";

import {
  VERSION_REFERENCE_FILES,
  readPackageVersion,
  synchronizedVersionText
} from "./version-references";

const version = readPackageVersion();
const failures: string[] = [];

for (const file of VERSION_REFERENCE_FILES) {
  const current = readFileSync(file, "utf8");
  const expected = synchronizedVersionText(current, version);
  if (expected !== current) {
    failures.push(`${file}: run bun run version:sync`);
  }
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

console.log(`Version reference contract passed for Ohrisk ${version}.`);
