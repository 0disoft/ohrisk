#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, type CliCommand, type HelpTarget } from "./args";
import { OHRISK_VERSION } from "./version";
import { diffRiskFindings } from "../diff/compare";
import { collectGraphEvidence } from "../evidence/collect";
import type { LicenseEvidence } from "../evidence/types";
import { readGitRefFile, type GitRefFileReader } from "../git/ref-file";
import { parseCycloneDxJsonFile, parseCycloneDxJsonText } from "../graph/cyclonedx-json";
import { parseNugetLockfile, parseNugetLockText } from "../graph/dotnet-nuget-lock";
import { parseDenoLockfile, parseDenoLockText } from "../graph/deno-lock";
import { parseGoModFile, parseGoModText } from "../graph/go-mod";
import { parseGradleLockfile, parseGradleLockText } from "../graph/java-gradle-lock";
import { parseMavenPomFile, parseMavenPomText } from "../graph/java-maven-pom";
import { parseBunLockfile, parseBunLockText } from "../graph/npm-bun-lock";
import { parsePackageLockfile, parsePackageLockText } from "../graph/npm-package-lock";
import { parsePnpmLockfile, parsePnpmLockText } from "../graph/npm-pnpm-lock";
import {
  findYarnWorkspacePackageJsonPaths,
  parseYarnLockfile,
  parseYarnLockText,
  type YarnWorkspacePackageJsonInput
} from "../graph/npm-yarn-lock";
import { parsePdmLockfile, parsePdmLockText } from "../graph/python-pdm-lock";
import { parsePipfileLockfile, parsePipfileLockText } from "../graph/python-pipfile-lock";
import { parsePoetryLockfile, parsePoetryLockText } from "../graph/python-poetry-lock";
import {
  parseRequirementsFile,
  parseRequirementsText,
  type RequirementsIncludedFileReader
} from "../graph/python-requirements";
import { parseUvLockfile, parseUvLockText } from "../graph/python-uv-lock";
import { parseGemfileLockfile, parseGemfileLockText } from "../graph/ruby-gemfile-lock";
import { parseComposerLockfile, parseComposerLockText } from "../graph/php-composer-lock";
import { parseCargoLockfile, parseCargoLockText } from "../graph/rust-cargo-lock";
import { parseSpdxJsonFile, parseSpdxJsonText } from "../graph/spdx-json";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { normalizeAllLicenseEvidence, normalizeLicenseEvidence } from "../license/normalize";
import { evaluateLicenseRisk, evaluateLicenseRisks } from "../policy/evaluate";
import { hasFindingAtOrAbove } from "../policy/severity";
import { applyRiskWaivers, readRiskWaivers } from "../policy/waivers";
import { renderCycloneDxReport } from "../report/cyclonedx-report";
import { renderDiffReport } from "../report/diff-report";
import { renderExplainReport } from "../report/explain-report";
import { renderSarifReport } from "../report/sarif-report";
import { renderScanReport } from "../report/scan-report";
import { writeReportFile, type ReportWriter } from "../report/write-output";
import { discoverProject, type ProjectInput } from "../project/discover";
import { exitCodeForError, formatError, type OhriskError } from "../shared/errors";
import { err, isErr, ok, type Result } from "../shared/result";

export type CliIO = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readRefFile?: GitRefFileReader;
  writeReport?: ReportWriter;
};

export async function main(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIO()
): Promise<number> {
  const parsed = parseArgs(argv);

  if (isErr(parsed)) {
    io.stderr(formatError(parsed.error));
    return exitCodeForError(parsed.error);
  }

  const command = parsed.value;

  switch (command.kind) {
    case "help":
      io.stdout(renderHelp(command.target));
      return 0;
    case "version":
      io.stdout(renderVersion());
      return 0;
    case "scan":
      return runScan(command, io);
    case "ci":
      return runScan(command, io);
    case "diff":
      return runDiff(command, io);
    case "explain":
      return runExplain(command, io);
  }
}

