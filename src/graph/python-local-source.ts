import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";

import { classifyEvidenceFile } from "../evidence/license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "../evidence/types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  readInputTextFile
} from "./read-input-file";

export type PythonLocalSource = {
  sourcePath: string;
  expectedName?: string;
};

export type PythonLocalSourceFile = {
  path: string;
  text: string;
};

export type PythonLocalSourceFileReader = (input: {
  sourcePath: string;
  relativeFilePath: string;
  fromFilePath: string;
}) => Result<PythonLocalSourceFile | undefined, OhriskError>;

export type PythonLocalSourcePackage = {
  name: string;
  version: string;
  id: string;
  evidence: LicenseEvidence;
};

type PythonLocalSourceErrorOptions = {
  parseCode: OhriskError["code"];
  readCode: OhriskError["code"];
  displayName: string;
};

type LocalSourceMetadata = {
  name?: string;
  version?: string;
  license?: string;
  source: string;
};

const LOCAL_SOURCE_METADATA_FILES = ["pyproject.toml", "setup.cfg", "PKG-INFO"] as const;
const LOCAL_SOURCE_EVIDENCE_FILE_CANDIDATES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "UNLICENSE",
  "UNLICENSE.md",
  "COPYING",
  "COPYING.md",
  "NOTICE",
  "NOTICE.md"
] as const;

export function normalizePythonLocalSourcePathSpec(input: string): string | undefined {
  let value = unquotePythonLocalSourcePath(input.trim());
  const fragmentIndex = value.indexOf("#");
  if (fragmentIndex >= 0) {
    value = value.slice(0, fragmentIndex);
  }

  value = stripTrailingRequirementExtras(value.trim());
  if (value === "") {
    return undefined;
  }

  if (value.startsWith("file://")) {
    return undefined;
  }

  if (value.startsWith("file:")) {
    const filePath = safeDecodePath(value.slice("file:".length));
    return isRelativeLocalPath(filePath) ? filePath : undefined;
  }

  return isRelativeLocalPath(value) ? value : undefined;
}

export function readPythonLocalSourcePackage(input: {
  source: PythonLocalSource;
  fromFilePath: string;
  readLocalSourceFile: PythonLocalSourceFileReader | undefined;
  line?: number;
  entry?: string;
  errors: PythonLocalSourceErrorOptions;
}): Result<PythonLocalSourcePackage, OhriskError> {
  if (!input.readLocalSourceFile) {
    return pythonLocalSourceError(omitUndefined({
      errors: input.errors,
      fromFilePath: input.fromFilePath,
      sourcePath: input.source.sourcePath,
      line: input.line,
      entry: input.entry,
      message: `Failed to parse ${input.errors.displayName}. Local source package entries require file access.`
    }));
  }

  const metadata = readLocalSourceMetadata({
    sourcePath: input.source.sourcePath,
    fromFilePath: input.fromFilePath,
    readLocalSourceFile: input.readLocalSourceFile
  });
  if (!metadata.ok) {
    return metadata;
  }

  if (!metadata.value.name || !metadata.value.version) {
    return pythonLocalSourceError(omitUndefined({
      errors: input.errors,
      fromFilePath: input.fromFilePath,
      sourcePath: input.source.sourcePath,
      line: input.line,
      entry: input.entry,
      message: `Failed to parse ${input.errors.displayName}. Local source package entries must declare package name and version metadata.`
    }));
  }

  if (
    input.source.expectedName
    && normalizePythonPackageName(input.source.expectedName) !== normalizePythonPackageName(metadata.value.name)
  ) {
    return err(
      createError({
        code: input.errors.parseCode,
        category: "unsupported_input",
        message: `Failed to parse ${input.errors.displayName}. Local source package name does not match package metadata.`,
        details: {
          lockfilePath: input.fromFilePath,
          ...(input.line === undefined ? {} : { line: input.line }),
          ...(input.entry === undefined ? {} : { entry: input.entry }),
          sourcePath: input.source.sourcePath,
          expectedName: input.source.expectedName,
          metadataName: metadata.value.name
        }
      })
    );
  }

  const id = `${metadata.value.name}@${metadata.value.version}`;
  const evidence = readLocalSourceEvidence({
    packageId: id,
    metadata: metadata.value,
    sourcePath: input.source.sourcePath,
    fromFilePath: input.fromFilePath,
    readLocalSourceFile: input.readLocalSourceFile
  });
  if (!evidence.ok) {
    return evidence;
  }

  return ok({
    name: metadata.value.name,
    version: metadata.value.version,
    id,
    evidence: evidence.value
  });
}

