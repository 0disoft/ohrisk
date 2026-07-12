import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LcovSummary = {
  lines: { found: number; hit: number; ratio: number };
  functions: { found: number; hit: number; ratio: number };
};

const LINE_THRESHOLD = 0.82;
const FUNCTION_THRESHOLD = 0.90;
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = path.join(repoRoot, "coverage");
const lcovPath = path.join(coverageDir, "lcov.info");

export function parseLcovSummary(text: string): LcovSummary {
  let linesFound = 0;
  let linesHit = 0;
  let functionsFound = 0;
  let functionsHit = 0;

  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator);
    const rawValue = line.slice(separator + 1);
    if (!/^[0-9]+$/.test(rawValue)) {
      continue;
    }

    const value = Number(rawValue);
    if (key === "LF") {
      linesFound += value;
    } else if (key === "LH") {
      linesHit += value;
    } else if (key === "FNF") {
      functionsFound += value;
    } else if (key === "FNH") {
      functionsHit += value;
    }
  }

  if (linesFound === 0 || functionsFound === 0) {
    throw new Error("LCOV report did not contain line and function totals.");
  }
  if (linesHit > linesFound || functionsHit > functionsFound) {
    throw new Error("LCOV report contains impossible hit totals.");
  }

  return {
    lines: {
      found: linesFound,
      hit: linesHit,
      ratio: linesHit / linesFound
    },
    functions: {
      found: functionsFound,
      hit: functionsHit,
      ratio: functionsHit / functionsFound
    }
  };
}

function formatPercentage(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function run(): void {
  rmSync(coverageDir, { recursive: true, force: true });

  const result = spawnSync(
    process.execPath,
    ["test", "--coverage", "--coverage-reporter=lcov"],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const summary = parseLcovSummary(readFileSync(lcovPath, "utf8"));
  const lineCoverage = formatPercentage(summary.lines.ratio);
  const functionCoverage = formatPercentage(summary.functions.ratio);

  console.log(
    `Coverage: lines ${lineCoverage} (${summary.lines.hit}/${summary.lines.found}), `
      + `functions ${functionCoverage} (${summary.functions.hit}/${summary.functions.found}).`
  );

  const failures: string[] = [];
  if (summary.lines.ratio < LINE_THRESHOLD) {
    failures.push(
      `line coverage ${lineCoverage} is below ${formatPercentage(LINE_THRESHOLD)}`
    );
  }
  if (summary.functions.ratio < FUNCTION_THRESHOLD) {
    failures.push(
      `function coverage ${functionCoverage} is below ${formatPercentage(FUNCTION_THRESHOLD)}`
    );
  }

  if (failures.length > 0) {
    throw new Error(`Coverage threshold failed: ${failures.join("; ")}.`);
  }

  console.log(
    `Coverage thresholds passed: lines >= ${formatPercentage(LINE_THRESHOLD)}, `
      + `functions >= ${formatPercentage(FUNCTION_THRESHOLD)}.`
  );
}

if (import.meta.main) {
  run();
}
