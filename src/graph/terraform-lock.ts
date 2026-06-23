import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode } from "./types";

type TerraformProviderRecord = {
  sourceAddress: string;
  version: string;
  id: string;
};

export function parseTerraformLockfile(
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
        code: "TERRAFORM_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? ".terraform.lock.hcl exceeded the maximum supported size."
          : "Failed to read .terraform.lock.hcl.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseTerraformLockText(lockfileText.value, lockfilePath);
}

export function parseTerraformLockText(
  input: string,
  lockfilePath = ".terraform.lock.hcl"
): Result<DependencyGraph, OhriskError> {
  const providerBlocks = readProviderBlocks(input);
  if (!providerBlocks.ok) {
    return err(
      createError({
        code: "TERRAFORM_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse .terraform.lock.hcl provider blocks.",
        details: {
          lockfilePath,
          ...providerBlocks.error
        }
      })
    );
  }

  const records = new Map<string, TerraformProviderRecord>();
  for (const block of providerBlocks.value) {
    const version = readStringAssignment(block.body, "version");
    if (!version) {
      return err(
        createError({
          code: "TERRAFORM_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse .terraform.lock.hcl provider block. Ohrisk requires locked provider versions.",
          details: {
            lockfilePath,
            provider: block.provider,
            reason: "missing_version"
          }
        })
      );
    }

    const sourceAddress = normalizeTerraformProviderAddress(block.provider);
    if (!sourceAddress) {
      return err(
        createError({
          code: "TERRAFORM_LOCK_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse .terraform.lock.hcl provider block. Ohrisk expected provider addresses such as registry.terraform.io/hashicorp/aws.",
          details: {
            lockfilePath,
            provider: block.provider,
            reason: "invalid_provider_address"
          }
        })
      );
    }

    records.set(`${sourceAddress}@${version}`, {
      sourceAddress,
      version,
      id: `${sourceAddress}@${version}`
    });
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<terraform-project>";
  return ok({
    rootName,
    lockfilePath,
    nodes: [...records.values()]
      .map((record): DependencyNode => ({
        id: record.id,
        name: record.sourceAddress,
        version: record.version,
        ecosystem: "terraform",
        resolved: record.sourceAddress,
        dependencyType: "production",
        direct: true,
        paths: [[rootName, record.id]]
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  });
}

function readProviderBlocks(input: string): Result<Array<{
  provider: string;
  body: string;
}>, { reason: string; offset?: number }> {
  const blocks: Array<{ provider: string; body: string }> = [];
  const providerPattern = /\bprovider\s+"([^"]+)"\s*\{/g;

  for (const match of input.matchAll(providerPattern)) {
    const provider = match[1]?.trim();
    const openBraceIndex = (match.index ?? 0) + match[0].length - 1;
    if (!provider) {
      return err({
        reason: "empty_provider_address",
        offset: match.index
      });
    }

    const closeBraceIndex = findMatchingBrace(input, openBraceIndex);
    if (closeBraceIndex === undefined) {
      return err({
        reason: "unterminated_provider_block",
        offset: openBraceIndex
      });
    }

    blocks.push({
      provider,
      body: input.slice(openBraceIndex + 1, closeBraceIndex)
    });
  }

  if (blocks.length === 0) {
    return err({
      reason: "no_provider_blocks"
    });
  }

  return ok(blocks);
}

function findMatchingBrace(input: string, openBraceIndex: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBraceIndex; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "#" || (char === "/" && next === "/")) {
      lineComment = true;
      if (char === "/" && next === "/") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function readStringAssignment(body: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]+)"\\s*$`, "m");
  return pattern.exec(body)?.[1]?.trim();
}

function normalizeTerraformProviderAddress(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const parts = normalized.split("/");
  if (parts.length < 3 || parts.some((part) => part === "")) {
    return undefined;
  }

  return parts.join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