async function runDiff(
  command: Extract<CliCommand, { kind: "diff" }>,
  io: CliIO
): Promise<number> {
  const currentProject = loadProjectGraph({
    cwd: io.cwd,
    lockfilePath: command.lockfilePath,
    prodOnly: command.prodOnly
  });

  if (isErr(currentProject)) {
    io.stderr(formatError(currentProject.error));
    return exitCodeForError(currentProject.error);
  }

  const relativeLockfilePath = path.relative(
    currentProject.value.project.rootDir,
    currentProject.value.project.lockfile.path
  );
  const readRefFile = io.readRefFile ?? readGitRefFile;
  const baselineLockfile = readRefFile({
    projectRoot: currentProject.value.project.rootDir,
    ref: command.baselineRef,
    relativePath: relativeLockfilePath
  });

  if (isErr(baselineLockfile)) {
    io.stderr(formatError(baselineLockfile.error));
    return exitCodeForError(baselineLockfile.error);
  }

  const baselinePackageJson = currentProject.value.project.lockfile.kind === "yarn-lock"
    ? readRefFile({
        projectRoot: currentProject.value.project.rootDir,
        ref: command.baselineRef,
        relativePath: "package.json"
      })
    : undefined;

  if (baselinePackageJson && isErr(baselinePackageJson)) {
    io.stderr(formatError(baselinePackageJson.error));
    return exitCodeForError(baselinePackageJson.error);
  }

  const baselineWorkspacePackageJsons = baselinePackageJson && !isErr(baselinePackageJson)
    ? readBaselineYarnWorkspacePackageJsons({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        rootPackageJsonText: baselinePackageJson.value,
        readRefFile
      })
    : ok([]);

  if (isErr(baselineWorkspacePackageJsons)) {
    io.stderr(formatError(baselineWorkspacePackageJsons.error));
    return exitCodeForError(baselineWorkspacePackageJsons.error);
  }

  const baselinePnpmWorkspace = currentProject.value.project.lockfile.kind === "pnpm-lock"
    ? readOptionalBaselineFile({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        relativePath: "pnpm-workspace.yaml",
        readRefFile
      })
    : ok(undefined);

  if (isErr(baselinePnpmWorkspace)) {
    io.stderr(formatError(baselinePnpmWorkspace.error));
    return exitCodeForError(baselinePnpmWorkspace.error);
  }

  const baselinePyproject = (
    currentProject.value.project.lockfile.kind === "pdm-lock"
    || currentProject.value.project.lockfile.kind === "poetry-lock"
  )
    ? readOptionalBaselineFile({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        relativePath: "pyproject.toml",
        readRefFile
      })
    : ok(undefined);

  if (isErr(baselinePyproject)) {
    io.stderr(formatError(baselinePyproject.error));
    return exitCodeForError(baselinePyproject.error);
  }

  const baselineCargoManifest = currentProject.value.project.lockfile.kind === "cargo-lock"
    ? readOptionalBaselineFile({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        relativePath: "Cargo.toml",
        readRefFile
      })
    : ok(undefined);

  if (isErr(baselineCargoManifest)) {
    io.stderr(formatError(baselineCargoManifest.error));
    return exitCodeForError(baselineCargoManifest.error);
  }

  const baselineGoSum = currentProject.value.project.lockfile.kind === "go-mod"
    ? readOptionalBaselineFile({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        relativePath: "go.sum",
        readRefFile
      })
    : ok(undefined);

  if (isErr(baselineGoSum)) {
    io.stderr(formatError(baselineGoSum.error));
    return exitCodeForError(baselineGoSum.error);
  }

  const baselineComposerJson = currentProject.value.project.lockfile.kind === "composer-lock"
    ? readOptionalBaselineFile({
        projectRoot: currentProject.value.project.rootDir,
        baselineRef: command.baselineRef,
        relativePath: "composer.json",
        readRefFile
      })
    : ok(undefined);

  if (isErr(baselineComposerJson)) {
    io.stderr(formatError(baselineComposerJson.error));
    return exitCodeForError(baselineComposerJson.error);
  }

  const baselineGraph = parseLockfileTextForKind({
    kind: currentProject.value.project.lockfile.kind,
    text: baselineLockfile.value,
    lockfilePath: `${command.baselineRef}:${relativeLockfilePath}`,
    packageJsonText: baselinePackageJson?.value,
    packageJsonPath: `${command.baselineRef}:package.json`,
    workspacePackageJsonTexts: baselineWorkspacePackageJsons.value,
    pnpmWorkspaceText: baselinePnpmWorkspace.value,
    pnpmWorkspacePath: `${command.baselineRef}:pnpm-workspace.yaml`,
    pyprojectText: baselinePyproject.value,
    cargoManifestText: baselineCargoManifest.value,
    goSumText: baselineGoSum.value,
    composerJsonText: baselineComposerJson.value,
    requirementsRootName: currentProject.value.scanGraph.rootName,
    requirementsIncludedFileReader: currentProject.value.project.lockfile.kind === "requirements-txt"
      ? createBaselineRequirementsIncludedFileReader({
          projectRoot: currentProject.value.project.rootDir,
          baselineRef: command.baselineRef,
          readRefFile
        })
      : undefined
  });

  if (isErr(baselineGraph)) {
    io.stderr(formatError(baselineGraph.error));
    return exitCodeForError(baselineGraph.error);
  }

  const baselineScanGraph = filterGraphForProdOnly(baselineGraph.value, command.prodOnly);
  const baselineEvidence = await collectEvidenceForGraph({
    graph: baselineScanGraph,
    projectRoot: currentProject.value.project.rootDir
  });

  if (isErr(baselineEvidence)) {
    io.stderr(formatError(baselineEvidence.error));
    return exitCodeForError(baselineEvidence.error);
  }

  const baselineLicenses = normalizeAllLicenseEvidence(baselineEvidence.value);
  const baselineFindings = evaluateLicenseRisks({
    licenses: baselineLicenses,
    dependencies: baselineScanGraph.nodes,
    profile: command.profile
  });
  const current = await evaluateProjectScan({
    ...currentProject.value,
    profile: command.profile,
    applyWaivers: false
  });

  if (isErr(current)) {
    io.stderr(formatError(current.error));
    return exitCodeForError(current.error);
  }

  const diff = diffRiskFindings({
    baselineFindings,
    currentFindings: current.value.riskFindings
  });

  const output = renderDiffReport({
      baselineRef: command.baselineRef,
      profile: command.profile,
      prodOnly: command.prodOnly,
      diff,
      json: command.json,
      markdown: command.markdown,
      failOn: command.failOn
    });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (command.failOn && hasFindingAtOrAbove(diff.newFindings, command.failOn)) {
    return 1;
  }

  return 0;
}

