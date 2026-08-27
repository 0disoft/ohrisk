import { Buffer } from "node:buffer";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  attachGitRefLocalNpmEvidence,
  hasGitRefLocalNpmPackage
} from "../evidence/git-ref-local-package";
import type {
  GitRefFileLister,
  GitRefFileReader
} from "../git/ref-file";
import { findNearestDirectoryPackagesPropsPath } from "../graph/dotnet-nuget-lock";
import type { GoSourceFile } from "../graph/go-mod";
import type { MavenExternalPomDocument } from "../graph/java-maven-pom";
import {
  findGoWorkModulePaths,
  type GoWorkModuleInput
} from "../graph/go-work";
import {
  findYarnWorkspacePackageJsonPaths,
  findYarnWorkspacePackageJsonPathsFromRelativePaths,
  type YarnWorkspacePackageJsonInput
} from "../graph/npm-yarn-lock";
import { parseLockfileTextForKind } from "../graph/project-lockfile";
import type { RequirementsIncludedFileReader } from "../graph/python-requirements";
import type { PythonLocalSourceFileReader } from "../graph/python-local-source";
import {
  findCargoWorkspaceMemberManifestPaths,
  findCargoWorkspaceMemberManifestPathsFromRelativePaths,
  readCargoWorkspaceEvidenceFromSnapshot
} from "../graph/rust-cargo-lock";
import {
  mergeDependencyGraphs,
  type SourcedDependencyGraph
} from "../graph/merge";
import type { DependencyGraph } from "../graph/types";
import type { DiffLockfileChanges } from "../report/diff-report";
import {
  projectLockfilesFromRelativePaths,
  type ProjectInput,
  type ProjectLockfile
} from "../project/discover";
import { createError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";

function readBaselineGoWorkModuleInputs(input: {
  project: ProjectInput;
  baselineRef: string;
  goWorkText: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<GoWorkModuleInput[] | undefined, OhriskError> {
  const modulePaths = findGoWorkModulePaths({
    goWorkText: input.goWorkText,
    goWorkPath: input.project.lockfile.path,
    projectRoot: input.project.rootDir
  });
  if (isErr(modulePaths)) {
    return modulePaths;
  }

  const modules: GoWorkModuleInput[] = [];
  for (const modulePath of modulePaths.value) {
    const goModText = input.readRefFile({
      projectRoot: input.project.rootDir,
      ref: input.baselineRef,
      relativePath: modulePath.goModRelativePath
    });
    if (isErr(goModText)) {
      return goModText;
    }

    const goSumText = readOptionalBaselineFile({
      projectRoot: input.project.rootDir,
      baselineRef: input.baselineRef,
      relativePath: modulePath.goSumRelativePath,
      readRefFile: input.readRefFile
    });
    if (isErr(goSumText)) {
      return goSumText;
    }

    const sourceFiles = input.baselineFiles
      ? readBaselineGoSourceFiles({
          projectRoot: input.project.rootDir,
          baselineRef: input.baselineRef,
          moduleRootRelativePath: path.posix.dirname(modulePath.goModRelativePath),
          baselineFiles: input.baselineFiles,
          readRefFile: input.readRefFile
        })
      : ok(undefined);
    if (isErr(sourceFiles)) {
      return sourceFiles;
    }

    modules.push({
      usePath: modulePath.usePath,
      moduleRootDir: modulePath.moduleRootDir,
      goModPath: `${input.baselineRef}:${modulePath.goModRelativePath}`,
      goModText: goModText.value,
      ...(goSumText.value ? { goSumText: goSumText.value } : {}),
      ...(sourceFiles.value ? { sourceFiles: sourceFiles.value } : {})
    });
  }

  return ok(modules);
}

const BASELINE_GO_SOURCE_FILE_LIMIT = 256;
const BASELINE_GO_SOURCE_MAX_DEPTH = 4;
const BASELINE_GO_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
const BASELINE_GO_IGNORED_DIRECTORIES = new Set([".git", "node_modules", "vendor"]);

function readBaselineGoSourceFiles(input: {
  projectRoot: string;
  baselineRef: string;
  moduleRootRelativePath: string;
  baselineFiles: ReadonlySet<string>;
  readRefFile: GitRefFileReader;
}): Result<GoSourceFile[] | undefined, OhriskError> {
  const moduleRoot = input.moduleRootRelativePath === "."
    ? ""
    : input.moduleRootRelativePath.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
  const prefix = moduleRoot === "" ? "" : `${moduleRoot}/`;
  const relativeFiles = [...input.baselineFiles]
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => prefix === "" || file.startsWith(prefix));
  const nestedModuleRoots = relativeFiles
    .filter((file) => file.endsWith("/go.mod"))
    .map((file) => file.slice(prefix.length, -"/go.mod".length))
    .filter((root) => root !== "");
  const candidates = relativeFiles
    .filter((file) => file.endsWith(".go"))
    .map((file) => ({ absoluteRelativePath: file, moduleRelativePath: file.slice(prefix.length) }))
    .filter(({ moduleRelativePath }) => {
      const segments = moduleRelativePath.split("/");
      return segments.length - 1 <= BASELINE_GO_SOURCE_MAX_DEPTH
        && !segments.some((segment) => BASELINE_GO_IGNORED_DIRECTORIES.has(segment))
        && !nestedModuleRoots.some((root) =>
          moduleRelativePath === root || moduleRelativePath.startsWith(`${root}/`)
        );
    })
    .sort((left, right) => left.moduleRelativePath.localeCompare(right.moduleRelativePath));
  if (candidates.length > BASELINE_GO_SOURCE_FILE_LIMIT) {
    return ok([]);
  }

  const sourceFiles: GoSourceFile[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const text = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.baselineRef,
      relativePath: candidate.absoluteRelativePath
    });
    if (isErr(text)) {
      return text;
    }
    totalBytes += Buffer.byteLength(text.value, "utf8");
    if (totalBytes > BASELINE_GO_SOURCE_MAX_BYTES) {
      return ok([]);
    }
    sourceFiles.push({ path: candidate.moduleRelativePath, text: text.value });
  }
  return ok(sourceFiles);
}

