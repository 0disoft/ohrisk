import { existsSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import type { LicenseEvidence } from "./types";

const LUAROCKS_ROCKSPEC_MAX_BYTES = 1024 * 1024;

type RockspecMetadata = {
  license?: string;
  licenses?: string[];
};

export function collectLuarocksPackageEvidence(input: {
  packageId: string;
  packageName: string;
  version: string;
  projectRoot: string;
  rockspecMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const rockspecPath = findLuarocksRockspec({
    projectRoot: input.projectRoot,
    packageName: input.packageName,
    version: input.version
  });

  if (!rockspecPath) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: ["LuaRocks package rockspec was not found in the project root or local rocks tree."]
    });
  }

  const rockspec = readRockspecMetadata({
    packageId: input.packageId,
    rockspecPath,
    maxBytes: input.rockspecMaxBytes ?? LUAROCKS_ROCKSPEC_MAX_BYTES
  });

  if (!rockspec.ok) {
    return err(rockspec.error);
  }

  return ok({
    packageId: input.packageId,
    ...(rockspec.value.license
      ? {
          metadataLicense: rockspec.value.license,
          metadataSource: "rockspec"
        }
      : {}),
    ...(rockspec.value.licenses && rockspec.value.licenses.length > 0
      ? {
          metadataLicenses: rockspec.value.licenses,
          metadataSource: "rockspec"
        }
      : {}),
    files: [],
    source: "local",
    warnings: rockspec.value.license || rockspec.value.licenses
      ? []
      : ["LuaRocks rockspec did not declare license metadata."]
  });
}

function findLuarocksRockspec(input: {
  projectRoot: string;
  packageName: string;
  version: string;
}): string | undefined {
  if (!isSafeRockspecSegment(input.packageName) || !isSafeRockspecSegment(input.version)) {
    return undefined;
  }

  const fileName = `${input.packageName}-${input.version}.rockspec`;
  const candidates = [
    path.join(input.projectRoot, fileName),
    path.join(input.projectRoot, "rocks", input.packageName, input.version, fileName),
    path.join(input.projectRoot, "lua_modules", "lib", "luarocks", "rocks-5.1", input.packageName, input.version, fileName),
    path.join(input.projectRoot, "lua_modules", "lib", "luarocks", "rocks-5.2", input.packageName, input.version, fileName),
    path.join(input.projectRoot, "lua_modules", "lib", "luarocks", "rocks-5.3", input.packageName, input.version, fileName),
    path.join(input.projectRoot, "lua_modules", "lib", "luarocks", "rocks-5.4", input.packageName, input.version, fileName),
    path.join(input.projectRoot, ".luarocks", "lib", "luarocks", "rocks-5.1", input.packageName, input.version, fileName),
    path.join(input.projectRoot, ".luarocks", "lib", "luarocks", "rocks-5.2", input.packageName, input.version, fileName),
    path.join(input.projectRoot, ".luarocks", "lib", "luarocks", "rocks-5.3", input.packageName, input.version, fileName),
    path.join(input.projectRoot, ".luarocks", "lib", "luarocks", "rocks-5.4", input.packageName, input.version, fileName)
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function readRockspecMetadata(input: {
  packageId: string;
  rockspecPath: string;
  maxBytes: number;
}): Result<RockspecMetadata, OhriskError> {
  const text = readTextFileWithLimit({
    filePath: input.rockspecPath,
    maxBytes: input.maxBytes
  });

  if (!text.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(text.error),
        message: rockspecReadFailedMessage(text.error),
        details: {
          packageId: input.packageId,
          rockspecPath: input.rockspecPath,
          ...textFileReadErrorDetails(text.error)
        }
      })
    );
  }

  return ok(parseRockspecLicenseMetadata(text.value));
}

function parseRockspecLicenseMetadata(text: string): RockspecMetadata {
  const descriptionMatch = text.match(/\bdescription\s*=\s*{[\s\S]*?\blicense\s*=\s*(["'])([^"'\r\n]+)\1[\s\S]*?}/);
  if (descriptionMatch?.[2]) {
    return { license: descriptionMatch[2].trim() };
  }

  const topLevelMatch = text.match(/(?:^|\n)\s*license\s*=\s*(["'])([^"'\r\n]+)\1/);
  if (topLevelMatch?.[2]) {
    return { license: topLevelMatch[2].trim() };
  }

  const tableMatch = text.match(/\blicense\s*=\s*{([\s\S]*?)}/);
  if (!tableMatch?.[1]) {
    return {};
  }

  const licenses = [...tableMatch[1].matchAll(/(["'])([^"'\r\n]+)\1/g)]
    .map((match) => match[2]?.trim())
    .filter((value): value is string => value !== undefined && value !== "");

  return licenses.length > 0 ? { licenses } : {};
}

function isSafeRockspecSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value);
}

function rockspecReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "LuaRocks rockspec metadata exceeded the maximum supported size."
    : "Failed to read LuaRocks rockspec metadata.";
}