async function runExplain(
  command: Extract<CliCommand, { kind: "explain" }>,
  io: CliIO
): Promise<number> {
  const normalizedLicense = normalizeLicenseEvidence({
    packageId: "input",
    packageJsonLicense: command.expression,
    files: [],
    source: "unavailable",
    warnings: []
  });
  const finding = evaluateLicenseRisk({
    license: normalizedLicense,
    dependency: {
      id: "input",
      name: "input",
      version: "0.0.0",
      ecosystem: "npm",
      dependencyType: "production",
      direct: true,
      paths: [["input"]]
    },
    profile: command.profile
  });

  const output = renderExplainReport({
      expression: command.expression,
      profile: command.profile,
      normalizedLicense,
      finding,
      json: command.json
    });
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  return 0;
}

async function runScan(
  command: Extract<CliCommand, { kind: "scan" | "ci" }>,
  io: CliIO
): Promise<number> {
  const scanned = await scanProject({
    cwd: io.cwd,
    lockfilePath: command.lockfilePath,
    profile: command.profile,
    prodOnly: command.prodOnly,
    applyWaivers: !command.noWaivers
  });

  if (isErr(scanned)) {
    io.stderr(formatError(scanned.error));
    return exitCodeForError(scanned.error);
  }

  const reportInput = {
    project: scanned.value.project,
    graph: scanned.value.graph,
    evidence: scanned.value.evidence,
    normalizedLicenses: scanned.value.normalizedLicenses,
    riskFindings: scanned.value.riskFindings,
    profile: command.profile,
    prodOnly: command.prodOnly,
    json: command.json,
    markdown: command.markdown,
    waiverMode: command.noWaivers ? "ignored" : "local",
    failOn: command.kind === "ci" ? command.failOn : undefined,
    strictWaivers: command.kind === "ci" ? command.strictWaivers : false,
    waivedFindings: scanned.value.waivedFindings,
    expiredWaivers: scanned.value.expiredWaivers,
    unmatchedWaivers: scanned.value.unmatchedWaivers
  };

  const output = command.cyclonedx
    ? renderCycloneDxReport(reportInput)
    : command.sarif
      ? renderSarifReport(reportInput)
      : renderScanReport(reportInput);
  const emitted = emitReport({
    contents: output,
    outputPath: command.outputPath,
    io
  });

  if (isErr(emitted)) {
    io.stderr(formatError(emitted.error));
    return exitCodeForError(emitted.error);
  }

  if (command.kind === "ci" && hasFindingAtOrAbove(scanned.value.riskFindings, command.failOn)) {
    return 1;
  }

  if (command.kind === "ci" && command.strictWaivers && hasWaiverDrift(scanned.value)) {
    return 1;
  }

  return 0;
}

