import { readFileSync, writeFileSync } from "node:fs";

import {
  VERSION_REFERENCE_FILES,
  readPackageVersion,
  synchronizedVersionText
} from "./version-references";

const version = readPackageVersion();
let changed = 0;
for (const file of VERSION_REFERENCE_FILES) {
  const current = readFileSync(file, "utf8");
  const next = synchronizedVersionText(current, version);
  if (next !== current) {
    writeFileSync(file, next);
    changed += 1;
  }
}

console.log(`Synchronized ${changed} documentation files to Ohrisk ${version}.`);
