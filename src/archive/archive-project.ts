import path from "node:path";

import { mergeDependencyGraphs, type SourcedDependencyGraph } from "../graph/merge";
import {
  parseLockfileTextForKind,
  type LockfileTextParseInput
} from "../graph/project-lockfile";
import { LOCKFILE_MAX_BYTES, PACKAGE_JSON_MAX_BYTES } from "../graph/read-input-file";
import type { DependencyGraph } from "../graph/types";
import {
  projectLockfilesFromRelativePaths,
  type ProjectInput,
  type ProjectLockfile
} from "../project/discover";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ArchiveSource, ArchiveWorkBudget } from "./types";

export type LoadArchiveProjectInput = {
  source: ArchiveSource;
  allLockfiles?: boolean;
};

export type ArchiveProject = {
  project: ProjectInput;
  graph: DependencyGraph;
};

type Candidate = {
  entryRoot: string;
  lockfiles: ProjectLockfile[];
};

const codeUnitCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function loadArchiveProject(
  input: LoadArchiveProjectInput
): Result<ArchiveProject, OhriskError> {
  const work = input.source.beginWork();
  const filePaths: string[] = [];
  for (const entry of input.source.entries) {
    const checkpoint = work.checkpoint(entry.path);
    if (!checkpoint.ok) return checkpoint;
    if (entry.type === "file") {
      filePaths.push(entry.path);
    }
  }

  const candidate = selectCandidate(input.source, filePaths, work);
  if (!candidate.ok) {
    return candidate;
  }

  if (candidate.value.lockfiles.length > 1 && !input.allLockfiles) {
    return err(createError({
      code: "MULTIPLE_LOCKFILES",
      category: "unsupported_input",
      message: "Multiple lockfiles found in the same archive project root. Scan all with --all.",
      details: {
        archive: input.source.displayPath,
        entryPath: candidate.value.entryRoot || ".",
        lockfiles: candidate.value.lockfiles.map((lockfile) =>
          syntheticRelativePath(lockfile.path)
        )
      }
    }));
  }

  const selected = input.allLockfiles
    ? candidate.value.lockfiles
    : candidate.value.lockfiles.slice(0, 1);
  const primary = selected[0];
  if (!primary) {
    return noProjectError(input.source);
  }

  const syntheticRoot = syntheticArchiveRoot(input.source);
  const archiveLockfiles = selected.map((lockfile) => ({
    ...lockfile,
    path: path.join(
      syntheticRoot,
      ...syntheticRelativePath(lockfile.path).split("/")
    )
  }));
  const project: ProjectInput = {
    rootDir: syntheticRoot,
    lockfile: archiveLockfiles[0]!,
    ...(archiveLockfiles.length > 1 ? { lockfiles: archiveLockfiles } : {}),
    source: {
      kind: "archive",
      displayPath: input.source.displayPath,
      format: input.source.format,
      sha256: input.source.sha256,
      entryRoot: candidate.value.entryRoot || "."
    }
  };

  const graphs: SourcedDependencyGraph[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const archiveLockfile = selected[index]!;
    const projectLockfile = archiveLockfiles[index]!;
    const entryPath = joinArchivePath(
      candidate.value.entryRoot,
      syntheticRelativePath(archiveLockfile.path)
    );
    const text = input.source.readText(entryPath, LOCKFILE_MAX_BYTES);
    if (!text.ok) {
      return text;
    }

    const parseInput = buildParseInput({
      source: input.source,
      entryRoot: candidate.value.entryRoot,
      entryPath,
      projectRoot: syntheticRoot,
      lockfile: projectLockfile,
      text: text.value
    });
    if (!parseInput.ok) {
      return parseInput;
    }

    const parsed = parseLockfileTextForKind(parseInput.value);
    if (!parsed.ok) {
      return err(sanitizeArchiveParserError({
        error: parsed.error,
        source: input.source,
        entryRoot: candidate.value.entryRoot,
        syntheticRoot
      }));
    }
    graphs.push({
      graph: parsed.value,
      source: {
        lockfileKind: projectLockfile.kind,
        lockfilePath: projectLockfile.path
      }
    });
  }

  const graph = graphs.length === 1 ? graphs[0]!.graph : mergeDependencyGraphs(graphs);
  return ok({ project, graph });
}

export const archiveProjectFromSource = loadArchiveProject;