function hasWaiverDrift(input: {
  expiredWaivers: unknown[];
  unmatchedWaivers: unknown[];
}): boolean {
  return input.expiredWaivers.length > 0 || input.unmatchedWaivers.length > 0;
}

async function scanProject(input: {
  cwd: string;
  lockfilePath?: string;
  profile: Extract<CliCommand, { kind: "scan" | "ci" | "diff" }>["profile"];
  prodOnly: boolean;
  applyWaivers: boolean;
}) {
  const loaded = loadProjectGraph({
    cwd: input.cwd,
    lockfilePath: input.lockfilePath,
    prodOnly: input.prodOnly
  });

  if (isErr(loaded)) {
    return loaded;
  }

  return evaluateProjectScan({
    ...loaded.value,
    profile: input.profile,
    applyWaivers: input.applyWaivers
  });
}

function loadProjectGraph(input: {
  cwd: string;
  lockfilePath?: string;
  prodOnly: boolean;
}): Result<{
  project: ProjectInput;
  scanGraph: DependencyGraph;
}, OhriskError> {
  const discovered = discoverProject({
    cwd: input.cwd,
    ...(input.lockfilePath ? { lockfilePath: input.lockfilePath } : {})
  });

  if (isErr(discovered)) {
    return discovered;
  }

  const graph = parseProjectLockfile(discovered.value);

  if (isErr(graph)) {
    return graph;
  }

  const scanGraph = filterGraphForProdOnly(graph.value, input.prodOnly);

  return ok({
    project: discovered.value,
    scanGraph
  });
}

async function evaluateProjectScan(input: {
  project: ProjectInput;
  scanGraph: DependencyGraph;
  profile: Extract<CliCommand, { kind: "scan" | "ci" | "diff" }>["profile"];
  applyWaivers: boolean;
}) {
  const evidence = await collectEvidenceForGraph({
    graph: input.scanGraph,
    projectRoot: input.project.rootDir
  });

  if (isErr(evidence)) {
    return evidence;
  }

  const normalizedLicenses = normalizeAllLicenseEvidence(evidence.value);
  const riskFindings = evaluateLicenseRisks({
    licenses: normalizedLicenses,
    dependencies: input.scanGraph.nodes,
    profile: input.profile
  });
  if (!input.applyWaivers) {
    return {
      ok: true as const,
      value: {
        project: input.project,
        graph: input.scanGraph,
        evidence: evidence.value,
        normalizedLicenses,
        riskFindings,
        waivedFindings: [],
        expiredWaivers: [],
        unmatchedWaivers: []
      }
    };
  }

  const waivers = readRiskWaivers(input.project.rootDir);

  if (isErr(waivers)) {
    return waivers;
  }

  const appliedWaivers = applyRiskWaivers({
    findings: riskFindings,
    waivers: waivers.value
  });

  return {
    ok: true as const,
    value: {
      project: input.project,
      graph: input.scanGraph,
      evidence: evidence.value,
      normalizedLicenses,
      riskFindings: appliedWaivers.activeFindings,
      waivedFindings: appliedWaivers.waivedFindings,
      expiredWaivers: appliedWaivers.expiredWaivers,
      unmatchedWaivers: appliedWaivers.unmatchedWaivers
    }
  };
}