type BaselineProjectGraph = {
  graph: DependencyGraph;
  lockfiles: ProjectLockfile[];
};

export function loadBaselineProjectGraph(input: {
  currentProject: {
    project: ProjectInput;
    scanGraph: DependencyGraph;
  };
  baselineRef: string;
  allLockfiles: boolean;
  readRefFile: GitRefFileReader;
  listRefFiles: GitRefFileLister;
  workspaceRoot?: string;
  mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument>;
}): Result<BaselineProjectGraph, OhriskError> {
  const projectRoot = input.currentProject.project.rootDir;
  const evidenceSnapshotRoot = input.workspaceRoot ?? projectRoot;
  let baselineRelativePaths: string[] | undefined;
  let baselineLockfiles: ProjectLockfile[];

  if (input.allLockfiles) {
    const listed = input.listRefFiles({
      projectRoot,
      ref: input.baselineRef
    });
    if (isErr(listed)) {
      return listed;
    }

    baselineRelativePaths = listed.value;
    baselineLockfiles = projectLockfilesFromRelativePaths({
      rootDir: projectRoot,
      relativePaths: listed.value
    });

    if (baselineLockfiles.length === 0 && listed.value.includes("package.json")) {
      baselineLockfiles = [{
        kind: "package-json",
        path: path.join(projectRoot, "package.json")
      }];
    }
  } else {
    baselineLockfiles = [input.currentProject.project.lockfile];
    if (baselineLockfiles.some((lockfile) =>
      lockfile.kind === "go-mod"
      || lockfile.kind === "go-work"
      || lockfile.kind === "cargo-lock"
    )) {
      const listed = input.listRefFiles({
        projectRoot,
        ref: input.baselineRef
      });
      if (isErr(listed)) {
        return listed;
      }
      baselineRelativePaths = listed.value;
    }
  }

  if (baselineLockfiles.length === 0) {
    return ok({
      graph: {
        rootName: path.basename(projectRoot),
        lockfilePath: `${input.baselineRef}:<none>`,
        lockfilePaths: [],
        nodes: []
      },
      lockfiles: []
    });
  }

  const baselineFiles = baselineRelativePaths
    ? new Set(baselineRelativePaths.map((value) => value.replace(/\\/g, "/")))
    : undefined;
  let availableBaselineEvidenceFiles = evidenceSnapshotRoot === projectRoot
    ? baselineFiles
    : undefined;
  const graphs: SourcedDependencyGraph[] = [];

  for (const lockfile of baselineLockfiles) {
    const parsed = parseBaselineLockfileGraph({
      projectRoot,
      lockfile,
      baselineRef: input.baselineRef,
      readRefFile: input.readRefFile,
      rootNameHint: input.currentProject.scanGraph.rootName ?? path.basename(projectRoot),
      ...(input.mavenExternalPoms ? { mavenExternalPoms: input.mavenExternalPoms } : {}),
      ...(baselineFiles ? { baselineFiles } : {})
    });
    if (isErr(parsed)) {
      return parsed;
    }

    let graph = parsed.value;
    if (hasGitRefLocalNpmPackage(graph)) {
      if (!availableBaselineEvidenceFiles) {
        const listed = input.listRefFiles({
          projectRoot: evidenceSnapshotRoot,
          ref: input.baselineRef
        });
        if (isErr(listed)) {
          return listed;
        }
        availableBaselineEvidenceFiles = new Set(
          listed.value.map((value) => value.replace(/\\/g, "/"))
        );
      }

      const withLocalEvidence = attachGitRefLocalNpmEvidence({
        graph,
        lockfileRelativePath: projectRelativeLockfilePath(projectRoot, lockfile.path),
        baselineRef: input.baselineRef,
        baselineFiles: availableBaselineEvidenceFiles,
        projectRoot,
        snapshotRoot: evidenceSnapshotRoot,
        readRefFile: input.readRefFile
      });
      if (isErr(withLocalEvidence)) {
        return withLocalEvidence;
      }
      graph = withLocalEvidence.value;
    }

    graphs.push({
      graph,
      source: {
        lockfileKind: lockfile.kind,
        lockfilePath: projectRelativeLockfilePath(projectRoot, lockfile.path)
      }
    });
  }

  return ok({
    graph: graphs.length === 1
      ? graphs[0]!.graph
      : mergeDependencyGraphs(graphs),
    lockfiles: baselineLockfiles
  });
}

