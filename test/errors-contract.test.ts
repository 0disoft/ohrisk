import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

describe("error code contract", () => {
  test("OhriskErrorCode includes every emitted error code", () => {
    const emittedCodes = sourceFiles(srcRoot)
      .flatMap((sourceFile) => emittedErrorCodes(readFileSync(sourceFile, "utf8")))
      .sort();
    const declaredCodes = declaredErrorCodes(
      readFileSync(path.join(srcRoot, "shared", "errors.ts"), "utf8")
    ).sort();

    expect([...new Set(emittedCodes)]).toEqual([...new Set(declaredCodes)]);
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const entryPath = path.join(root, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      return sourceFiles(entryPath);
    }

    return entryPath.endsWith(".ts") ? [entryPath] : [];
  });
}

function emittedErrorCodes(source: string): string[] {
  return [
    ...source.matchAll(/code:\s*"([A-Z0-9_]+)"/g),
    ...source.matchAll(/\bfail\(\s*"([A-Z0-9_]+)"/g)
  ].map((match) => match[1] ?? "");
}

function declaredErrorCodes(source: string): string[] {
  return [...source.matchAll(/\|\s*"([A-Z0-9_]+)"/g)].map((match) => match[1] ?? "");
}