function selectCandidate(
  source: ArchiveSource,
  filePaths: readonly string[],
  work: ArchiveWorkBudget
): Result<Candidate, OhriskError> {
  const indexed = indexCandidateFiles(filePaths, work);
  if (!indexed.ok) return indexed;

  const candidates: Candidate[] = [];
  for (const [entryRoot, relativePaths] of indexed.value) {
    const checkpoint = work.checkpoint(entryRoot || undefined);
    if (!checkpoint.ok) return checkpoint;
    const syntheticRoot = syntheticArchiveRoot(source);
    const lockfiles = projectLockfilesFromRelativePaths({
      rootDir: syntheticRoot,
      relativePaths
    });
    if (lockfiles.length === 0 && relativePaths.has("package.json")) {
      lockfiles.push({
        kind: "package-json",
        path: path.join(syntheticRoot, "package.json")
      });
    }
    if (lockfiles.length > 0) {
      candidates.push({ entryRoot, lockfiles });
    }
  }

  const archiveRoot = candidates.find((candidate) => candidate.entryRoot === "");
  if (archiveRoot) {
    return ok(archiveRoot);
  }

  const candidateRoots = new Set(candidates.map((candidate) => candidate.entryRoot));
  const minimal: Candidate[] = [];
  for (const candidate of candidates) {
    const checkpoint = work.checkpoint(candidate.entryRoot || undefined);
    if (!checkpoint.ok) return checkpoint;
    if (!hasCandidateAncestor(candidate.entryRoot, candidateRoots)) {
      minimal.push(candidate);
    }
  }
  if (minimal.length === 0) {
    return noProjectError(source);
  }
  if (minimal.length > 1) {
    return err(createError({
      code: "ARCHIVE_MULTIPLE_PROJECTS",
      category: "unsupported_input",
      message: "The archive contains multiple independent supported projects.",
      details: {
        archive: source.displayPath,
        entryPath: minimal.map((candidate) => candidate.entryRoot).sort(codeUnitCompare).join(",")
      }
    }));
  }
  return ok(minimal[0]!);
}

function indexCandidateFiles(
  filePaths: readonly string[],
  work: ArchiveWorkBudget
): Result<Map<string, Set<string>>, OhriskError> {
  const indexed = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const checkpoint = work.checkpoint(filePath);
    if (!checkpoint.ok) return checkpoint;
    const segments = filePath.split("/");
    const fileName = segments.at(-1);
    if (!fileName) continue;

    addIndexedCandidate(indexed, segments.slice(0, -1).join("/"), fileName);
    addFixedSuffixCandidate(indexed, segments, ["gradle", "libs.versions.toml"]);
    addFixedSuffixCandidate(indexed, segments, ["obj", "project.assets.json"]);
    addFixedSuffixCandidate(indexed, segments, ["Packages", "packages-lock.json"]);

    if (
      segments.length >= 3
      && segments.at(-3) === "gradle"
      && segments.at(-2) === "dependency-locks"
      && fileName.toLowerCase().endsWith(".lockfile")
    ) {
      addSuffixCandidate(indexed, segments, 3);
    }

    if (
      segments.length >= 5
      && segments.at(-5)?.endsWith(".xcodeproj") === true
      && segments.slice(-4).join("/")
        === "project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
    ) {
      addSuffixCandidate(indexed, segments, 5);
    }
    if (
      segments.length >= 4
      && segments.at(-4)?.endsWith(".xcworkspace") === true
      && segments.slice(-3).join("/") === "xcshareddata/swiftpm/Package.resolved"
    ) {
      addSuffixCandidate(indexed, segments, 4);
    }
  }

  return ok(indexed);
}

function addFixedSuffixCandidate(
  indexed: Map<string, Set<string>>,
  segments: readonly string[],
  suffix: readonly string[]
): void {
  if (
    segments.length >= suffix.length
    && suffix.every((part, index) => segments[segments.length - suffix.length + index] === part)
  ) {
    addSuffixCandidate(indexed, segments, suffix.length);
  }
}

function addSuffixCandidate(
  indexed: Map<string, Set<string>>,
  segments: readonly string[],
  suffixLength: number
): void {
  addIndexedCandidate(
    indexed,
    segments.slice(0, -suffixLength).join("/"),
    segments.slice(-suffixLength).join("/")
  );
}

function addIndexedCandidate(
  indexed: Map<string, Set<string>>,
  entryRoot: string,
  relativePath: string
): void {
  const existing = indexed.get(entryRoot);
  if (existing) {
    existing.add(relativePath);
    return;
  }
  indexed.set(entryRoot, new Set([relativePath]));
}

function hasCandidateAncestor(entryRoot: string, candidateRoots: ReadonlySet<string>): boolean {
  let separator = entryRoot.lastIndexOf("/");
  while (separator >= 0) {
    const ancestor = entryRoot.slice(0, separator);
    if (candidateRoots.has(ancestor)) {
      return true;
    }
    separator = ancestor.lastIndexOf("/");
  }
  return candidateRoots.has("");
}