function parseProjectLockfile(project: ProjectInput): Result<DependencyGraph, OhriskError> {
  switch (project.lockfile.kind) {
    case "bun":
      return parseBunLockfile(project.lockfile.path);
    case "package-lock":
      return parsePackageLockfile(project.lockfile.path);
    case "npm-shrinkwrap":
      return parsePackageLockfile(project.lockfile.path);
    case "pnpm-lock":
      return parsePnpmLockfile(project.lockfile.path);
    case "deno-lock":
      return parseDenoLockfile(project.lockfile.path);
    case "cargo-lock":
      return parseCargoLockfile(project.lockfile.path);
    case "go-mod":
      return parseGoModFile(project.lockfile.path);
    case "pipfile-lock":
      return parsePipfileLockfile(project.lockfile.path);
    case "pdm-lock":
      return parsePdmLockfile(project.lockfile.path);
    case "poetry-lock":
      return parsePoetryLockfile(project.lockfile.path);
    case "requirements-txt":
      return parseRequirementsFile(project.lockfile.path);
    case "uv-lock":
      return parseUvLockfile(project.lockfile.path);
    case "gradle-lock":
      return parseGradleLockfile(project.lockfile.path);
    case "maven-pom":
      return parseMavenPomFile(project.lockfile.path);
    case "nuget-lock":
      return parseNugetLockfile(project.lockfile.path);
    case "gemfile-lock":
      return parseGemfileLockfile(project.lockfile.path);
    case "composer-lock":
      return parseComposerLockfile(project.lockfile.path);
    case "cyclonedx-json":
      return parseCycloneDxJsonFile(project.lockfile.path);
    case "spdx-json":
      return parseSpdxJsonFile(project.lockfile.path);
    case "yarn-lock":
      return parseYarnLockfile(project.lockfile.path);
  }
}

function filterGraphForProdOnly(graph: DependencyGraph, prodOnly: boolean): DependencyGraph {
  if (!prodOnly) {
    return graph;
  }

  const nodes = graph.nodes.filter(isProductionRelevantDependency);
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    ...graph,
    nodes,
    embeddedEvidence: graph.embeddedEvidence?.filter((evidence) => nodeIds.has(evidence.packageId))
  };
}

async function collectEvidenceForGraph(input: {
  graph: DependencyGraph;
  projectRoot: string;
}): Promise<Result<LicenseEvidence[], OhriskError>> {
  const embeddedEvidence = input.graph.embeddedEvidence ?? [];
  const embeddedEvidenceIds = new Set(embeddedEvidence.map((evidence) => evidence.packageId));
  const graphNodeIds = new Set(input.graph.nodes.map((node) => node.id));
  const relevantEmbeddedEvidence = embeddedEvidence.filter((evidence) =>
    graphNodeIds.has(evidence.packageId)
  );
  const collectionGraph = embeddedEvidenceIds.size === 0
    ? input.graph
    : {
        ...input.graph,
        nodes: input.graph.nodes.filter((node) => !embeddedEvidenceIds.has(node.id)),
        embeddedEvidence: []
      };

  const collected = await collectGraphEvidence({
    graph: collectionGraph,
    projectRoot: input.projectRoot
  });

  if (isErr(collected)) {
    return collected;
  }

  return ok([...relevantEmbeddedEvidence, ...collected.value]);
}

function isProductionRelevantDependency(node: DependencyNode): boolean {
  return node.dependencyType !== "development";
}

