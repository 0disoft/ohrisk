import { readFileSync, writeFileSync } from "node:fs";

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
let changed = 0;

for (const file of PUBLIC_VERSION_REFERENCE_FILES) {
  changed += synchronize(file, releasedVersion, synchronizedPublicVersionText);
}
for (const file of CANDIDATE_VERSION_REFERENCE_FILES) {
  changed += synchronize(file, packageVersion, synchronizedCandidateVersionText);
}

console.log(
  `Synchronized ${changed} documentation files (public ${releasedVersion}, candidate ${packageVersion}).`
);

function synchronize(
  file: string,
  version: string,
  transform: (text: string, version: string) => string
): number {
  const current = readFileSync(file, "utf8");
  const next = transform(current, version);
  if (next === current) return 0;
  writeFileSync(file, next);
  return 1;
}
