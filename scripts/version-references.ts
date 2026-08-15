import { readFileSync } from "node:fs";

export const PUBLIC_VERSION_REFERENCE_FILES = [
  "README.md",
  "docs/ci.md",
  "docs/github-actions.md",
  "docs/risky-demo.md",
  "docs/github-action/action-contract.md",
  "docs/github-action/inputs-and-outputs.md"
] as const;

export const CANDIDATE_VERSION_REFERENCE_FILES = ["RELEASING.md"] as const;

const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?";

export function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !new RegExp(`^${SEMVER}$`).test(packageJson.version)) {
    throw new Error("package.json must contain an exact semantic version.");
  }
  return packageJson.version;
}

export function readLatestReleasedVersion(): string {
  const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
  const match = new RegExp(`^##\\s+(${SEMVER})\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`, "m").exec(changelog);
  if (!match?.[1]) {
    throw new Error("CHANGELOG.md must contain at least one dated release section.");
  }
  return match[1];
}

export function synchronizedPublicVersionText(text: string, version: string): string {
  return text
    .replace(/\bohrisk@(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g, `ohrisk@${version}`)
    .replace(/\b0disoft\/ohrisk@(main|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g, `0disoft/ohrisk@v${version}`)
    .replace(/(^\s*version:\s*)(latest|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(\s*$)/gm, `$1${version}$3`);
}

export function synchronizedCandidateVersionText(text: string, version: string): string {
  return text
    .replace(/\bohrisk@(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g, `ohrisk@${version}`)
    .replace(/\b(git tag v|git push origin v)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `$1${version}`);
}