function parseLockfileTextForKind(input: {
  kind: ProjectInput["lockfile"]["kind"];
  text: string;
  lockfilePath: string;
  packageJsonText?: string;
  packageJsonPath?: string;
  workspacePackageJsonTexts?: YarnWorkspacePackageJsonInput[];
  pnpmWorkspaceText?: string;
  pnpmWorkspacePath?: string;
  pyprojectText?: string;
  cargoManifestText?: string;
  goSumText?: string;
  composerJsonText?: string;
  requirementsRootName?: string;
  requirementsIncludedFileReader?: RequirementsIncludedFileReader;
}): Result<DependencyGraph, OhriskError> {
  switch (input.kind) {
    case "bun":
      return parseBunLockText(input.text, input.lockfilePath);
    case "package-lock":
      return parsePackageLockText(input.text, input.lockfilePath);
    case "npm-shrinkwrap":
      return parsePackageLockText(input.text, input.lockfilePath);
    case "pnpm-lock":
      return parsePnpmLockText(input.text, input.lockfilePath, {
        workspaceText: input.pnpmWorkspaceText,
        workspacePath: input.pnpmWorkspacePath
      });
    case "deno-lock":
      return parseDenoLockText(input.text, input.lockfilePath);
    case "cargo-lock":
      return parseCargoLockText(input.text, input.lockfilePath, {
        manifestText: input.cargoManifestText
      });
    case "go-mod":
      return parseGoModText(input.text, input.lockfilePath, {
        goSumText: input.goSumText
      });
    case "pipfile-lock":
      return parsePipfileLockText(input.text, input.lockfilePath);
    case "pdm-lock":
      return parsePdmLockText(input.text, input.lockfilePath, {
        pyprojectText: input.pyprojectText
      });
    case "poetry-lock":
      return parsePoetryLockText(input.text, input.lockfilePath, {
        pyprojectText: input.pyprojectText
      });
    case "requirements-txt":
      return parseRequirementsText(input.text, input.lockfilePath, {
        rootName: input.requirementsRootName,
        readIncludedFile: input.requirementsIncludedFileReader
      });
    case "uv-lock":
      return parseUvLockText(input.text, input.lockfilePath);
    case "gradle-lock":
      return parseGradleLockText(input.text, input.lockfilePath);
    case "maven-pom":
      return parseMavenPomText(input.text, input.lockfilePath);
    case "nuget-lock":
      return parseNugetLockText(input.text, input.lockfilePath);
    case "gemfile-lock":
      return parseGemfileLockText(input.text, input.lockfilePath);
    case "composer-lock":
      return parseComposerLockText(input.text, input.lockfilePath, {
        composerJsonText: input.composerJsonText
      });
    case "cyclonedx-json":
      return parseCycloneDxJsonText(input.text, input.lockfilePath);
    case "spdx-json":
      return parseSpdxJsonText(input.text, input.lockfilePath);
    case "yarn-lock":
      return parseYarnLockText({
        lockfileText: input.text,
        packageJsonText: input.packageJsonText ?? "{}",
        lockfilePath: input.lockfilePath,
        packageJsonPath: input.packageJsonPath,
        workspacePackageJsonTexts: input.workspacePackageJsonTexts
      });
  }
}

