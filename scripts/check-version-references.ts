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

const packageJson = readFileSync("package.json", "utf8");
if (/"latest"/.test(packageJson)) {
  failures.push("package.json: mutable latest dependency or script reference is forbidden");
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
