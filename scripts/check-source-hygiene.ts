import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PINNED_ACTION = /\buses:\s*([^\s#]+)@([0-9a-f]{40})(?:\s+#\s*[^\s]+)?\s*$/gm;
const ANY_ACTION_USE = /\buses:\s*([^\s#]+)@([^\s#]+)/g;
const failures: string[] = [];

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
};

for (const [section, dependencies] of [
  ["dependencies", packageJson.dependencies],
  ["devDependencies", packageJson.devDependencies]
] as const) {
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (!EXACT_VERSION.test(version)) {
      failures.push(`package.json ${section}.${name} must use an exact version, received ${version}`);
    }
  }
}

if (existsSync("tsconfig.release.json")) {
  try {
    const releaseConfig = JSON.parse(readFileSync("tsconfig.release.json", "utf8")) as {
      extends?: unknown;
      files?: unknown;
      include?: unknown;
      exclude?: unknown;
    };
    if (releaseConfig.extends !== "./tsconfig.json") {
      failures.push("tsconfig.release.json must extend the full-project tsconfig.json");
    }
    if ("files" in releaseConfig || "include" in releaseConfig || "exclude" in releaseConfig) {
      failures.push("tsconfig.release.json must not narrow the files checked by tsconfig.json");
    }
  } catch (cause) {
    failures.push(`tsconfig.release.json is invalid JSON: ${errorMessage(cause)}`);
  }
}

const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { include?: unknown };
const includes = Array.isArray(tsconfig.include) ? tsconfig.include : [];
for (const required of ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]) {
  if (!includes.includes(required)) {
    failures.push(`tsconfig.json include must contain ${required}`);
  }
}

if (!packageJson.files?.includes("schemas")) {
  failures.push("package.json files must include schemas");
}

for (const schemaName of [
  "common.schema.json",
  "scan-report.schema.json",
  "diff-report.schema.json",
  "explain-report.schema.json"
]) {
  const schemaPath = path.join("schemas", schemaName);
  try {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { $schema?: unknown; $id?: unknown };
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      failures.push(`${schemaPath} must use JSON Schema draft 2020-12`);
    }
    if (typeof schema.$id !== "string" || !schema.$id.startsWith("urn:ohrisk:schema:")) {
      failures.push(`${schemaPath} must declare an Ohrisk schema identifier`);
    }
  } catch (cause) {
    failures.push(`${schemaPath} is missing or invalid JSON: ${errorMessage(cause)}`);
  }
}

for (const workflowPath of [
  path.join(".github", "workflows", "ci.yml"),
  path.join(".github", "workflows", "publish-npm.yml"),
  "action.yml"
]) {
  const source = readFileSync(workflowPath, "utf8");
  const pinned = new Set([...source.matchAll(PINNED_ACTION)].map((match) => `${match[1]}@${match[2]}`));
  for (const match of source.matchAll(ANY_ACTION_USE)) {
    const reference = `${match[1]}@${match[2]}`;
    if (!match[1]?.startsWith("./") && !pinned.has(reference)) {
      failures.push(`${workflowPath} uses mutable action reference ${reference}`);
    }
  }
}

const action = readFileSync("action.yml", "utf8");
if (/npm\s+install\s+-g\s+ohrisk/i.test(action)) {
  failures.push("action.yml must execute the bundled CLI instead of installing from npm");
}
if (/\blatest\b/i.test(action)) {
  failures.push("action.yml must not select a mutable latest version");
}
if (!action.includes("action-dist/cli.js")) {
  failures.push("action.yml must execute action-dist/cli.js");
}
if (!existsSync(path.join("action-dist", "cli.js"))) {
  failures.push("action-dist/cli.js is missing");
}

const bunfig = readFileSync("bunfig.toml", "utf8");
if (!bunfig.includes("[install]") || !bunfig.includes("exact = true")) {
  failures.push("bunfig.toml must preserve exact dependency installation");
}
const coverageScriptPath = path.join("scripts", "check-coverage.ts");
if (packageJson.scripts?.["test:coverage"] !== "bun scripts/check-coverage.ts") {
  failures.push("package.json test:coverage must execute the repository coverage gate");
}
try {
  const coverageGate = readFileSync(coverageScriptPath, "utf8");
  if (!coverageGate.includes("const LINE_THRESHOLD = 0.82")) {
    failures.push(`${coverageScriptPath} must enforce the 82% global line threshold`);
  }
  if (!coverageGate.includes("const FUNCTION_THRESHOLD = 0.90")) {
    failures.push(`${coverageScriptPath} must enforce the 90% global function threshold`);
  }
} catch (cause) {
  failures.push(`${coverageScriptPath} is missing or unreadable: ${errorMessage(cause)}`);
}

if (packageJson.scripts?.["test:schemas"] !== "bun test test/report-schema.test.ts") {
  failures.push("package.json test:schemas must execute the machine-report schema contract tests");
}
if (!packageJson.scripts?.check?.includes("bun run test:schemas")) {
  failures.push("package.json check must validate machine-report schemas");
}

if (!packageJson.scripts?.["verify:release"]?.includes("bun run test:coverage")) {
  failures.push("package.json verify:release must enforce coverage thresholds");
}

if (failures.length > 0) {
  console.error(["Source hygiene failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log("Source hygiene contract passed.");

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