function parseBaselineLockfileGraph(input: {
  projectRoot: string;
  lockfile: ProjectLockfile;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  rootNameHint: string;
  baselineFiles?: ReadonlySet<string>;
  mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument>;
}): Result<DependencyGraph, OhriskError> {
  const relativeLockfilePath = projectRelativeLockfilePath(
    input.projectRoot,
    input.lockfile.path
  );
  const project: ProjectInput = {
    rootDir: input.projectRoot,
    lockfile: input.lockfile
  };
  const baselineLockfile = readBaselinePrimaryLockfile({
    projectRoot: input.projectRoot,
    lockfilePath: input.lockfile.path,
    ref: input.baselineRef,
    relativePath: relativeLockfilePath,
    readRefFile: input.readRefFile,
    ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
  });
  if (isErr(baselineLockfile)) {
    return baselineLockfile;
  }

  const lockfileDirectory = path.posix.dirname(relativeLockfilePath);
  const relativeCompanionPath = (filename: string): string =>
    lockfileDirectory === "." ? filename : `${lockfileDirectory}/${filename}`;
  const packageJsonRelativePath = relativeCompanionPath("package.json");
  const baselinePackageJson = input.lockfile.kind === "yarn-lock"
    ? input.readRefFile({
        projectRoot: input.projectRoot,
        ref: input.baselineRef,
        relativePath: packageJsonRelativePath
      })
    : undefined;
  if (baselinePackageJson && isErr(baselinePackageJson)) {
    return baselinePackageJson;
  }

  const baselineWorkspacePackageJsons = baselinePackageJson && !isErr(baselinePackageJson)
    ? readBaselineYarnWorkspacePackageJsons({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        rootPackageJsonText: baselinePackageJson.value,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok([]);
  if (isErr(baselineWorkspacePackageJsons)) {
    return baselineWorkspacePackageJsons;
  }

  const pnpmWorkspaceRelativePath = relativeCompanionPath("pnpm-workspace.yaml");
  const baselinePnpmWorkspace = input.lockfile.kind === "pnpm-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: pnpmWorkspaceRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselinePnpmWorkspace)) {
    return baselinePnpmWorkspace;
  }

  const pyprojectRelativePath = relativeCompanionPath("pyproject.toml");
  const baselinePyproject = (
    input.lockfile.kind === "pdm-lock"
    || input.lockfile.kind === "poetry-lock"
  )
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: pyprojectRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselinePyproject)) {
    return baselinePyproject;
  }

  const cargoManifestRelativePath = relativeCompanionPath("Cargo.toml");
  const baselineCargoManifest = input.lockfile.kind === "cargo-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: cargoManifestRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineCargoManifest)) {
    return baselineCargoManifest;
  }

  const baselineCargoMemberManifests = input.lockfile.kind === "cargo-lock"
    && baselineCargoManifest.value
    ? readBaselineCargoMemberManifests({
        project,
        baselineRef: input.baselineRef,
        rootManifestText: baselineCargoManifest.value,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok(undefined);
  if (isErr(baselineCargoMemberManifests)) {
    return baselineCargoMemberManifests;
  }

  const baselineCargoManifestEvidence = input.lockfile.kind === "cargo-lock"
    && input.baselineFiles
    ? readCargoWorkspaceEvidenceFromSnapshot({
        directoryRelativePath: lockfileDirectory,
        relativePaths: input.baselineFiles,
        readFile: (relativePath) => input.readRefFile({
          projectRoot: input.projectRoot,
          ref: input.baselineRef,
          relativePath
        })
      })
    : undefined;
  const baselineCargoMemberManifestEvidence = input.lockfile.kind === "cargo-lock"
    && input.baselineFiles
    ? (baselineCargoMemberManifests.value ?? []).map((manifest) =>
        readCargoWorkspaceEvidenceFromSnapshot({
          directoryRelativePath: path.posix.dirname(manifest.relativeManifestPath),
          relativePaths: input.baselineFiles!,
          readFile: (relativePath) => input.readRefFile({
            projectRoot: input.projectRoot,
            ref: input.baselineRef,
            relativePath
          })
        })
      )
    : undefined;

  const goSumRelativePath = relativeCompanionPath("go.sum");
  const baselineGoSum = input.lockfile.kind === "go-mod"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: goSumRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineGoSum)) {
    return baselineGoSum;
  }

  const baselineGoSourceFiles = input.lockfile.kind === "go-mod" && input.baselineFiles
    ? readBaselineGoSourceFiles({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        moduleRootRelativePath: lockfileDirectory,
        baselineFiles: input.baselineFiles,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineGoSourceFiles)) {
    return baselineGoSourceFiles;
  }

  const baselineGoWorkModules = input.lockfile.kind === "go-work"
    ? readBaselineGoWorkModuleInputs({
        project,
        baselineRef: input.baselineRef,
        goWorkText: baselineLockfile.value,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok(undefined);
  if (isErr(baselineGoWorkModules)) {
    return baselineGoWorkModules;
  }

  const composerJsonRelativePath = relativeCompanionPath("composer.json");
  const baselineComposerJson = input.lockfile.kind === "composer-lock"
    ? readOptionalBaselineFile({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        relativePath: composerJsonRelativePath,
        readRefFile: input.readRefFile
      })
    : ok(undefined);
  if (isErr(baselineComposerJson)) {
    return baselineComposerJson;
  }

  const baselineDirectoryPackagesProps = input.lockfile.kind === "dotnet-project"
    ? readBaselineDirectoryPackagesProps({
        project,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile,
        ...(input.baselineFiles ? { baselineFiles: input.baselineFiles } : {})
      })
    : ok(undefined);
  if (isErr(baselineDirectoryPackagesProps)) {
    return baselineDirectoryPackagesProps;
  }

  const baselinePythonLocalSourceErrors = baselinePythonLocalSourceErrorsForKind(
    input.lockfile.kind
  );
  const baselineRequirementsReader = input.lockfile.kind === "requirements-txt"
    ? createBaselineRequirementsIncludedFileReader({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile
      })
    : undefined;
  const baselinePythonSourceReader = baselinePythonLocalSourceErrors
    ? createBaselinePythonLocalSourceFileReader({
        projectRoot: input.projectRoot,
        baselineRef: input.baselineRef,
        readRefFile: input.readRefFile,
        errors: baselinePythonLocalSourceErrors
      })
    : undefined;

  return parseLockfileTextForKind({
    kind: input.lockfile.kind,
    text: baselineLockfile.value,
    lockfilePath: baselineLockfilePathForKind({
      kind: input.lockfile.kind,
      rootName: input.rootNameHint,
      relativeLockfilePath,
      baselineRef: input.baselineRef
    }),
    ...(baselinePackageJson?.value ? { packageJsonText: baselinePackageJson.value } : {}),
    packageJsonPath: `${input.baselineRef}:${packageJsonRelativePath}`,
    ...(baselineWorkspacePackageJsons.value.length > 0
      ? { workspacePackageJsonTexts: baselineWorkspacePackageJsons.value }
      : {}),
    ...(baselinePnpmWorkspace.value ? { pnpmWorkspaceText: baselinePnpmWorkspace.value } : {}),
    pnpmWorkspacePath: `${input.baselineRef}:${pnpmWorkspaceRelativePath}`,
    ...(baselinePyproject.value ? { pyprojectText: baselinePyproject.value } : {}),
    ...(baselineCargoManifest.value ? { cargoManifestText: baselineCargoManifest.value } : {}),
    ...(baselineCargoMemberManifests.value?.length
      ? { cargoMemberManifestTexts: baselineCargoMemberManifests.value.map((item) => item.text) }
      : {}),
    ...(baselineCargoManifestEvidence
      ? { cargoManifestEvidence: baselineCargoManifestEvidence }
      : {}),
    ...(baselineCargoMemberManifestEvidence?.length
      ? { cargoMemberManifestEvidence: baselineCargoMemberManifestEvidence }
      : {}),
    ...(input.lockfile.kind === "cargo-lock"
      ? { cargoRootName: input.rootNameHint }
      : {}),
    ...(baselineGoSum.value ? { goSumText: baselineGoSum.value } : {}),
    ...(baselineGoSourceFiles.value ? { goSourceFiles: baselineGoSourceFiles.value } : {}),
    ...(baselineGoWorkModules.value?.length
      ? { goWorkModuleInputs: baselineGoWorkModules.value }
      : {}),
    goWorkDir: path.dirname(input.lockfile.path),
    ...(baselineComposerJson.value ? { composerJsonText: baselineComposerJson.value } : {}),
    ...(baselineDirectoryPackagesProps.value?.text
      ? { directoryPackagesPropsText: baselineDirectoryPackagesProps.value.text }
      : {}),
    ...(baselineDirectoryPackagesProps.value?.path
      ? { directoryPackagesPropsPath: baselineDirectoryPackagesProps.value.path }
      : {}),
    ...(input.lockfile.kind === "dotnet-project"
      ? { dotnetProjectRootName: input.rootNameHint }
      : {}),
    projectRoot: input.projectRoot,
    requirementsRootName: input.rootNameHint,
    ...(baselineRequirementsReader
      ? { requirementsIncludedFileReader: baselineRequirementsReader }
      : {}),
    ...(baselinePythonSourceReader
      ? { pythonLocalSourceFileReader: baselinePythonSourceReader }
      : {}),
    ...(input.mavenExternalPoms ? { mavenExternalPoms: input.mavenExternalPoms } : {})
  });
}

export function buildDiffLockfileChanges(input: {
  projectRoot: string;
  currentLockfiles: ProjectLockfile[];
  baselineLockfiles: ProjectLockfile[];
}): DiffLockfileChanges {
  const current = normalizeDiffLockfiles(input.projectRoot, input.currentLockfiles);
  const baseline = normalizeDiffLockfiles(input.projectRoot, input.baselineLockfiles);
  const currentKeys = new Set(current.map(diffLockfileKey));
  const baselineKeys = new Set(baseline.map(diffLockfileKey));

  return {
    current,
    baseline,
    added: current.filter((lockfile) => !baselineKeys.has(diffLockfileKey(lockfile))),
    removed: baseline.filter((lockfile) => !currentKeys.has(diffLockfileKey(lockfile)))
  };
}

function normalizeDiffLockfiles(
  projectRoot: string,
  lockfiles: ProjectLockfile[]
): DiffLockfileChanges["current"] {
  const byKey = new Map<string, DiffLockfileChanges["current"][number]>();
  for (const lockfile of lockfiles) {
    const normalized = {
      kind: lockfile.kind,
      path: projectRelativeLockfilePath(projectRoot, lockfile.path)
    };
    byKey.set(diffLockfileKey(normalized), normalized);
  }
  return [...byKey.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)
  );
}

