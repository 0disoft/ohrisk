import { readFileSync } from "node:fs";

export const VERSION_REFERENCE_FILES = [
  "README.md",
  "docs/ci.md",
  "docs/github-actions.md",
  "docs/risky-demo.md",
  "docs/github-action/action-contract.md",
  "docs/github-action/inputs-and-outputs.md"
] as const;

export function readPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
    throw new Error("package.json must contain an exact semantic version.");
  }
  return packageJson.version;
}

export function synchronizedVersionText(text: string, version: string): string {
  return text
    .replace(/\bohrisk@(latest|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g, `ohrisk@${version}`)
    .replace(/\b0disoft\/ohrisk@(main|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g, `0disoft/ohrisk@v${version}`)
    .replace(/(^\s*version:\s*)(latest|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(\s*$)/gm, `$1${version}$3`);
}
