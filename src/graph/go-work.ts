import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  goReplacementResolvedSpecifier,
  normalizeGoReplacementDirectives,
  parseGoModRecords,
  parseGoModText,
  parseGoReplaceDirectiveLine,
  splitGoDirectiveFields,
  stripGoLineComment,
  type GoReplaceDirective
} from "./go-mod";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

export type GoWorkModulePath = {
  usePath: string;
  moduleRootDir: string;
  goModPath: string;
  goSumPath: string;
  goModRelativePath: string;
  goSumRelativePath: string;
};

export type GoWorkModuleInput = {
  usePath: string;
  moduleRootDir: string;
  goModPath: string;
  goModText: string;
  goSumText?: string;
};

type GoWorkDirectives = {
  usePaths: string[];
  replacements: GoReplaceDirective[];
};

export function parseGoWorkFile(
  goWorkPath: string,
  options: { maxBytes?: number; moduleMaxBytes?: number; goSumMaxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const goWorkText = readInputTextFile({
    filePath: goWorkPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!goWorkText.ok) {
    return err(
      createError({
        code: "GO_WORK_READ_FAILED",
        category: inputFileReadErrorCategory(goWorkText.error),
        message: goWorkText.error.kind === "too_large"
          ? "go.work exceeded the maximum supported size."
          : "Failed to read go.work.",
        details: {
          lockfilePath: goWorkPath,
          ...inputFileReadErrorDetails(goWorkText.error)
        }
      })
    );
  }

  const workspaceRootDir = path.dirname(goWorkPath);
  const moduleInputs = readGoWorkModuleInputs({
    goWorkText: goWorkText.value,
    goWorkPath,
    workspaceRootDir,
    moduleMaxBytes: options.moduleMaxBytes ?? LOCKFILE_MAX_BYTES,
    goSumMaxBytes: options.goSumMaxBytes ?? LOCKFILE_MAX_BYTES
  });
  if (!moduleInputs.ok) {
    return moduleInputs;
  }

  return parseGoWorkText(goWorkText.value, goWorkPath, {
    moduleInputs: moduleInputs.value,
    workspaceRootDir,
    goWorkDir: path.dirname(goWorkPath)
  });
}

export function parseGoWorkText(
  input: string,
  goWorkPath = "go.work",
  options: {
    moduleInputs?: GoWorkModuleInput[];
    workspaceRootDir?: string;
    goWorkDir?: string;
  } = {}
): Result<DependencyGraph, OhriskError> {
  const directives = parseGoWorkDirectives(input, goWorkPath);
  if (!directives.ok) {
    return directives;
  }

  const moduleInputs = options.moduleInputs ?? [];
  if (moduleInputs.length === 0) {
    return goWorkParseError({
      goWorkPath,
      reason: "missing_workspace_modules",
      message: "Failed to parse go.work. Ohrisk requires readable go.mod files for every workspace module."
    });
  }

  const workspaceRootDir = options.workspaceRootDir ?? path.dirname(goWorkPath);
  const goWorkDir = options.goWorkDir ?? path.dirname(goWorkPath);
  const workspaceReplacements = normalizeGoReplacementDirectives(
    directives.value.replacements,
    goWorkDir,
    workspaceRootDir
  );
  const workspaceReplacementGroup = dedupeReplacementGroup({
    replacements: workspaceReplacements,
    goWorkPath,
    reason: "conflicting_go_work_replace",
    message: "Failed to parse go.work. Workspace replace directives contain conflicting targets."
  });
  if (!workspaceReplacementGroup.ok) {
    return workspaceReplacementGroup;
  }

  const moduleReplacementGroup = collectWorkspaceModuleReplacementGroup({
    moduleInputs,
    workspaceReplacements: workspaceReplacementGroup.value,
    workspaceRootDir
  });
  if (!moduleReplacementGroup.ok) {
    return moduleReplacementGroup;
  }

  const workspaceRootName = path.basename(workspaceRootDir) || "<go-workspace>";
  const mergedNodes = new Map<string, DependencyNode>();

  for (const moduleInput of [...moduleInputs].sort((left, right) =>
    left.goModPath.localeCompare(right.goModPath)
  )) {
    const graph = parseGoModText(moduleInput.goModText, moduleInput.goModPath, omitUndefined({
      goSumText: moduleInput.goSumText,
      replacementOverrideGroups: [
        workspaceReplacementGroup.value,
        moduleReplacementGroup.value
      ],
      localReplacementBaseDir: moduleInput.moduleRootDir,
      localReplacementRootDir: workspaceRootDir
    }));
    if (!graph.ok) {
      return graph;
    }

    for (const node of graph.value.nodes) {
      const workspaceNode: DependencyNode = {
        ...node,
        paths: node.paths.map((dependencyPath) => [workspaceRootName, ...dependencyPath])
      };
      const existing = mergedNodes.get(workspaceNode.id);
      if (!existing) {
        mergedNodes.set(workspaceNode.id, workspaceNode);
        continue;
      }

      const merged = mergeGoWorkspaceNode(existing, workspaceNode, goWorkPath);
      if (!merged.ok) {
        return merged;
      }
      mergedNodes.set(workspaceNode.id, merged.value);
    }
  }

  return ok({
    rootName: workspaceRootName,
    lockfilePath: goWorkPath,
    nodes: [...mergedNodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  });
}

export function findGoWorkModulePaths(input: {
  goWorkText: string;
  goWorkPath: string;
  projectRoot: string;
}): Result<GoWorkModulePath[], OhriskError> {
  const directives = parseGoWorkDirectives(input.goWorkText, input.goWorkPath);
  if (!directives.ok) {
    return directives;
  }

  const paths: GoWorkModulePath[] = [];
  const seen = new Set<string>();
  const goWorkDir = path.dirname(input.goWorkPath);

  for (const usePath of directives.value.usePaths) {
    const moduleRootDir = path.resolve(goWorkDir, usePath);
    const relativeModuleRoot = normalizeProjectRelativePath(input.projectRoot, moduleRootDir);
    if (!relativeModuleRoot) {
      return goWorkParseError({
        goWorkPath: input.goWorkPath,
        reason: "workspace_module_outside_project_root",
        details: { usePath },
        message: "Failed to parse go.work. Workspace module paths must stay inside the project root."
      });
    }

    const goModPath = path.join(moduleRootDir, "go.mod");
    const goSumPath = path.join(moduleRootDir, "go.sum");
    const goModRelativePath = normalizeProjectRelativePath(input.projectRoot, goModPath);
    const goSumRelativePath = normalizeProjectRelativePath(input.projectRoot, goSumPath);
    if (!goModRelativePath || !goSumRelativePath) {
      return goWorkParseError({
        goWorkPath: input.goWorkPath,
        reason: "workspace_module_path_resolution_failed",
        details: { usePath },
        message: "Failed to parse go.work. Workspace module paths must stay inside the project root."
      });
    }

    if (seen.has(goModRelativePath)) {
      continue;
    }
    seen.add(goModRelativePath);
    paths.push({
      usePath,
      moduleRootDir,
      goModPath,
      goSumPath,
      goModRelativePath,
      goSumRelativePath
    });
  }

  if (paths.length === 0) {
    return goWorkParseError({
      goWorkPath: input.goWorkPath,
      reason: "missing_use_directive",
      message: "Failed to parse go.work. Ohrisk expected at least one use directive."
    });
  }

  return ok(paths.sort((left, right) => left.goModRelativePath.localeCompare(right.goModRelativePath)));
}

function readGoWorkModuleInputs(input: {
  goWorkText: string;
  goWorkPath: string;
  workspaceRootDir: string;
  moduleMaxBytes: number;
  goSumMaxBytes: number;
}): Result<GoWorkModuleInput[], OhriskError> {
  const modulePaths = findGoWorkModulePaths({
    goWorkText: input.goWorkText,
    goWorkPath: input.goWorkPath,
    projectRoot: input.workspaceRootDir
  });
  if (!modulePaths.ok) {
    return modulePaths;
  }

  const modules: GoWorkModuleInput[] = [];
  for (const modulePath of modulePaths.value) {
    const goModText = readInputTextFile({
      filePath: modulePath.goModPath,
      maxBytes: input.moduleMaxBytes
    });
    if (!goModText.ok) {
      return err(
        createError({
          code: "GO_WORK_MODULE_READ_FAILED",
          category: inputFileReadErrorCategory(goModText.error),
          message: goModText.error.kind === "too_large"
            ? "go.work workspace module go.mod exceeded the maximum supported size."
            : "Failed to read go.work workspace module go.mod.",
          details: {
            lockfilePath: input.goWorkPath,
            goModPath: modulePath.goModPath,
            ...inputFileReadErrorDetails(goModText.error)
          }
        })
      );
    }

    const goSumText = readOptionalGoWorkModuleGoSum({
      goWorkPath: input.goWorkPath,
      goSumPath: modulePath.goSumPath,
      maxBytes: input.goSumMaxBytes
    });
    if (!goSumText.ok) {
      return goSumText;
    }

    modules.push({
      usePath: modulePath.usePath,
      moduleRootDir: modulePath.moduleRootDir,
      goModPath: modulePath.goModPath,
      goModText: goModText.value,
      ...(goSumText.value ? { goSumText: goSumText.value } : {})
    });
  }

  return ok(modules);
}

function readOptionalGoWorkModuleGoSum(input: {
  goWorkPath: string;
  goSumPath: string;
  maxBytes: number;
}): Result<string | undefined, OhriskError> {
  if (!existsSync(input.goSumPath)) {
    return ok(undefined);
  }

  const goSumText = readInputTextFile({
    filePath: input.goSumPath,
    maxBytes: input.maxBytes
  });
  if (!goSumText.ok) {
    return err(
      createError({
        code: "GO_WORK_SUM_READ_FAILED",
        category: inputFileReadErrorCategory(goSumText.error),
        message: goSumText.error.kind === "too_large"
          ? "go.work workspace module go.sum exceeded the maximum supported size."
          : "Failed to read go.work workspace module go.sum.",
        details: {
          lockfilePath: input.goWorkPath,
          goSumPath: input.goSumPath,
          ...inputFileReadErrorDetails(goSumText.error)
        }
      })
    );
  }

  return ok(goSumText.value);
}

function parseGoWorkDirectives(input: string, goWorkPath: string): Result<GoWorkDirectives, OhriskError> {
  const usePaths: string[] = [];
  const replacements: GoReplaceDirective[] = [];
  let block: "use" | "replace" | undefined;

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = stripGoLineComment(rawLine).trim();
    if (line === "") {
      continue;
    }

    if (block) {
      if (line === ")") {
        block = undefined;
        continue;
      }

      if (block === "use") {
        const usePath = parseUseLine(line, goWorkPath, index + 1);
        if (!usePath.ok) {
          return usePath;
        }
        if (usePath.value) {
          usePaths.push(usePath.value);
        }
        continue;
      }

      const replacement = parseGoReplaceDirectiveLine({
        line,
        sourcePath: goWorkPath,
        lineNumber: index + 1,
        errorCode: "GO_WORK_PARSE_FAILED",
        errorMessage: "Failed to parse go.work replace directive."
      });
      if (!replacement.ok) {
        return replacement;
      }
      if (replacement.value) {
        replacements.push(replacement.value);
      }
      continue;
    }

    if (line === "use (") {
      block = "use";
      continue;
    }

    if (line === "replace (") {
      block = "replace";
      continue;
    }

    if (line.startsWith("use ")) {
      const usePath = parseUseLine(line.slice("use ".length).trim(), goWorkPath, index + 1);
      if (!usePath.ok) {
        return usePath;
      }
      if (usePath.value) {
        usePaths.push(usePath.value);
      }
      continue;
    }

    if (line.startsWith("replace ")) {
      const replacement = parseGoReplaceDirectiveLine({
        line: line.slice("replace ".length).trim(),
        sourcePath: goWorkPath,
        lineNumber: index + 1,
        errorCode: "GO_WORK_PARSE_FAILED",
        errorMessage: "Failed to parse go.work replace directive."
      });
      if (!replacement.ok) {
        return replacement;
      }
      if (replacement.value) {
        replacements.push(replacement.value);
      }
    }
  }

  return ok({ usePaths, replacements });
}

function parseUseLine(
  line: string,
  goWorkPath: string,
  lineNumber: number
): Result<string | undefined, OhriskError> {
  const parts = splitGoDirectiveFields(line);
  if (parts.length === 0) {
    return ok(undefined);
  }

  if (parts.length !== 1 || !parts[0]) {
    return goWorkParseError({
      goWorkPath,
      line: lineNumber,
      entry: line,
      reason: "invalid_use_directive",
      message: "Failed to parse go.work use directive."
    });
  }

  return ok(parts[0]);
}

function collectWorkspaceModuleReplacementGroup(input: {
  moduleInputs: GoWorkModuleInput[];
  workspaceReplacements: GoReplaceDirective[];
  workspaceRootDir: string;
}): Result<GoReplaceDirective[], OhriskError> {
  const replacements: GoReplaceDirective[] = [];

  for (const moduleInput of input.moduleInputs) {
    const parsed = parseGoModRecords(moduleInput.goModText, moduleInput.goModPath);
    if (!parsed.ok) {
      return parsed;
    }

    for (const replacement of normalizeGoReplacementDirectives(
      parsed.value.replacements,
      moduleInput.moduleRootDir,
      input.workspaceRootDir
    )) {
      if (isOverriddenByWorkspaceReplacement(replacement, input.workspaceReplacements)) {
        continue;
      }

      replacements.push(replacement);
    }
  }

  return dedupeReplacementGroup({
    replacements,
    goWorkPath: input.moduleInputs.map((moduleInput) => moduleInput.goModPath).join(", "),
    reason: "conflicting_workspace_module_replace",
    message: "Failed to parse go.work. Workspace modules contain conflicting replace directives."
  });
}

function isOverriddenByWorkspaceReplacement(
  replacement: GoReplaceDirective,
  workspaceReplacements: GoReplaceDirective[]
): boolean {
  return workspaceReplacements.some((workspaceReplacement) =>
    workspaceReplacement.oldModulePath === replacement.oldModulePath
    && (
      workspaceReplacement.oldVersion === replacement.oldVersion
      || workspaceReplacement.oldVersion === undefined
    )
  );
}

function dedupeReplacementGroup(input: {
  replacements: GoReplaceDirective[];
  goWorkPath: string;
  reason: string;
  message: string;
}): Result<GoReplaceDirective[], OhriskError> {
  const replacementsByKey = new Map<string, GoReplaceDirective>();

  for (const replacement of input.replacements) {
    const key = goReplacementKey(replacement);
    const existing = replacementsByKey.get(key);
    if (!existing) {
      replacementsByKey.set(key, replacement);
      continue;
    }

    if (goReplacementTargetIdentity(existing) !== goReplacementTargetIdentity(replacement)) {
      return goWorkParseError({
        goWorkPath: input.goWorkPath,
        reason: input.reason,
        details: {
          replace: key,
          left: goReplacementTargetIdentity(existing),
          right: goReplacementTargetIdentity(replacement)
        },
        message: input.message
      });
    }
  }

  return ok([...replacementsByKey.values()].sort((left, right) =>
    goReplacementKey(left).localeCompare(goReplacementKey(right))
  ));
}

function mergeGoWorkspaceNode(
  left: DependencyNode,
  right: DependencyNode,
  goWorkPath: string
): Result<DependencyNode, OhriskError> {
  if ((left.resolved ?? "") !== (right.resolved ?? "")) {
    return goWorkParseError({
      goWorkPath,
      reason: "conflicting_workspace_dependency_replacement",
      details: {
        packageId: left.id,
        leftResolved: left.resolved,
        rightResolved: right.resolved
      },
      message: "Failed to parse go.work. Workspace modules resolved the same dependency through conflicting replacement sources."
    });
  }

  return ok({
    ...left,
    dependencyType: mergeDependencyType(left.dependencyType, right.dependencyType),
    direct: left.direct || right.direct,
    paths: uniqueDependencyPaths([...left.paths, ...right.paths])
  });
}

function uniqueDependencyPaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const output: string[][] = [];
  for (const dependencyPath of paths) {
    const key = dependencyPath.join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(dependencyPath);
  }
  return output.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function goReplacementKey(replacement: GoReplaceDirective): string {
  return `${replacement.oldModulePath}@${replacement.oldVersion ?? "*"}`;
}

function goReplacementTargetIdentity(replacement: GoReplaceDirective): string {
  return goReplacementResolvedSpecifier(replacement.target);
}

function mergeDependencyType(left: DependencyType, right: DependencyType): DependencyType {
  return dependencyTypeRank(left) >= dependencyTypeRank(right) ? left : right;
}

function dependencyTypeRank(type: DependencyType): number {
  switch (type) {
    case "production":
      return 4;
    case "optional":
      return 3;
    case "peer":
      return 2;
    case "development":
      return 1;
    case "unknown":
      return 0;
  }
}

function normalizeProjectRelativePath(projectRoot: string, targetPath: string): string | undefined {
  const relativePath = path.relative(projectRoot, targetPath);
  if (
    relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return relativePath === "" ? "." : relativePath.replace(/\\/g, "/");
}

function goWorkParseError(input: {
  goWorkPath: string;
  line?: number;
  entry?: string;
  reason: string;
  message: string;
  details?: Record<string, unknown>;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "GO_WORK_PARSE_FAILED",
      category: "unsupported_input",
      message: input.message,
      details: {
        lockfilePath: input.goWorkPath,
        ...(input.line ? { line: input.line } : {}),
        ...(input.entry ? { entry: input.entry } : {}),
        reason: input.reason,
        ...input.details
      }
    })
  );
}