export function createDiskPythonLocalSourceFileReader(input: {
  rootDir: string;
  maxBytes: number;
  errors: PythonLocalSourceErrorOptions;
}): PythonLocalSourceFileReader {
  const rootDir = path.resolve(input.rootDir);

  return ({ sourcePath, relativeFilePath, fromFilePath }) => {
    const resolvedSource = resolveDiskLocalSourcePath({
      sourcePath,
      fromFilePath,
      rootDir,
      errors: input.errors
    });
    if (!resolvedSource.ok) {
      return resolvedSource;
    }

    const resolvedFilePath = path.resolve(resolvedSource.value, relativeFilePath);
    if (!isPathInsideOrEqual(resolvedFilePath, resolvedSource.value)) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Local source evidence paths must stay inside the local source root.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    if (!existsSync(resolvedFilePath)) {
      return ok(undefined);
    }

    const sourceText = readInputTextFile({
      filePath: resolvedFilePath,
      maxBytes: input.maxBytes
    });
    if (!sourceText.ok) {
      return err(
        createError({
          code: input.errors.readCode,
          category: inputFileReadErrorCategory(sourceText.error),
          message: sourceText.error.kind === "too_large"
            ? "Local Python source metadata or evidence file exceeded the maximum supported size."
            : "Failed to read local Python source metadata or evidence file.",
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath,
            sourceFilePath: resolvedFilePath,
            ...inputFileReadErrorDetails(sourceText.error)
          }
        })
      );
    }

    return ok({
      path: resolvedFilePath,
      text: sourceText.value
    });
  };
}

function readLocalSourceMetadata(input: {
  sourcePath: string;
  fromFilePath: string;
  readLocalSourceFile: PythonLocalSourceFileReader;
}): Result<LocalSourceMetadata, OhriskError> {
  for (const relativeFilePath of LOCAL_SOURCE_METADATA_FILES) {
    const sourceFile = input.readLocalSourceFile({
      sourcePath: input.sourcePath,
      relativeFilePath,
      fromFilePath: input.fromFilePath
    });
    if (!sourceFile.ok) {
      return sourceFile;
    }

    if (!sourceFile.value) {
      continue;
    }

    const metadata = parseLocalSourceMetadataFile({
      fileName: relativeFilePath,
      text: sourceFile.value.text
    });
    if (metadata.name && metadata.version) {
      return ok(metadata);
    }
  }

  return ok({
    source: "local source metadata"
  });
}

function parseLocalSourceMetadataFile(input: {
  fileName: string;
  text: string;
}): LocalSourceMetadata {
  if (input.fileName === "pyproject.toml") {
    return parseLocalSourcePyproject(input.text);
  }

  if (input.fileName === "setup.cfg") {
    return parseLocalSourceSetupCfg(input.text);
  }

  return parseLocalSourceEmailMetadata(input.text, "PKG-INFO");
}

function parseLocalSourcePyproject(input: string): LocalSourceMetadata {
  const project: Record<string, string> = {};
  const poetry: Record<string, string> = {};
  let section: "project" | "tool.poetry" | "other" = "other";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line === "[project]") {
      section = "project";
      continue;
    }

    if (line === "[tool.poetry]") {
      section = "tool.poetry";
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = "other";
      continue;
    }

    const target = section === "project"
      ? project
      : section === "tool.poetry"
        ? poetry
        : undefined;
    if (!target) {
      continue;
    }

    for (const key of ["name", "version", "license"]) {
      const value = readTomlStringAssignment(line, key) ?? readTomlInlineTextLicense(line, key);
      if (value !== undefined) {
        target[key] = value;
      }
    }
  }

  const selected = project.name && project.version ? project : poetry;
  return omitUndefined({
    name: selected.name,
    version: selected.version,
    license: selected.license,
    source: "pyproject.toml"
  });
}

function parseLocalSourceSetupCfg(input: string): LocalSourceMetadata {
  const metadata: Record<string, string> = {};
  let section = "";

  for (const rawLine of input.split(/\r?\n/)) {
    const line = stripIniComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim().toLowerCase();
      continue;
    }

    if (section !== "metadata") {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if ((key === "name" || key === "version" || key === "license") && value !== "") {
      metadata[key] = value;
    }
  }

  return omitUndefined({
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    source: "setup.cfg"
  });
}