function buildParseInput(input: {
  source: ArchiveSource;
  entryRoot: string;
  entryPath: string;
  projectRoot: string;
  lockfile: ProjectLockfile;
  text: string;
}): Result<LockfileTextParseInput, OhriskError> {
  const directory = archiveDirname(input.entryPath);
  const fileEntries = new Set(
    input.source.entries
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path)
  );
  const optionalText = (
    name: string,
    maxBytes = PACKAGE_JSON_MAX_BYTES
  ): Result<string | undefined, OhriskError> =>
    readOptionalArchiveText(
      input.source,
      fileEntries,
      joinArchivePath(directory, name),
      maxBytes
    );
  const packageJson = optionalText("package.json");
  if (!packageJson.ok) return packageJson;
  const pnpmWorkspace = optionalText("pnpm-workspace.yaml");
  if (!pnpmWorkspace.ok) return pnpmWorkspace;
  const pyproject = optionalText("pyproject.toml");
  if (!pyproject.ok) return pyproject;
  const cargoManifest = optionalText("Cargo.toml");
  if (!cargoManifest.ok) return cargoManifest;
  const goSum = optionalText("go.sum", LOCKFILE_MAX_BYTES);
  if (!goSum.ok) return goSum;
  const composerJson = optionalText("composer.json");
  if (!composerJson.ok) return composerJson;
  const packageJsonPath = joinArchivePath(directory, "package.json");
  const directoryPackagesProps = findDirectoryPackagesProps(
    input.source,
    fileEntries,
    directory,
    input.entryRoot
  );
  if (!directoryPackagesProps.ok) return directoryPackagesProps;

  return ok({
    kind: input.lockfile.kind,
    text: input.text,
    lockfilePath: input.lockfile.path,
    projectRoot: input.projectRoot,
    packageJsonText: packageJson.value,
    packageJsonPath: syntheticCompanionPath(input.projectRoot, input.entryRoot, packageJsonPath),
    pnpmWorkspaceText: pnpmWorkspace.value,
    pnpmWorkspacePath: syntheticCompanionPath(
      input.projectRoot,
      input.entryRoot,
      joinArchivePath(directory, "pnpm-workspace.yaml")
    ),
    pyprojectText: pyproject.value,
    cargoManifestText: cargoManifest.value,
    cargoRootName: archiveBasename(input.entryRoot) || "archive-project",
    goSumText: goSum.value,
    goWorkDir: path.dirname(input.lockfile.path),
    composerJsonText: composerJson.value,
    ...(directoryPackagesProps.value ? {
      directoryPackagesPropsText: directoryPackagesProps.value.text,
      directoryPackagesPropsPath: syntheticCompanionPath(
        input.projectRoot,
        input.entryRoot,
        directoryPackagesProps.value.path
      )
    } : {}),
    dotnetProjectRootName: archiveBasename(input.entryRoot) || "archive-project",
    requirementsRootName: archiveBasename(input.entryRoot) || "archive-project",
    requirementsIncludedFileReader: ({ includePath, fromFilePath }) => {
      const fromEntry = syntheticToEntryPath(input.projectRoot, input.entryRoot, fromFilePath);
      const includedPath = normalizeArchiveRelativePath(archiveDirname(fromEntry), includePath);
      if (!includedPath || !isWithinArchiveRoot(includedPath, input.entryRoot)) {
        return err(createError({
          code: "REQUIREMENTS_READ_FAILED",
          category: "invalid_input",
          message: "A requirements include points outside the archive project root.",
          details: { includePath, fromFilePath }
        }));
      }
      const included = input.source.readText(includedPath, LOCKFILE_MAX_BYTES);
      return included.ok ? ok({ path: syntheticCompanionPath(
        input.projectRoot,
        input.entryRoot,
        includedPath
      ), text: included.value }) : included;
    },
    mavenProjectPomReader: ({ pomPath, fromPomPath }) => {
      const moduleEntryPath = syntheticToEntryPath(
        input.projectRoot,
        input.entryRoot,
        pomPath
      );
      if (!isWithinArchiveRoot(moduleEntryPath, input.entryRoot)) {
        return err(createError({
          code: "MAVEN_POM_PARSE_FAILED",
          category: "invalid_input",
          message: "A Maven module points outside the archive project root.",
          details: { lockfilePath: fromPomPath, modulePomPath: pomPath }
        }));
      }
      const modulePom = input.source.readText(moduleEntryPath, LOCKFILE_MAX_BYTES);
      return modulePom.ok
        ? ok({ path: pomPath, text: modulePom.value })
        : modulePom;
    }
  });
}

