import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import { collectBoundedDependencyPaths } from "./bounded-dependency-paths";
import type { DependencyGraph, DependencyNode } from "./types";

type NixNodeRecord = {
  nodeKey: string;
  name: string;
  version: string;
  id: string;
  resolved?: string;
  direct: boolean;
  paths: string[][];
};

export function parseNixFlakeLockfile(
  lockfilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const lockfileText = readInputTextFile({
    filePath: lockfilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!lockfileText.ok) {
    return err(
      createError({
        code: "NIX_FLAKE_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "flake.lock exceeded the maximum supported size."
          : "Failed to read flake.lock.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseNixFlakeLockText(lockfileText.value, lockfilePath);
}

export function parseNixFlakeLockText(
  input: string,
  lockfilePath = "flake.lock"
): Result<DependencyGraph, OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (cause) {
    return err(
      createError({
        code: "NIX_FLAKE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse flake.lock as JSON.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.nodes)) {
    return nixLockShapeError({
      lockfilePath,
      reason: "missing_nodes_object"
    });
  }
  const nodesObject = parsed.nodes;

  const rootNodeKey = typeof parsed.root === "string" ? parsed.root : "root";
  const rootNode = nodesObject[rootNodeKey];
  if (!isRecord(rootNode)) {
    return nixLockShapeError({
      lockfilePath,
      reason: "missing_root_node",
      node: rootNodeKey
    });
  }

  const inputValidation = validateNixInputTargets({
    lockfilePath,
    nodes: nodesObject,
    rootNodeKey
  });
  if (!inputValidation.ok) {
    return inputValidation;
  }

  const pathCollection = collectBoundedDependencyPaths({
    rootName: rootProjectName(lockfilePath),
    rootRefs: [rootNodeKey],
    childRefs: (nodeKey) => nixChildRefs(nodesObject, nodeKey),
    pathNoun: "input node"
  });

  const records: NixNodeRecord[] = [];
  const rootName = rootProjectName(lockfilePath);
  for (const nodeKey of pathCollection.discoveredNodeKeys) {
    const node = nodesObject[nodeKey];
    if (!isRecord(node) || !isRecord(node.locked)) {
      continue;
    }

    const identity = nixNodeIdentity({
      nodeKey,
      locked: node.locked
    });
    if (!identity.ok) {
      return err(identity.error);
    }

    const paths = (pathCollection.pathsByNode.get(nodeKey) ?? []).map((item) =>
      item.filter((segment, index) => index === 0 || segment !== rootNodeKey)
    );
    records.push({
      nodeKey,
      ...identity.value,
      id: `${identity.value.name}@${identity.value.version}`,
      direct: paths.some((item) => item.length === 2),
      paths
    });
  }

  return ok({
    rootName,
    lockfilePath,
    ...(pathCollection.diagnostics.length > 0
      ? { diagnostics: pathCollection.diagnostics }
      : {}),
    nodes: records
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.name,
        version: record.version,
        ecosystem: "nix",
        ...(record.resolved ? { resolved: record.resolved } : {}),
        dependencyType: "unknown",
        direct: record.direct,
        paths: record.paths
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function validateNixInputTargets(input: {
  lockfilePath: string;
  nodes: Record<string, unknown>;
  rootNodeKey: string;
}): Result<undefined, OhriskError> {
  for (const [nodeKey, node] of Object.entries(input.nodes)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }

    for (const target of Object.values(node.inputs).flatMap(nixInputTargets)) {
      if (!Object.prototype.hasOwnProperty.call(input.nodes, target)) {
        return nixLockShapeError({
          lockfilePath: input.lockfilePath,
          reason: "input_target_missing",
          node: nodeKey,
          target
        });
      }
    }
  }

  if (!input.nodes[input.rootNodeKey]) {
    return nixLockShapeError({
      lockfilePath: input.lockfilePath,
      reason: "missing_root_node",
      node: input.rootNodeKey
    });
  }

  return ok(undefined);
}

function nixChildRefs(nodes: Record<string, unknown>, nodeKey: string): string[] {
  const node = nodes[nodeKey];
  if (!isRecord(node) || !isRecord(node.inputs)) {
    return [];
  }

  const targets: string[] = [];
  for (const target of Object.values(node.inputs).flatMap(nixInputTargets)) {
    if (Object.prototype.hasOwnProperty.call(nodes, target)) {
      targets.push(target);
    }
  }

  return targets;
}

function nixInputTargets(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? [first] : [];
  }

  return [];
}

function nixNodeIdentity(input: {
  nodeKey: string;
  locked: Record<string, unknown>;
}): Result<{
  name: string;
  version: string;
  resolved?: string;
}, OhriskError> {
  const type = stringField(input.locked, "type");
  const owner = stringField(input.locked, "owner");
  const repo = stringField(input.locked, "repo");
  const url = stringField(input.locked, "url");
  const pathValue = stringField(input.locked, "path");
  const rev = stringField(input.locked, "rev");
  const ref = stringField(input.locked, "ref");
  const narHash = stringField(input.locked, "narHash");
  const lastModified = typeof input.locked.lastModified === "number"
    ? String(input.locked.lastModified)
    : undefined;

  const name = nixNodeName({
    nodeKey: input.nodeKey,
    type,
    owner,
    repo,
    url,
    pathValue
  });
  const version = rev ?? ref ?? narHash ?? lastModified ?? pathValue ?? url;
  if (!name || !version) {
    return err(
      createError({
        code: "NIX_FLAKE_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse flake.lock node. Ohrisk requires a stable locked identity and version marker.",
        details: {
          node: input.nodeKey,
          reason: "missing_identity_or_version"
        }
      })
    );
  }

  return ok({
    name,
    version,
    ...(pathValue ? { resolved: pathValue } : url ? { resolved: url } : {})
  });
}

function nixNodeName(input: {
  nodeKey: string;
  type: string | undefined;
  owner: string | undefined;
  repo: string | undefined;
  url: string | undefined;
  pathValue: string | undefined;
}): string | undefined {
  if (input.owner && input.repo) {
    return `${input.type ?? "source"}:${input.owner}/${input.repo}`;
  }

  if (input.url) {
    return `${input.type ?? "source"}:${input.url}`;
  }

  if (input.pathValue) {
    return `path:${input.pathValue}`;
  }

  return input.nodeKey;
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function rootProjectName(lockfilePath: string): string {
  return path.basename(path.dirname(lockfilePath)) || "<nix-flake>";
}

function nixLockShapeError(input: {
  lockfilePath: string;
  reason: string;
  node?: string;
  target?: string;
}): Result<never, OhriskError> {
  return err(
    createError({
      code: "NIX_FLAKE_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse flake.lock. Ohrisk supports Nix flake lockfiles with a nodes object and root inputs.",
      details: input
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