function readBaselineYarnWorkspacePackageJsons(input: {
  projectRoot: string;
  baselineRef: string;
  rootPackageJsonText: string;
  readRefFile: GitRefFileReader;
}): Result<YarnWorkspacePackageJsonInput[], OhriskError> {
  const rootPackageJson = tryParseObject(input.rootPackageJsonText);
  if (!rootPackageJson) {
    return ok([]);
  }

  const packageJsons: YarnWorkspacePackageJsonInput[] = [];
  for (const workspacePackageJsonPath of findYarnWorkspacePackageJsonPaths({
    projectRoot: input.projectRoot,
    workspaces: rootPackageJson.workspaces
  })) {
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

function renderHelp(target?: HelpTarget): string {
  switch (target) {
    case "scan":
      return renderScanHelp();
    case "ci":
      return renderCiHelp();
    case "diff":
      return renderDiffHelp();
    case "explain":
      return renderExplainHelp();
    case "help":
      return renderHelpCommandHelp();
    case "version":
      return renderVersionHelp();
    case undefined:
      return renderTopLevelHelp();
  }
}

function renderTopLevelHelp(): string {
  return [
    "Ohrisk",
    "",
    "Usage:",
    "  ohrisk scan [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--json|--sarif|--markdown|--cyclonedx] [--output <file>]",
    "  ohrisk ci [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--json|--sarif|--markdown|--cyclonedx] [--fail-on high|unknown|review|low] [--strict-waivers] [--output <file>]",
    "  ohrisk diff <baseline-ref> [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "  ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
    "  ohrisk help [command]",
    "  ohrisk version",
    "",
    "Commands:",
    "  scan    Find the current project and prepare a license-risk scan.",
    "  ci      Run a scan and exit non-zero when findings meet the fail threshold.",
    "  diff    Compare current findings against a baseline git ref.",
    "  explain Explain how a license expression is classified for a profile.",
    "  help    Print this help text.",
    "  version Print the Ohrisk package version.",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --fail-on <severity>   CI threshold. Defaults to high for ci.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --help, -h             Print this help text.",
    "  --version, -v          Print the Ohrisk package version."
  ].join("\n");
}

function renderScanHelp(): string {
  return [
    "Ohrisk scan",
    "",
    "Usage:",
    "  ohrisk scan [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--json|--sarif|--markdown|--cyclonedx] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderCiHelp(): string {
  return [
    "Ohrisk ci",
    "",
    "Usage:",
    "  ohrisk ci [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--no-waivers] [--json|--sarif|--markdown|--cyclonedx] [--fail-on high|unknown|review|low] [--strict-waivers] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --prod                 Exclude development-only dependencies.",
    "  --no-waivers           Ignore local .ohrisk-waivers.json files.",
    "  --json                 Print machine-readable output.",
    "  --sarif                Print SARIF 2.1.0 output for code scanning upload.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --cyclonedx            Print a CycloneDX 1.5 SBOM as JSON.",
    "  --fail-on <severity>   CI threshold. Defaults to high.",
    "  --strict-waivers       Fail CI when local waivers are expired or unmatched.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderDiffHelp(): string {
  return [
    "Ohrisk diff",
    "",
    "Usage:",
    "  ohrisk diff <baseline-ref> [--lockfile <path>] [--profile saas|distributed-app] [--prod] [--json|--markdown] [--fail-on high|unknown|review|low] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --lockfile <path>      Use a specific supported lockfile path.",
    "  --prod                 Exclude development-only dependencies.",
    "  --json                 Print machine-readable output.",
    "  --markdown             Print a Markdown report for PRs or release notes.",
    "  --fail-on <severity>   Optional diff threshold.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderExplainHelp(): string {
  return [
    "Ohrisk explain",
    "",
    "Usage:",
    "  ohrisk explain <license-expression> [--profile saas|distributed-app] [--json] [--output <file>]",
    "",
    "Options:",
    "  --profile <profile>    Usage profile. Defaults to saas.",
    "  --json                 Print machine-readable output.",
    "  --output <file>        Write report output to a file instead of stdout.",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderHelpCommandHelp(): string {
  return [
    "Ohrisk help",
    "",
    "Usage:",
    "  ohrisk help [command]",
    "",
    "Commands:",
    "  scan",
    "  ci",
    "  diff",
    "  explain",
    "  help",
    "  version",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function renderVersionHelp(): string {
  return [
    "Ohrisk version",
    "",
    "Usage:",
    "  ohrisk version",
    "  ohrisk --version",
    "  ohrisk -v",
    "",
    "Options:",
    "  --help, -h             Print this help text."
  ].join("\n");
}

function emitReport(input: {
  contents: string;
  outputPath: string | undefined;
  io: CliIO;
}): Result<void, OhriskError> {
  if (!input.outputPath) {
    input.io.stdout(input.contents);
    return ok(undefined);
  }

  const writer = input.io.writeReport ?? writeReportFile;
  const written = writer({
    cwd: input.io.cwd,
    outputPath: input.outputPath,
    contents: input.contents
  });

  if (isErr(written)) {
    return written;
  }

  return ok(undefined);
}


function renderVersion(): string {
  return `ohrisk ${OHRISK_VERSION}`;
}

function isCliEntrypoint(metaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
  }
}

function defaultIO(): CliIO {
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`)
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await main();
  process.exit(exitCode);
}