function parseLocalSourceEmailMetadata(input: string, source: string): LocalSourceMetadata {
  const headers = new Map<string, string>();

  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === "") {
      break;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (value !== "") {
      headers.set(key, value);
    }
  }

  return omitUndefined({
    name: headers.get("name"),
    version: headers.get("version"),
    license: headers.get("license-expression") ?? headers.get("license"),
    source
  });
}

function readLocalSourceEvidence(input: {
  packageId: string;
  metadata: LocalSourceMetadata;
  sourcePath: string;
  fromFilePath: string;
  readLocalSourceFile: PythonLocalSourceFileReader;
}): Result<LicenseEvidence, OhriskError> {
  const files: LicenseEvidenceFile[] = [];
  const warnings: string[] = [];

  for (const relativeFilePath of LOCAL_SOURCE_EVIDENCE_FILE_CANDIDATES) {
    const kind = classifyEvidenceFile(relativeFilePath);
    if (!kind) {
      continue;
    }

    const sourceFile = input.readLocalSourceFile({
      sourcePath: input.sourcePath,
      relativeFilePath,
      fromFilePath: input.fromFilePath
    });
    if (!sourceFile.ok) {
      return sourceFile;
    }

    if (!sourceFile.value) {
      continue;
    }

    files.push({
      path: path.posix.join(input.sourcePath.replace(/\\/g, "/"), relativeFilePath),
      kind,
      text: sourceFile.value.text
    });
  }

  if (files.length === 0) {
    warnings.push("No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found in the local Python source tree.");
  }

  if (!input.metadata.license) {
    warnings.push(`${input.metadata.source} did not declare license metadata.`);
  }

  return ok({
    packageId: input.packageId,
    ...(input.metadata.license
      ? {
          metadataLicense: input.metadata.license,
          metadataSource: input.metadata.source
        }
      : {}),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    source: "local",
    warnings
  });
}

function resolveDiskLocalSourcePath(input: {
  sourcePath: string;
  fromFilePath: string;
  rootDir: string;
  errors: PythonLocalSourceErrorOptions;
}): Result<string, OhriskError> {
  if (path.isAbsolute(input.sourcePath)) {
    return err(
      createError({
        code: input.errors.parseCode,
        category: "unsupported_input",
        message: `Failed to parse ${input.errors.displayName}. Absolute local source paths are not supported.`,
        details: {
          lockfilePath: input.fromFilePath,
          sourcePath: input.sourcePath
        }
      })
    );
  }

  const resolved = path.resolve(path.dirname(input.fromFilePath), input.sourcePath);
  if (!isPathInsideOrEqual(resolved, input.rootDir)) {
    return err(
      createError({
        code: input.errors.parseCode,
        category: "unsupported_input",
        message: `Failed to parse ${input.errors.displayName}. Local source paths must stay inside the project root.`,
        details: {
          lockfilePath: input.fromFilePath,
          sourcePath: input.sourcePath
        }
      })
    );
  }

  return ok(resolved);
}

function pythonLocalSourceError(input: {
  errors: PythonLocalSourceErrorOptions;
  fromFilePath: string;
  sourcePath: string;
  line?: number;
  entry?: string;
  message: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: input.errors.parseCode,
      category: "unsupported_input",
      message: input.message,
      details: {
        lockfilePath: input.fromFilePath,
        ...(input.line === undefined ? {} : { line: input.line }),
        ...(input.entry === undefined ? {} : { entry: input.entry }),
        sourcePath: input.sourcePath
      }
    })
  );
}

function stripTrailingRequirementExtras(value: string): string {
  const extrasMatch = /^(.*?)(?:\[[A-Za-z0-9_, .-]+\])$/.exec(value);
  return extrasMatch?.[1] ? extrasMatch[1] : value;
}

function safeDecodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRelativeLocalPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized === "."
    || normalized === ".."
    || normalized.startsWith("./")
    || normalized.startsWith("../");
}

function normalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function unquotePythonLocalSourcePath(input: string): string {
  const value = input.trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function readTomlStringAssignment(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*([\"'])(.*?)\\1\\s*$`).exec(line);
  return match?.[2];
}

function readTomlInlineTextLicense(line: string, key: string): string | undefined {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\\{\\s*text\\s*=\\s*([\"'])(.*?)\\1\\s*\\}\\s*$`).exec(line);
  return match?.[2];
}

function stripTomlComment(line: string): string {
  return stripInlineComment(line, "#");
}

function stripIniComment(line: string): string {
  return stripInlineComment(stripInlineComment(line, "#"), ";");
}

function stripInlineComment(line: string, marker: "#" | ";"): string {
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }

    if (char === marker && !quote && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index);
    }
  }

  return line;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
