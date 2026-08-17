import { Buffer } from "node:buffer";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { GitRefFileReader } from "../git/ref-file";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  emptyPolicyConfig,
  readPolicyConfig,
  type ResolvedPolicyConfig
} from "./config";

const POLICY_FILENAME = ".ohrisk.yml";
const POLICY_MAX_BYTES = 1024 * 1024;
const POLICY_MAX_INHERITANCE_DEPTH = 8;

export function readPolicyConfigFromRef(input: {
  projectRoot: string;
  workspaceRoot?: string;
  ref: string;
  readRefFile: GitRefFileReader;
  policyPath?: string;
}): Result<ResolvedPolicyConfig, OhriskError> {
  const roots = resolvePolicyRoots(input.projectRoot, input.workspaceRoot);
  if (!roots.ok) {
    return roots;
  }

  const requestedPath = input.policyPath
    ? path.resolve(roots.value.projectRoot, input.policyPath)
    : path.join(roots.value.projectRoot, POLICY_FILENAME);
  const requestedRelative = relativePolicyPath(
    roots.value.workspaceRoot,
    requestedPath
  );
  if (!requestedRelative.ok) {
    return requestedRelative;
  }

  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-policy-ref-"));
    const materialized = materializePolicyFile({
      workspaceRoot: roots.value.workspaceRoot,
      temporaryRoot,
      ref: input.ref,
      relativePath: requestedRelative.value,
      readRefFile: input.readRefFile,
      visited: new Set(),
      depth: 0,
      allowMissing: input.policyPath === undefined
    });
    if (!materialized.ok) {
      return materialized;
    }
    if (!materialized.value) {
      return ok(emptyPolicyConfig());
    }

    const projectRelative = path.relative(
      roots.value.workspaceRoot,
      roots.value.projectRoot
    );
    const temporaryProjectRoot = path.join(temporaryRoot, projectRelative);
    mkdirSync(temporaryProjectRoot, { recursive: true });
    const temporaryPolicyPath = path.join(
      temporaryRoot,
      ...requestedRelative.value.split("/")
    );

    return readPolicyConfig({
      projectRoot: temporaryProjectRoot,
      workspaceRoot: temporaryRoot,
      ...(input.policyPath
        ? { policyPath: path.relative(temporaryProjectRoot, temporaryPolicyPath) }
        : {})
    });
  } catch (cause) {
    return err(createError({
      code: "POLICY_FILE_READ_FAILED",
      category: "filesystem",
      message: "Could not materialize the baseline policy workspace.",
      details: { cause: errorMessage(cause), ref: input.ref }
    }));
  } finally {
    if (temporaryRoot) {
      removeTemporaryRoot(temporaryRoot);
    }
  }
}

function materializePolicyFile(input: {
  workspaceRoot: string;
  temporaryRoot: string;
  ref: string;
  relativePath: string;
  readRefFile: GitRefFileReader;
  visited: Set<string>;
  depth: number;
  allowMissing: boolean;
}): Result<boolean, OhriskError> {
  if (input.depth > POLICY_MAX_INHERITANCE_DEPTH) {
    return err(policyRefError(
      "Policy inheritance exceeded the supported depth in the baseline ref.",
      input
    ));
  }
  if (input.visited.has(input.relativePath)) {
    return ok(true);
  }

  const read = input.readRefFile({
    projectRoot: input.workspaceRoot,
    ref: input.ref,
    relativePath: input.relativePath
  });
  if (!read.ok) {
    if (read.error.code === "GIT_REF_FILE_NOT_FOUND" && input.allowMissing) {
      return ok(false);
    }
    return err(policyRefError(
      "Could not read a policy file from the baseline git ref.",
      input,
      { causeCode: read.error.code, cause: read.error.message }
    ));
  }
  if (Buffer.byteLength(read.value, "utf8") > POLICY_MAX_BYTES) {
    return err(policyRefError(
      "Policy file exceeded the maximum supported size in the baseline ref.",
      input,
      { maxBytes: POLICY_MAX_BYTES }
    ));
  }

  const target = path.join(input.temporaryRoot, ...input.relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, read.value, "utf8");

  const nextVisited = new Set(input.visited);
  nextVisited.add(input.relativePath);
  for (const inheritedPath of discoverInheritedPolicyPaths(read.value)) {
    const resolved = resolveInheritedPolicyPath(input.relativePath, inheritedPath);
    if (!resolved) {
      continue;
    }
    const inherited = materializePolicyFile({
      ...input,
      relativePath: resolved,
      visited: nextVisited,
      depth: input.depth + 1,
      allowMissing: false
    });
    if (!inherited.ok) {
      return inherited;
    }
  }
  return ok(true);
}

function discoverInheritedPolicyPaths(text: string): string[] {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    return [];
  }
  if (!isRecord(document)) {
    return [];
  }
  const value = document.extends;
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return [];
  }
  return value as string[];
}

function resolveInheritedPolicyPath(
  parentRelativePath: string,
  inheritedPath: string
): string | undefined {
  const normalizedInput = inheritedPath.replaceAll("\\", "/");
  if (
    normalizedInput.trim() === ""
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(normalizedInput)
    || path.posix.isAbsolute(normalizedInput)
    || /^[A-Za-z]:\//.test(normalizedInput)
  ) {
    return undefined;
  }
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(parentRelativePath),
    normalizedInput
  ));
  return resolved === ".." || resolved.startsWith("../") ? undefined : resolved;
}

function resolvePolicyRoots(
  projectRoot: string,
  workspaceRoot: string | undefined
): Result<{ projectRoot: string; workspaceRoot: string }, OhriskError> {
  try {
    const realProjectRoot = realDirectory(projectRoot);
    const realWorkspaceRoot = realDirectory(workspaceRoot ?? projectRoot);
    const relative = path.relative(realWorkspaceRoot, realProjectRoot);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Project root is outside the policy workspace root.");
    }
    return ok({
      projectRoot: realProjectRoot,
      workspaceRoot: realWorkspaceRoot
    });
  } catch (cause) {
    return err(createError({
      code: "POLICY_FILE_READ_FAILED",
      category: "filesystem",
      message: "Policy workspace root must be a readable directory.",
      details: { cause: errorMessage(cause) }
    }));
  }
}

function realDirectory(directory: string): string {
  const resolved = realpathSync(directory);
  if (!statSync(resolved).isDirectory()) {
    throw new Error("Not a directory.");
  }
  return resolved;
}

function relativePolicyPath(
  workspaceRoot: string,
  filePath: string
): Result<string, OhriskError> {
  const relative = path.relative(workspaceRoot, filePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return err(createError({
      code: "POLICY_FILE_READ_FAILED",
      category: "filesystem",
      message: "Policy files must stay inside the workspace root.",
      details: { filePath, workspaceRoot }
    }));
  }
  return ok(relative.split(path.sep).join("/"));
}

function policyRefError(
  message: string,
  input: { ref: string; relativePath: string },
  details: Record<string, unknown> = {}
): OhriskError {
  return createError({
    code: "POLICY_FILE_READ_FAILED",
    category: "filesystem",
    message,
    details: {
      ref: input.ref,
      relativePath: input.relativePath,
      ...details
    }
  });
}

function removeTemporaryRoot(root: string): void {
  try {
    rmSync(root, { force: true, recursive: true });
  } catch {
    // The scan result is more important than best-effort temporary cleanup.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
