import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT_FILES = [
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CHECKLIST.md",
  "README.md",
  "RELEASING.md",
  "VALIDATION.md",
  "action.yml",
  "bunfig.toml",
  "package.json",
  "tsconfig.json",
  "tsconfig.lint.json",
  "tsconfig.release.json"
];
const SOURCE_DIRECTORIES = [".github", "docs", "schemas", "scripts", "src", "test"];
const TEXT_EXTENSIONS = new Set([".json", ".md", ".toml", ".ts", ".yaml", ".yml"]);
const EXCLUDED_DIRECTORIES = new Set(["fixtures", "node_modules", "coverage", "dist", "action-dist"]);

const files = [
  ...ROOT_FILES.filter(isFile),
  ...SOURCE_DIRECTORIES.flatMap((directory) => collectFiles(directory))
].sort();
const failures: string[] = [];

for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) {
    failures.push(`${file}: contains a NUL byte`);
    continue;
  }

  const text = bytes.toString("utf8");
  if (text.includes("\r")) {
    failures.push(`${file}: contains CR or CRLF line endings`);
  }
  if (!text.endsWith("\n")) {
    failures.push(`${file}: must end with a newline`);
  }

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]+$/.test(lines[index] ?? "")) {
      failures.push(`${file}:${index + 1}: trailing whitespace`);
    }
  }
}

if (failures.length > 0) {
  console.error(["Formatting contract failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log(`Formatting contract passed for ${files.length} files.`);

function collectFiles(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...collectFiles(path.join(directory, entry.name)));
      }
      continue;
    }
    const filePath = path.join(directory, entry.name);
    if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }
  return files;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