function findDirectoryPackagesProps(
  source: ArchiveSource,
  fileEntries: ReadonlySet<string>,
  startDir: string,
  entryRoot: string
): Result<{ path: string; text: string } | undefined, OhriskError> {
  let directory = startDir;
  while (isWithinArchiveRoot(directory, entryRoot)) {
    const candidate = joinArchivePath(directory, "Directory.Packages.props");
    if (fileEntries.has(candidate)) {
      const text = source.readText(candidate, PACKAGE_JSON_MAX_BYTES);
      if (!text.ok) return text;
      return ok({ path: candidate, text: text.value });
    }
    if (directory === entryRoot) {
      break;
    }
    directory = archiveDirname(directory);
  }
  return ok(undefined);
}

function readOptionalArchiveText(
  source: ArchiveSource,
  fileEntries: ReadonlySet<string>,
  entryPath: string,
  maxBytes: number
): Result<string | undefined, OhriskError> {
  if (!fileEntries.has(entryPath)) {
    return ok(undefined);
  }
  return source.readText(entryPath, maxBytes);
}

function syntheticArchiveRoot(source: ArchiveSource): string {
  return path.resolve(path.parse(process.cwd()).root, "__ohrisk_archive__", source.sha256);
}

function syntheticRelativePath(syntheticPath: string): string {
  const marker = `${path.sep}__ohrisk_archive__${path.sep}`;
  const markerIndex = syntheticPath.indexOf(marker);
  if (markerIndex < 0) {
    return syntheticPath.replace(/\\/g, "/");
  }
  const afterHash = syntheticPath.slice(markerIndex + marker.length).split(path.sep).slice(1);
  return afterHash.join("/");
}

function syntheticCompanionPath(root: string, entryRoot: string, entryPath: string): string {
  const relative = entryRoot === "" ? entryPath : entryPath.slice(entryRoot.length + 1);
  return path.join(root, ...relative.split("/"));
}

function syntheticToEntryPath(root: string, entryRoot: string, filePath: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, "/");
  return joinArchivePath(entryRoot, relative);
}

function joinArchivePath(left: string, right: string): string {
  return left === "" ? right : right === "" ? left : `${left}/${right}`;
}

function archiveDirname(entryPath: string): string {
  const index = entryPath.lastIndexOf("/");
  return index < 0 ? "" : entryPath.slice(0, index);
}

function archiveBasename(entryPath: string): string {
  const index = entryPath.lastIndexOf("/");
  return index < 0 ? entryPath : entryPath.slice(index + 1);
}

function normalizeArchiveRelativePath(fromDirectory: string, requestedPath: string): string | undefined {
  const parts = [...(fromDirectory ? fromDirectory.split("/") : []), ...requestedPath.replace(/\\/g, "/").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return undefined;
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

function isWithinArchiveRoot(entryPath: string, entryRoot: string): boolean {
  return entryRoot === "" || entryPath === entryRoot || entryPath.startsWith(`${entryRoot}/`);
}

function sanitizeArchiveParserError(input: {
  error: OhriskError;
  source: ArchiveSource;
  entryRoot: string;
  syntheticRoot: string;
}): OhriskError {
  const displayRoot = input.entryRoot === ""
    ? `${input.source.displayPath}!`
    : `${input.source.displayPath}!/${input.entryRoot}`;
  const replacements = [
    input.syntheticRoot,
    input.syntheticRoot.replace(/\\/g, "/"),
    input.syntheticRoot.replace(/\\/g, "\\\\")
  ];
  const sanitizeString = (value: string): string => {
    let sanitized = value;
    for (const syntheticPath of replacements) {
      sanitized = replaceLiteral(sanitized, syntheticPath, displayRoot);
    }
    sanitized = replaceLiteral(sanitized, input.source.sha256, input.source.displayPath);
    return sanitized
      .replaceAll(`${displayRoot}\\`, `${displayRoot}/`)
      .replaceAll(`${displayRoot}\\\\`, `${displayRoot}/`);
  };

  return createError({
    ...input.error,
    message: sanitizeString(input.error.message),
    ...(input.error.details ? {
      details: sanitizeArchiveErrorValue(input.error.details, sanitizeString) as Record<string, unknown>
    } : {})
  });
}

function sanitizeArchiveErrorValue(
  value: unknown,
  sanitizeString: (value: string) => string
): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArchiveErrorValue(item, sanitizeString));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        sanitizeString(key),
        sanitizeArchiveErrorValue(item, sanitizeString)
      ])
    );
  }
  return value;
}

function replaceLiteral(value: string, search: string, replacement: string): string {
  if (search === "") return value;
  return value.replace(new RegExp(escapeRegExp(search), "gi"), replacement);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function noProjectError(source: ArchiveSource): Result<never, OhriskError> {
  return err(createError({
    code: "ARCHIVE_NO_SUPPORTED_PROJECT",
    category: "unsupported_input",
    message: "The archive does not contain a supported project lockfile.",
    details: { archive: source.displayPath }
  }));
}
