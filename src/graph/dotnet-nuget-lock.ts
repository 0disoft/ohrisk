import { omitUndefined } from "../shared/object";
import { existsSync } from "node:fs";
import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type NugetPackageRecord = {
  name: string;
  version: string;
  id: string;
  dependencyType: DependencyType;
  direct: boolean;
  dependencies: string[];
};

export type DotnetCentralPackageVersions = {
  path?: string;
  versions: Map<string, string>;
  unresolved: Map<string, string>;
};

export function parseNugetLockfile(
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
        code: "NUGET_LOCK_READ_FAILED",
        category: inputFileReadErrorCategory(lockfileText.error),
        message: lockfileText.error.kind === "too_large"
          ? "packages.lock.json exceeded the maximum supported size."
          : "Failed to read packages.lock.json.",
        details: {
          lockfilePath,
          ...inputFileReadErrorDetails(lockfileText.error)
        }
      })
    );
  }

  return parseNugetLockText(lockfileText.value, lockfilePath);
}

export function parseNugetProjectAssetsFile(
  assetsPath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const assetsText = readInputTextFile({
    filePath: assetsPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!assetsText.ok) {
    return err(
      createError({
        code: "NUGET_ASSETS_READ_FAILED",
        category: inputFileReadErrorCategory(assetsText.error),
        message: assetsText.error.kind === "too_large"
          ? "project.assets.json exceeded the maximum supported size."
          : "Failed to read project.assets.json.",
        details: {
          lockfilePath: assetsPath,
          ...inputFileReadErrorDetails(assetsText.error)
        }
      })
    );
  }

  return parseNugetProjectAssetsText(assetsText.value, assetsPath);
}

export function parseDotnetProjectFile(
  projectFilePath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const projectFileText = readInputTextFile({
    filePath: projectFilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!projectFileText.ok) {
    return err(
      createError({
        code: "DOTNET_PROJECT_READ_FAILED",
        category: inputFileReadErrorCategory(projectFileText.error),
        message: projectFileText.error.kind === "too_large"
          ? ".NET project file exceeded the maximum supported size."
          : "Failed to read .NET project file.",
        details: {
          lockfilePath: projectFilePath,
          ...inputFileReadErrorDetails(projectFileText.error)
        }
      })
    );
  }

  const centralPackageVersions = readNearestDirectoryPackagesProps({
    projectFilePath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!centralPackageVersions.ok) {
    return centralPackageVersions;
  }

  return parseDotnetProjectText(projectFileText.value, projectFilePath, omitUndefined({
    centralPackageVersions: centralPackageVersions.value
  }));
}

export function parseNugetPackagesConfigFile(
  packagesConfigPath: string,
  options: { maxBytes?: number } = {}
): Result<DependencyGraph, OhriskError> {
  const packagesConfigText = readInputTextFile({
    filePath: packagesConfigPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!packagesConfigText.ok) {
    return err(
      createError({
        code: "NUGET_PACKAGES_CONFIG_READ_FAILED",
        category: inputFileReadErrorCategory(packagesConfigText.error),
        message: packagesConfigText.error.kind === "too_large"
          ? "packages.config exceeded the maximum supported size."
          : "Failed to read packages.config.",
        details: {
          lockfilePath: packagesConfigPath,
          ...inputFileReadErrorDetails(packagesConfigText.error)
        }
      })
    );
  }

  return parseNugetPackagesConfigText(packagesConfigText.value, packagesConfigPath);
}

export function parseNugetLockText(
  input: string,
  lockfilePath = "packages.lock.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseNugetLockJson(input, lockfilePath);
  if (!parsed.ok) {
    return parsed;
  }

  const rootName = path.basename(path.dirname(lockfilePath)) || "<dotnet-project>";
  return ok(graphFromNugetRecords({
    rootName,
    lockfilePath,
    records: parsed.value
  }));
}

export function parseNugetProjectAssetsText(
  input: string,
  assetsPath = "obj/project.assets.json"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseNugetProjectAssetsJson(input, assetsPath);
  if (!parsed.ok) {
    return parsed;
  }

  return ok(graphFromNugetRecords({
    rootName: nugetProjectRootName(assetsPath, "<dotnet-project>"),
    lockfilePath: assetsPath,
    records: parsed.value
  }));
}

export function parseDotnetProjectText(
  input: string,
  projectFilePath = "project.csproj",
  options: {
    centralPackageVersions?: DotnetCentralPackageVersions;
    rootName?: string;
  } = {}
): Result<DependencyGraph, OhriskError> {
  const parsed = parseDotnetProjectXml(input, projectFilePath, options);
  if (!parsed.ok) {
    return parsed;
  }

  return ok(graphFromNugetRecords({
    rootName: options.rootName ?? (path.basename(projectFilePath, path.extname(projectFilePath)) || "<dotnet-project>"),
    lockfilePath: projectFilePath,
    records: parsed.value
  }));
}

export function parseDirectoryPackagesPropsText(
  input: string,
  propsPath = "Directory.Packages.props"
): Result<DotnetCentralPackageVersions, OhriskError> {
  const parsed = parseDirectoryPackagesPropsXml(input);
  if (!parsed.ok) {
    return parsed;
  }

  return ok({
    path: propsPath,
    versions: parsed.value.versions,
    unresolved: parsed.value.unresolved
  });
}

export function parseNugetPackagesConfigText(
  input: string,
  packagesConfigPath = "packages.config"
): Result<DependencyGraph, OhriskError> {
  const parsed = parseNugetPackagesConfigXml(input, packagesConfigPath);
  if (!parsed.ok) {
    return parsed;
  }

  return ok(graphFromNugetRecords({
    rootName: path.basename(path.dirname(packagesConfigPath)) || "<dotnet-project>",
    lockfilePath: packagesConfigPath,
    records: parsed.value
  }));
}

function parseNugetLockJson(
  input: string,
  lockfilePath: string
): Result<NugetPackageRecord[], OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json.",
        details: {
          lockfilePath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json. Ohrisk expected a dependencies object.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const records = new Map<string, NugetPackageRecord>();
  for (const [targetName, targetDependencies] of Object.entries(parsed.dependencies)) {
    if (!isRecord(targetDependencies)) {
      continue;
    }

    for (const [packageName, value] of Object.entries(targetDependencies)) {
      if (!isRecord(value)) {
        return nugetDependencyParseError(lockfilePath, targetName, packageName);
      }

      const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
      if (type === "project") {
        continue;
      }

      if (typeof value.resolved !== "string" || value.resolved.trim() === "") {
        return nugetDependencyParseError(lockfilePath, targetName, packageName);
      }

      const record = {
        name: packageName,
        version: value.resolved,
        id: `${packageName}@${value.resolved}`,
        dependencyType: "production" as const,
        direct: type === "direct",
        dependencies: readNugetDependencyNames(value.dependencies)
      };
      const existing = records.get(record.id);
      records.set(record.id, existing
        ? {
            ...existing,
            direct: existing.direct || record.direct,
            dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
            dependencies: [...new Set([...existing.dependencies, ...record.dependencies])].sort()
          }
        : record);
    }
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "NUGET_LOCK_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.lock.json. Ohrisk expected at least one package dependency.",
        details: {
          lockfilePath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function parseNugetPackagesConfigXml(
  input: string,
  packagesConfigPath: string
): Result<NugetPackageRecord[], OhriskError> {
  const records = new Map<string, NugetPackageRecord>();
  const packageMatches = input.matchAll(/<package\b([^>]*?)(?:\/>|>\s*<\/package>)/gi);

  for (const match of packageMatches) {
    const attributes = readXmlAttributes(match[1] ?? "");
    const name = readXmlAttribute(attributes, "id");
    const version = readXmlAttribute(attributes, "version");
    if (!name || !version) {
      return err(
        createError({
          code: "NUGET_PACKAGES_CONFIG_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse packages.config package entry. Ohrisk requires package id and exact version attributes.",
          details: {
            lockfilePath: packagesConfigPath,
            packageEntry: normalizeXmlSnippet(match[0] ?? "")
          }
        })
      );
    }

    upsertNugetPackageRecord(records, {
      name,
      version,
      id: `${name}@${version}`,
      dependencyType: readXmlAttribute(attributes, "developmentDependency")?.toLowerCase() === "true"
        ? "development"
        : "production",
      direct: true,
      dependencies: []
    });
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "NUGET_PACKAGES_CONFIG_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse packages.config. Ohrisk expected at least one package entry with id and version.",
        details: {
          lockfilePath: packagesConfigPath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function parseNugetProjectAssetsJson(
  input: string,
  assetsPath: string
): Result<NugetPackageRecord[], OhriskError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch (cause) {
    return err(
      createError({
        code: "NUGET_ASSETS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse project.assets.json.",
        details: {
          lockfilePath: assetsPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  if (!isRecord(parsed)) {
    return err(
      createError({
        code: "NUGET_ASSETS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse project.assets.json. Ohrisk expected a JSON object.",
        details: {
          lockfilePath: assetsPath
        }
      })
    );
  }

  const directNames = readNugetProjectFileDependencyNames(parsed.projectFileDependencyGroups);
  const records = new Map<string, NugetPackageRecord>();

  if (isRecord(parsed.targets)) {
    for (const targetPackages of Object.values(parsed.targets)) {
      if (!isRecord(targetPackages)) {
        continue;
      }

      for (const [packageKey, value] of Object.entries(targetPackages)) {
        if (!isRecord(value)) {
          return nugetAssetsEntryParseError(assetsPath, packageKey);
        }

        const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
        if (type !== "package") {
          continue;
        }

        const identity = parseNugetAssetsPackageKey(packageKey);
        if (!identity) {
          return nugetAssetsEntryParseError(assetsPath, packageKey);
        }

        upsertNugetPackageRecord(records, {
          name: identity.name,
          version: identity.version,
          id: `${identity.name}@${identity.version}`,
          dependencyType: "production",
          direct: directNames.has(identity.name.toLowerCase()),
          dependencies: readNugetDependencyNames(value.dependencies)
        });
      }
    }
  }

  if (isRecord(parsed.libraries)) {
    for (const [packageKey, value] of Object.entries(parsed.libraries)) {
      if (!isRecord(value)) {
        return nugetAssetsEntryParseError(assetsPath, packageKey);
      }

      const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
      if (type !== "package") {
        continue;
      }

      const identity = parseNugetAssetsPackageKey(packageKey);
      if (!identity) {
        return nugetAssetsEntryParseError(assetsPath, packageKey);
      }

      const id = `${identity.name}@${identity.version}`;
      if (!records.has(id)) {
        upsertNugetPackageRecord(records, {
          name: identity.name,
          version: identity.version,
          id,
          dependencyType: "production",
          direct: directNames.has(identity.name.toLowerCase()),
          dependencies: []
        });
      }
    }
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "NUGET_ASSETS_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse project.assets.json. Ohrisk expected at least one NuGet package in targets or libraries.",
        details: {
          lockfilePath: assetsPath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function parseDotnetProjectXml(
  input: string,
  projectFilePath: string,
  options: { centralPackageVersions?: DotnetCentralPackageVersions } = {}
): Result<NugetPackageRecord[], OhriskError> {
  const records = new Map<string, NugetPackageRecord>();
  const projectProperties = readUnconditionalDotnetProjectProperties(input);
  const packageReferenceMatches = input.matchAll(
    /<PackageReference\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageReference>)/gi
  );

  for (const match of packageReferenceMatches) {
    const attributes = readXmlAttributes(match[1] ?? "");
    const name = readXmlAttribute(attributes, "Include");
    if (!name) {
      continue;
    }

    const rawVersion = readXmlAttribute(attributes, "Version") ?? readXmlTagText(match[2] ?? "", "Version");
    const centralKey = name.toLowerCase();
    const centralVersion = rawVersion
      ? undefined
      : options.centralPackageVersions?.versions.get(centralKey);
    const unresolvedCentralVersion = rawVersion
      ? undefined
      : options.centralPackageVersions?.unresolved.get(centralKey);
    const version = resolveDotnetProjectPackageVersion(rawVersion, projectProperties)
      ?? centralVersion;
    if (!version) {
      return err(
        createError({
          code: "DOTNET_PROJECT_PARSE_FAILED",
          category: "unsupported_input",
          message: unresolvedCentralVersion
            ? "Failed to parse centrally managed .NET PackageReference. Ohrisk requires a single literal PackageVersion in Directory.Packages.props."
            : "Failed to parse .NET project PackageReference. Ohrisk requires a literal resolved Version or a matching literal PackageVersion in Directory.Packages.props; use obj/project.assets.json for restored versions.",
          details: {
            lockfilePath: projectFilePath,
            packageName: name,
            version: rawVersion ?? "none",
            centralPackagesPath: options.centralPackageVersions?.path ?? "none",
            centralVersion: unresolvedCentralVersion ?? centralVersion ?? "none"
          }
        })
      );
    }

    upsertNugetPackageRecord(records, {
      name,
      version,
      id: `${name}@${version}`,
      dependencyType: "production",
      direct: true,
      dependencies: []
    });
  }

  const packageDownloadMatches = input.matchAll(
    /<PackageDownload\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageDownload>)/gi
  );

  for (const match of packageDownloadMatches) {
    const attributes = readXmlAttributes(match[1] ?? "");
    const name = readXmlAttribute(attributes, "Include");
    if (!name) {
      continue;
    }

    const rawVersion = readXmlAttribute(attributes, "Version")
      ?? readXmlTagText(match[2] ?? "", "Version");
    const version = resolveDotnetProjectPackageVersion(rawVersion, projectProperties);
    if (!version) {
      return err(
        createError({
          code: "DOTNET_PROJECT_PARSE_FAILED",
          category: "unsupported_input",
          message: "Failed to parse .NET project PackageDownload. Ohrisk requires an exact literal version or an exact range containing one unconditional same-file property reference.",
          details: {
            lockfilePath: projectFilePath,
            packageName: name,
            version: rawVersion ?? "none"
          }
        })
      );
    }

    upsertNugetPackageRecord(records, {
      name,
      version,
      id: `${name}@${version}`,
      dependencyType: "production",
      direct: true,
      dependencies: []
    });
  }

  if (records.size === 0) {
    return err(
      createError({
        code: "DOTNET_PROJECT_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse .NET project file. Ohrisk expected at least one PackageReference or PackageDownload with a resolvable exact version.",
        details: {
          lockfilePath: projectFilePath
        }
      })
    );
  }

  return ok([...records.values()]);
}

function readNearestDirectoryPackagesProps(input: {
  projectFilePath: string;
  maxBytes: number;
}): Result<DotnetCentralPackageVersions | undefined, OhriskError> {
  const propsPath = findNearestDirectoryPackagesPropsPath(input.projectFilePath);
  if (!propsPath) {
    return ok(undefined);
  }

  const propsText = readInputTextFile({
    filePath: propsPath,
    maxBytes: input.maxBytes
  });

  if (!propsText.ok) {
    return err(
      createError({
        code: "DOTNET_PROJECT_READ_FAILED",
        category: inputFileReadErrorCategory(propsText.error),
        message: propsText.error.kind === "too_large"
          ? "Directory.Packages.props exceeded the maximum supported size."
          : "Failed to read Directory.Packages.props.",
        details: {
          lockfilePath: input.projectFilePath,
          centralPackagesPath: propsPath,
          ...inputFileReadErrorDetails(propsText.error)
        }
      })
    );
  }

  return parseDirectoryPackagesPropsText(propsText.value, propsPath);
}

export function findNearestDirectoryPackagesPropsPath(projectFilePath: string): string | undefined {
  let current = path.dirname(path.resolve(projectFilePath));

  while (true) {
    const candidate = path.join(current, "Directory.Packages.props");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

function parseDirectoryPackagesPropsXml(
  input: string
): Result<{ versions: Map<string, string>; unresolved: Map<string, string> }, OhriskError> {
  const versions = new Map<string, string>();
  const unresolved = new Map<string, string>();
  const packageVersionMatches = input.matchAll(
    /<PackageVersion\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PackageVersion>)/gi
  );

  for (const match of packageVersionMatches) {
    const attributes = readXmlAttributes(match[1] ?? "");
    const name = readXmlAttribute(attributes, "Include") ?? readXmlAttribute(attributes, "Update");
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const rawVersion = readXmlAttribute(attributes, "Version") ?? readXmlTagText(match[2] ?? "", "Version");
    const version = normalizeDotnetProjectPackageVersion(rawVersion);
    const existingVersion = versions.get(key);
    const existingUnresolved = unresolved.get(key);

    if (!version) {
      versions.delete(key);
      unresolved.set(key, rawVersion ? `unresolved:${rawVersion}` : "missing");
      continue;
    }

    if ((existingVersion && existingVersion !== version) || existingUnresolved) {
      versions.delete(key);
      unresolved.set(key, "ambiguous");
      continue;
    }

    versions.set(key, version);
  }

  return ok({ versions, unresolved });
}

function graphFromNugetRecords(input: {
  rootName: string;
  lockfilePath: string;
  records: NugetPackageRecord[];
}): DependencyGraph {
  const roots = input.records.filter((record) => record.direct);
  const nodeMap = new Map<string, DependencyNode>();

  for (const root of roots.length > 0 ? roots : inferNugetRootRecords(input.records)) {
    walkNugetDependency({
      record: root,
      dependencyType: root.dependencyType,
      direct: true,
      path: [input.rootName],
      records: input.records,
      nodeMap,
      seen: new Set()
    });
  }

  return {
    rootName: input.rootName,
    lockfilePath: input.lockfilePath,
    nodes: [...nodeMap.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
}

function upsertNugetPackageRecord(
  records: Map<string, NugetPackageRecord>,
  record: NugetPackageRecord
): void {
  const existing = records.get(record.id);
  records.set(record.id, existing
    ? {
        ...existing,
        direct: existing.direct || record.direct,
        dependencyType: mergeDependencyType(existing.dependencyType, record.dependencyType),
        dependencies: [...new Set([...existing.dependencies, ...record.dependencies])].sort()
      }
    : record);
}

function readNugetDependencyNames(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value).sort();
}

function readNugetProjectFileDependencyNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRecord(value)) {
    return names;
  }

  for (const dependencies of Object.values(value)) {
    if (!Array.isArray(dependencies)) {
      continue;
    }

    for (const dependency of dependencies) {
      if (typeof dependency !== "string") {
        continue;
      }

      const name = dependency.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1];
      if (name) {
        names.add(name.toLowerCase());
      }
    }
  }

  return names;
}

function parseNugetAssetsPackageKey(value: string): { name: string; version: string } | undefined {
  const slashIndex = value.lastIndexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return undefined;
  }

  const name = value.slice(0, slashIndex).trim();
  const version = value.slice(slashIndex + 1).trim();
  return name && version ? { name, version } : undefined;
}

function normalizeDotnetProjectPackageVersion(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const version = value.trim();
  if (!version || version.includes("$(") || version.includes("*") || version.includes(",")) {
    return undefined;
  }

  const exactRange = version.match(/^\[\s*([^\]\s,]+)\s*\]$/)?.[1];
  if (exactRange) {
    return exactRange;
  }

  if (version.includes("[") || version.includes("]") || version.includes("(") || version.includes(")")) {
    return undefined;
  }

  return version;
}

function resolveDotnetProjectPackageVersion(
  value: string | undefined,
  properties: ReadonlyMap<string, string>
): string | undefined {
  const direct = normalizeDotnetProjectPackageVersion(value);
  if (direct) {
    return direct;
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const propertyName = trimmed.match(/^\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)$/)?.[1]
    ?? trimmed.match(/^\[\s*\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)\s*\]$/)?.[1];
  if (!propertyName) {
    return undefined;
  }

  return normalizeDotnetProjectPackageVersion(properties.get(propertyName.toLowerCase()));
}

function readUnconditionalDotnetProjectProperties(input: string): Map<string, string> {
  const properties = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const groupMatch of input.matchAll(
    /<PropertyGroup\b([^>]*)>([\s\S]*?)<\/PropertyGroup>/gi
  )) {
    const groupAttributes = readXmlAttributes(groupMatch[1] ?? "");
    if (readXmlAttribute(groupAttributes, "Condition") !== undefined) {
      continue;
    }

    for (const propertyMatch of (groupMatch[2] ?? "").matchAll(
      /<([A-Za-z_][A-Za-z0-9_.-]*)\b([^>]*)>([^<]*)<\/\1>/g
    )) {
      const name = propertyMatch[1];
      if (!name) {
        continue;
      }
      const attributes = readXmlAttributes(propertyMatch[2] ?? "");
      if (readXmlAttribute(attributes, "Condition") !== undefined) {
        continue;
      }

      const value = decodeXmlText(propertyMatch[3] ?? "").trim();
      if (!value) {
        continue;
      }

      const key = name.toLowerCase();
      const existing = properties.get(key);
      if (ambiguous.has(key) || (existing !== undefined && existing !== value)) {
        properties.delete(key);
        ambiguous.add(key);
        continue;
      }
      properties.set(key, value);
    }
  }

  return properties;
}

function readXmlAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(/([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key && value !== undefined) {
      attributes.set(key, decodeXmlText(value));
    }
  }

  return attributes;
}

function readXmlAttribute(attributes: Map<string, string>, name: string): string | undefined {
  const direct = attributes.get(name);
  if (direct !== undefined) {
    return direct;
  }

  const normalized = name.toLowerCase();
  for (const [key, value] of attributes) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }

  return undefined;
}

function readXmlTagText(text: string, tag: string): string | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1] ? decodeXmlText(match[1].trim()) : undefined;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function nugetProjectRootName(filePath: string, fallback: string): string {
  const fileName = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const rootDir = fileName === "project.assets.json" && path.basename(dir).toLowerCase() === "obj"
    ? path.dirname(dir)
    : dir;
  return path.basename(rootDir) || fallback;
}

function normalizeXmlSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function inferNugetRootRecords(records: NugetPackageRecord[]): NugetPackageRecord[] {
  const referenced = new Set<string>();
  for (const record of records) {
    for (const dependency of record.dependencies) {
      for (const resolved of resolveNugetPackageRecords(records, dependency)) {
        referenced.add(resolved.id);
      }
    }
  }

  return records
    .filter((record) => !referenced.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function walkNugetDependency(input: {
  record: NugetPackageRecord;
  dependencyType: DependencyType;
  direct: boolean;
  path: string[];
  records: NugetPackageRecord[];
  nodeMap: Map<string, DependencyNode>;
  seen: Set<string>;
}): void {
  if (input.seen.has(input.record.id)) {
    return;
  }

  const nextSeen = new Set(input.seen);
  nextSeen.add(input.record.id);
  const nextPath = [...input.path, input.record.id];
  const existing = input.nodeMap.get(input.record.id);

  if (existing) {
    existing.direct = existing.direct || input.direct;
    existing.dependencyType = mergeDependencyType(existing.dependencyType, input.dependencyType);
    existing.paths.push(nextPath);
  } else {
    input.nodeMap.set(input.record.id, {
      id: input.record.id,
      name: input.record.name,
      version: input.record.version,
      ecosystem: "nuget",
      dependencyType: input.dependencyType,
      direct: input.direct,
      paths: [nextPath]
    });
  }

  for (const dependency of input.record.dependencies) {
    const matches = resolveNugetPackageRecords(input.records, dependency);
    if (matches.length !== 1) {
      continue;
    }

    walkNugetDependency({
      record: matches[0] as NugetPackageRecord,
      dependencyType: input.dependencyType,
      direct: false,
      path: nextPath,
      records: input.records,
      nodeMap: input.nodeMap,
      seen: nextSeen
    });
  }
}

function resolveNugetPackageRecords(records: NugetPackageRecord[], name: string): NugetPackageRecord[] {
  const normalized = name.toLowerCase();
  return records.filter((record) => record.name.toLowerCase() === normalized);
}

function nugetDependencyParseError(
  lockfilePath: string,
  targetName: string,
  packageName: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "NUGET_LOCK_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse packages.lock.json dependency entry. Ohrisk requires package entries with resolved versions.",
      details: {
        lockfilePath,
        targetName,
        packageName
      }
    })
  );
}

function nugetAssetsEntryParseError(
  assetsPath: string,
  packageKey: string
): Result<never, OhriskError> {
  return err(
    createError({
      code: "NUGET_ASSETS_PARSE_FAILED",
      category: "unsupported_input",
      message: "Failed to parse project.assets.json package entry. Ohrisk requires NuGet package entries shaped as name/version.",
      details: {
        lockfilePath: assetsPath,
        packageKey
      }
    })
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