function diffLockfileKey(lockfile: DiffLockfileChanges["current"][number]): string {
  return `${lockfile.kind}\0${lockfile.path}`;
}

function projectRelativeLockfilePath(projectRoot: string, lockfilePath: string): string {
  const relativePath = path.relative(projectRoot, lockfilePath).replace(/\\/g, "/");
  return relativePath === "" ? path.basename(lockfilePath) : relativePath;
}


function readBaselinePrimaryLockfile(input: {
  projectRoot: string;
  lockfilePath: string;
  ref: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<string, OhriskError> {
  if (isGradleDependencyLocksDirectory(input.lockfilePath)) {
    return readBaselineGradleDependencyLocksDirectory(input);
  }

  return input.readRefFile({
    projectRoot: input.projectRoot,
    ref: input.ref,
    relativePath: input.relativePath
  });
}

function readBaselineGradleDependencyLocksDirectory(input: {
  projectRoot: string;
  lockfilePath: string;
  ref: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<string, OhriskError> {
  let entries: string[];
  try {
    if (input.baselineFiles) {
      const normalizedDirectory = input.relativePath.replace(/\\/g, "/").replace(/\/$/, "");
      const prefix = `${normalizedDirectory}/`;
      entries = [...input.baselineFiles]
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length))
        .filter((entry) => !entry.includes("/") && entry.toLowerCase().endsWith(".lockfile"))
        .sort();
    } else {
      entries = readdirSync(input.lockfilePath)
        .filter((entry) => entry.toLowerCase().endsWith(".lockfile"))
        .filter((entry) => isFile(path.join(input.lockfilePath, entry)))
        .sort();
    }
  } catch (cause) {
    return err(createError({
      code: "GRADLE_LOCK_READ_FAILED",
      category: "filesystem",
      message: "Failed to read Gradle dependency locks directory.",
      details: {
        lockfilePath: input.lockfilePath,
        cause: cause instanceof Error ? cause.message : String(cause)
      }
    }));
  }

  const texts: string[] = [];
  let firstMissingFile: OhriskError | undefined;
  for (const entry of entries) {
    const result = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.ref,
      relativePath: `${input.relativePath.replace(/\\/g, "/").replace(/\/$/, "")}/${entry}`
    });

    if (isErr(result)) {
      if (result.error.code === "GIT_REF_FILE_NOT_FOUND") {
        firstMissingFile ??= result.error;
        continue;
      }

      return result;
    }

    texts.push(result.value);
  }

  if (texts.length === 0) {
    return firstMissingFile
      ? err(firstMissingFile)
      : err(createError({
          code: "GRADLE_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse Gradle dependency locks directory. Ohrisk expected at least one *.lockfile.",
          details: {
            lockfilePath: input.lockfilePath,
            reason: "no_lockfiles"
          }
        }));
  }

  return ok(texts.join("\n"));
}

function baselineLockfilePathForKind(input: {
  kind: ProjectInput["lockfile"]["kind"];
  rootName: string;
  relativeLockfilePath: string;
  baselineRef: string;
}): string {
  return input.kind === "gradle-lock"
    ? path.join(input.rootName, input.relativeLockfilePath)
    : `${input.baselineRef}:${input.relativeLockfilePath}`;
}

function readBaselineCargoMemberManifests(input: {
  project: ProjectInput;
  baselineRef: string;
  rootManifestText: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<Array<{
  text: string;
  relativeManifestPath: string;
}> | undefined, OhriskError> {
  const memberManifestPaths = input.baselineFiles
    ? findCargoWorkspaceMemberManifestPathsFromRelativePaths({
        rootManifestText: input.rootManifestText,
        lockfilePath: input.project.lockfile.path,
        projectRoot: input.project.rootDir,
        relativePaths: input.baselineFiles
      })
    : findCargoWorkspaceMemberManifestPaths({
        rootManifestText: input.rootManifestText,
        lockfilePath: input.project.lockfile.path,
        projectRoot: input.project.rootDir
      });
  const manifests: Array<{
    text: string;
    relativeManifestPath: string;
  }> = [];

  for (const memberManifestPath of memberManifestPaths) {
    const manifestText = readOptionalBaselineFile({
      projectRoot: input.project.rootDir,
      baselineRef: input.baselineRef,
      relativePath: memberManifestPath.relativeManifestPath,
      readRefFile: input.readRefFile
    });
    if (isErr(manifestText)) {
      return manifestText;
    }

    if (manifestText.value !== undefined) {
      manifests.push({
        text: manifestText.value,
        relativeManifestPath: memberManifestPath.relativeManifestPath
      });
    }
  }

  return ok(manifests);
}

function readBaselineYarnWorkspacePackageJsons(input: {
  projectRoot: string;
  baselineRef: string;
  rootPackageJsonText: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<YarnWorkspacePackageJsonInput[], OhriskError> {
  const rootPackageJson = tryParseObject(input.rootPackageJsonText);
  if (!rootPackageJson) {
    return ok([]);
  }

  const packageJsons: YarnWorkspacePackageJsonInput[] = [];
  const workspacePackageJsonPaths = input.baselineFiles
    ? findYarnWorkspacePackageJsonPathsFromRelativePaths({
        projectRoot: input.projectRoot,
        workspaces: rootPackageJson.workspaces,
        relativePaths: input.baselineFiles
      })
    : findYarnWorkspacePackageJsonPaths({
        projectRoot: input.projectRoot,
        workspaces: rootPackageJson.workspaces
      });
  for (const workspacePackageJsonPath of workspacePackageJsonPaths) {
    const baselinePackageJson = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.baselineRef,
      relativePath: workspacePackageJsonPath.relativePackageJsonPath
    });
    if (isErr(baselinePackageJson)) {
      if (baselinePackageJson.error.code === "GIT_REF_FILE_NOT_FOUND") {
        continue;
      }

      return baselinePackageJson;
    }

    packageJsons.push({
      packageJsonText: baselinePackageJson.value,
      packageJsonPath: `${input.baselineRef}:${workspacePackageJsonPath.relativePackageJsonPath}`,
      workspacePath: workspacePackageJsonPath.workspacePath
    });
  }

  return ok(packageJsons);
}

function createBaselineRequirementsIncludedFileReader(input: {
  projectRoot: string;
  baselineRef: string;
  readRefFile: GitRefFileReader;
}): RequirementsIncludedFileReader {
  return ({ includePath, fromFilePath, directive }) => {
    if (path.isAbsolute(includePath)) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Absolute nested requirement or constraint paths are not supported.",
          details: {
            lockfilePath: fromFilePath,
            includePath,
            directive
          }
        })
      );
    }

    const fromRelativePath = stripBaselineRefPrefix(fromFilePath, input.baselineRef);
    const includedRelativePath = normalizeBaselineRelativePath(
      path.join(path.dirname(fromRelativePath), includePath)
    );

    if (!includedRelativePath) {
      return err(
        createError({
          code: "REQUIREMENTS_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse requirements.txt. Nested requirement or constraint paths must stay inside the requirements root.",
          details: {
            lockfilePath: fromFilePath,
            includePath,
            directive
          }
        })
      );
    }

    const included = input.readRefFile({
      projectRoot: input.projectRoot,
      ref: input.baselineRef,
      relativePath: includedRelativePath
    });

    if (isErr(included)) {
      return err(included.error);
    }

    return ok({
      path: `${input.baselineRef}:${includedRelativePath}`,
      text: included.value
    });
  };
}

type BaselinePythonLocalSourceErrors = {
  parseCode: OhriskError["code"];
  displayName: string;
};

function baselinePythonLocalSourceErrorsForKind(
  kind: ProjectInput["lockfile"]["kind"]
): BaselinePythonLocalSourceErrors | undefined {
  switch (kind) {
    case "requirements-txt":
      return {
        parseCode: "REQUIREMENTS_PARSE_FAILED",
        displayName: "requirements.txt"
      };
    case "pipfile-lock":
      return {
        parseCode: "PIPFILE_LOCK_PARSE_FAILED",
        displayName: "Pipfile.lock"
      };
    case "pdm-lock":
      return {
        parseCode: "PDM_LOCK_PARSE_FAILED",
        displayName: "pdm.lock"
      };
    case "uv-lock":
      return {
        parseCode: "UV_LOCK_PARSE_FAILED",
        displayName: "uv.lock"
      };
    case "pylock":
      return {
        parseCode: "PYLOCK_PARSE_FAILED",
        displayName: "pylock.toml"
      };
    default:
      return undefined;
  }
}

function createBaselinePythonLocalSourceFileReader(input: {
  projectRoot: string;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  errors: BaselinePythonLocalSourceErrors;
}): PythonLocalSourceFileReader {
  return ({ sourcePath, relativeFilePath, fromFilePath }) => {
    if (path.isAbsolute(sourcePath)) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Absolute local source paths are not supported.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    const fromRelativePath = stripBaselineRefPrefix(fromFilePath, input.baselineRef);
    const sourceRelativePath = normalizeBaselineRelativePath(
      path.join(path.dirname(fromRelativePath), sourcePath)
    );

    if (!sourceRelativePath) {
      return err(
        createError({
          code: input.errors.parseCode,
          category: "unsupported_input",
          message: `Failed to parse ${input.errors.displayName}. Local source paths must stay inside the project root.`,
          details: {
            lockfilePath: fromFilePath,
            sourcePath,
            relativeFilePath
          }
        })
      );
    }

    const sourceFileRelativePath = normalizeBaselineRelativePath(
      path.join(sourceRelativePath, relativeFilePath)
    );

    if (!sourceFileRelativePath) {
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

    const sourceFile = readOptionalBaselineFile({
      projectRoot: input.projectRoot,
      baselineRef: input.baselineRef,
      relativePath: sourceFileRelativePath,
      readRefFile: input.readRefFile
    });

    if (isErr(sourceFile)) {
      return sourceFile;
    }

    return ok(sourceFile.value === undefined
      ? undefined
      : {
          path: `${input.baselineRef}:${sourceFileRelativePath}`,
          text: sourceFile.value
        });
  };
}

function stripBaselineRefPrefix(filePath: string, baselineRef: string): string {
  const prefix = `${baselineRef}:`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function normalizeBaselineRelativePath(relativePath: string): string | undefined {
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) {
    return undefined;
  }

  return normalized;
}

function isGradleDependencyLocksDirectory(lockfilePath: string): boolean {
  const segments = path.normalize(lockfilePath).split(path.sep);
  return segments.length >= 2
    && segments[segments.length - 1] === "dependency-locks"
    && segments[segments.length - 2] === "gradle";
}

function findBaselineDirectoryPackagesPropsPath(input: {
  projectRoot: string;
  projectFilePath: string;
  baselineFiles: ReadonlySet<string>;
}): string | undefined {
  let current = path.posix.dirname(projectRelativeLockfilePath(
    input.projectRoot,
    input.projectFilePath
  ));

  while (true) {
    const candidate = current === "."
      ? "Directory.Packages.props"
      : `${current}/Directory.Packages.props`;
    if (input.baselineFiles.has(candidate)) {
      return candidate;
    }
    if (current === ".") {
      return undefined;
    }
    const parent = path.posix.dirname(current);
    current = parent === current ? "." : parent;
  }
}

function readBaselineDirectoryPackagesProps(input: {
  project: ProjectInput;
  baselineRef: string;
  readRefFile: GitRefFileReader;
  baselineFiles?: ReadonlySet<string>;
}): Result<{ path: string; text: string } | undefined, OhriskError> {
  const relativePath = input.baselineFiles
    ? findBaselineDirectoryPackagesPropsPath({
        projectRoot: input.project.rootDir,
        projectFilePath: input.project.lockfile.path,
        baselineFiles: input.baselineFiles
      })
    : normalizeBaselineRelativePath(
        path.relative(
          input.project.rootDir,
          findNearestDirectoryPackagesPropsPath(input.project.lockfile.path) ?? ""
        )
      );

  if (!relativePath) {
    return ok(undefined);
  }

  const baselineProps = readOptionalBaselineFile({
    projectRoot: input.project.rootDir,
    baselineRef: input.baselineRef,
    relativePath,
    readRefFile: input.readRefFile
  });

  if (isErr(baselineProps)) {
    return baselineProps;
  }

  return ok(baselineProps.value === undefined
    ? undefined
    : {
        path: `${input.baselineRef}:${relativePath}`,
        text: baselineProps.value
      });
}

function readOptionalBaselineFile(input: {
  projectRoot: string;
  baselineRef: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
}): Result<string | undefined, OhriskError> {
  const result = input.readRefFile({
    projectRoot: input.projectRoot,
    ref: input.baselineRef,
    relativePath: input.relativePath
  });

  if (!isErr(result)) {
    return ok(result.value);
  }

  if (result.error.code === "GIT_REF_FILE_NOT_FOUND") {
    return ok(undefined);
  }

  return err(result.error);
}

function tryParseObject(input: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isFile(pathname: string): boolean {
  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}
