import path from "node:path";

import { createError, type OhriskError } from "../shared/errors";
import { findMavenPomInRepository, mavenRepositoryRoots } from "../shared/maven-repository";
import { err, ok, type Result } from "../shared/result";
import {
  inputFileReadErrorCategory,
  inputFileReadErrorDetails,
  LOCKFILE_MAX_BYTES,
  readInputTextFile
} from "./read-input-file";
import type { DependencyGraph, DependencyNode, DependencyType } from "./types";

type MavenPomDependency = {
  groupId: string;
  artifactId: string;
  version: string;
  scope?: string;
  optional: boolean;
};

type MavenPomProject = {
  rootName?: string;
  groupId?: string;
  version?: string;
  properties: Map<string, string>;
};

type MavenPomModel = MavenPomProject & {
  managedVersions: Map<string, string>;
};

type MavenPomParseOptions = {
  projectRoot?: string;
  mavenRepositoryRoots?: string[];
  maxBytes?: number;
  maxExternalPomDepth?: number;
};

type MavenPomParseContext = {
  repositoryRoots: string[];
  maxBytes: number;
  maxExternalPomDepth: number;
  visitedExternalPoms: Set<string>;
  missingExternalPoms: MissingExternalMavenPom[];
};

type MavenPomCoordinates = {
  groupId: string;
  artifactId: string;
  version: string;
};

type MissingExternalMavenPom = {
  usage: "parent" | "imported_bom";
  dependency: string;
};

export function parseMavenPomFile(
  pomPath: string,
  options: MavenPomParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  const pomText = readInputTextFile({
    filePath: pomPath,
    maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES
  });

  if (!pomText.ok) {
    return err(
      createError({
        code: "MAVEN_POM_READ_FAILED",
        category: inputFileReadErrorCategory(pomText.error),
        message: pomText.error.kind === "too_large"
          ? "pom.xml exceeded the maximum supported size."
          : "Failed to read pom.xml.",
        details: {
          lockfilePath: pomPath,
          ...inputFileReadErrorDetails(pomText.error)
        }
      })
    );
  }

  return parseMavenPomText(pomText.value, pomPath, {
    ...options,
    projectRoot: options.projectRoot ?? path.dirname(pomPath)
  });
}

export function parseMavenPomText(
  input: string,
  pomPath = "pom.xml",
  options: MavenPomParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  try {
    const projectRoot = options.projectRoot ?? mavenProjectRootFromPomPath(pomPath);
    const context: MavenPomParseContext = {
      repositoryRoots: mavenRepositoryRoots(projectRoot, options.mavenRepositoryRoots),
      maxBytes: options.maxBytes ?? LOCKFILE_MAX_BYTES,
      maxExternalPomDepth: options.maxExternalPomDepth ?? 8,
      visitedExternalPoms: new Set(),
      missingExternalPoms: []
    };
    const scannedProject = stripUnsupportedMavenSections(input);
    const model = readMavenPomModel(scannedProject, pomPath, context, 0);

    if (!model.ok) {
      return model;
    }

    const rootName = model.value.rootName ?? "<maven-project>";
    const dependencies = readMavenPomDependencies(scannedProject, model.value, pomPath, context);

    if (!dependencies.ok) {
      return dependencies;
    }

    return ok({
      rootName,
      lockfilePath: pomPath,
      nodes: dependencies.value
        .map((dependency): DependencyNode => {
          const name = `${dependency.groupId}:${dependency.artifactId}`;
          const id = `${name}@${dependency.version}`;
          return {
            id,
            name,
            version: dependency.version,
            ecosystem: "maven",
            dependencyType: dependencyTypeForMavenDependency(dependency),
            direct: true,
            paths: [[rootName, id]]
          };
        })
        .sort((left, right) => left.id.localeCompare(right.id))
    });
  } catch (cause) {
    return err(
      createError({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pom.xml.",
        details: {
          lockfilePath: pomPath,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }
}

function readMavenPomModel(
  text: string,
  pomPath: string,
  context: MavenPomParseContext,
  depth: number
): Result<MavenPomModel, OhriskError> {
  if (depth > context.maxExternalPomDepth) {
    return err(
      createError({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pom.xml. Maven parent or BOM resolution exceeded the maximum supported depth.",
        details: {
          lockfilePath: pomPath,
          maxExternalPomDepth: context.maxExternalPomDepth
        }
      })
    );
  }

  const parent = readMavenParentModel(text, pomPath, context, depth);
  if (!parent.ok) {
    return parent;
  }

  const project = readMavenPomProject(text, parent.value);
  const ownManagedVersions = readMavenDependencyManagementVersions(
    text,
    project.properties,
    pomPath,
    context,
    depth
  );

  if (!ownManagedVersions.ok) {
    return ownManagedVersions;
  }

  return ok({
    ...project,
    managedVersions: mergeMavenManagedVersions(
      parent.value?.managedVersions,
      ownManagedVersions.value
    )
  });
}

function readMavenParentModel(
  text: string,
  pomPath: string,
  context: MavenPomParseContext,
  depth: number
): Result<MavenPomModel | undefined, OhriskError> {
  const parent = readMavenParentCoordinates(text);
  if (!parent) {
    return ok(undefined);
  }

  return readExternalMavenPomModel(parent, pomPath, context, depth + 1);
}

function readExternalMavenPomModel(
  coordinates: MavenPomCoordinates,
  pomPath: string,
  context: MavenPomParseContext,
  depth: number,
  usage: MissingExternalMavenPom["usage"] = "parent"
): Result<MavenPomModel | undefined, OhriskError> {
  const externalPomPath = findMavenPomInRepository({
    repositoryRoots: context.repositoryRoots,
    groupId: coordinates.groupId,
    artifactId: coordinates.artifactId,
    version: coordinates.version
  });

  if (!externalPomPath) {
    recordMissingExternalMavenPom(context, {
      usage,
      dependency: mavenDependencyId(coordinates)
    });
    return ok(undefined);
  }

  const visitedKey = mavenDependencyId(coordinates);
  if (context.visitedExternalPoms.has(visitedKey)) {
    return err(
      createError({
        code: "MAVEN_POM_PARSE_FAILED",
        category: "unsupported_input",
        message: "Failed to parse pom.xml. Maven parent or BOM POMs contain a cycle.",
        details: {
          lockfilePath: pomPath,
          dependency: visitedKey
        }
      })
    );
  }

  const externalPom = readInputTextFile({
    filePath: externalPomPath,
    maxBytes: context.maxBytes
  });

  if (!externalPom.ok) {
    return err(
      createError({
        code: "MAVEN_POM_READ_FAILED",
        category: inputFileReadErrorCategory(externalPom.error),
        message: externalPom.error.kind === "too_large"
          ? "External Maven parent or BOM POM exceeded the maximum supported size."
          : "Failed to read external Maven parent or BOM POM.",
        details: {
          lockfilePath: pomPath,
          pomPath: externalPomPath,
          dependency: visitedKey,
          ...inputFileReadErrorDetails(externalPom.error)
        }
      })
    );
  }

  context.visitedExternalPoms.add(visitedKey);
  try {
    return readMavenPomModel(
      stripUnsupportedMavenSections(externalPom.value),
      externalPomPath,
      context,
      depth
    );
  } finally {
    context.visitedExternalPoms.delete(visitedKey);
  }
}

function readMavenPomProject(text: string, parent: MavenPomModel | undefined): MavenPomProject {
  const projectText = stripXmlSection(text, "parent");
  const properties = new Map(parent?.properties);
  const parentCoordinates = readMavenParentCoordinates(text);
  if (parentCoordinates) {
    properties.set("project.parent.groupId", parentCoordinates.groupId);
    properties.set("pom.parent.groupId", parentCoordinates.groupId);
    properties.set("project.parent.artifactId", parentCoordinates.artifactId);
    properties.set("pom.parent.artifactId", parentCoordinates.artifactId);
    properties.set("project.parent.version", parentCoordinates.version);
    properties.set("pom.parent.version", parentCoordinates.version);
  }

  for (const [key, value] of readPomProperties(projectText)) {
    properties.set(key, value);
  }

  const groupId = readXmlTagText(projectText, "groupId") ?? parent?.groupId;
  const artifactId = readXmlTagText(projectText, "artifactId");
  const rawVersion = readXmlTagText(projectText, "version");
  const version = rawVersion
    ? resolveMavenExpression(rawVersion, properties)
    : parent?.version;

  if (groupId) {
    properties.set("project.groupId", groupId);
    properties.set("pom.groupId", groupId);
  }
  if (version) {
    properties.set("project.version", version);
    properties.set("pom.version", version);
  }

  return {
    ...(artifactId ? { rootName: artifactId } : {}),
    ...(groupId ? { groupId } : {}),
    ...(version ? { version } : {}),
    properties
  };
}

function readMavenPomDependencies(
  text: string,
  model: MavenPomModel,
  pomPath: string,
  context: MavenPomParseContext
): Result<MavenPomDependency[], OhriskError> {
  const dependencies: MavenPomDependency[] = [];
  const scannedText = stripXmlSections(text, [
    "dependencyManagement",
    "build",
    "reporting",
    "profiles"
  ]);
  const dependencySections = scannedText.matchAll(/<dependencies\b[^>]*>([\s\S]*?)<\/dependencies>/gi);

  for (const section of dependencySections) {
    const dependencyBlocks = section[1]?.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi) ?? [];
    for (const block of dependencyBlocks) {
      const dependencyText = block[1] ?? "";
      const groupId = readXmlTagText(dependencyText, "groupId");
      const artifactId = readXmlTagText(dependencyText, "artifactId");
      const rawVersion = readXmlTagText(dependencyText, "version");

      if (!groupId || !artifactId) {
        return err(
          createError({
            code: "MAVEN_POM_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pom.xml dependency entry. Ohrisk requires groupId and artifactId.",
            details: {
              lockfilePath: pomPath,
              dependency: normalizePomText(dependencyText)
            }
          })
        );
      }

      const managedVersion = groupId && artifactId
        ? model.managedVersions.get(mavenCoordinateKey(groupId, artifactId))
        : undefined;
      const rawResolvedVersion = rawVersion ?? managedVersion;

      if (!rawResolvedVersion) {
        return err(
          createError({
            code: "MAVEN_POM_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pom.xml dependency entry. Dependency version was not explicit and local Maven parent/BOM metadata did not provide one.",
            details: {
              lockfilePath: pomPath,
              dependency: `${groupId}:${artifactId}`,
              reason: "missing_dependency_version",
              supportedVersionSources: [
                "explicit dependency <version>",
                "pom.xml properties",
                "same-file dependencyManagement",
                "local .m2 parent POM",
                "local .m2 imported BOM POM"
              ],
              ...mavenResolutionDetails(context)
            }
          })
        );
      }

      const version = resolveMavenExpression(rawResolvedVersion, model.properties);
      if (!version || version.includes("${")) {
        return err(
          createError({
            code: "MAVEN_POM_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pom.xml dependency version. Ohrisk could not resolve the version from pom.xml properties or local Maven parent/BOM metadata.",
            details: {
              lockfilePath: pomPath,
              dependency: `${groupId}:${artifactId}`,
              version: rawResolvedVersion,
              reason: "unresolved_maven_version",
              ...mavenResolutionDetails(context)
            }
          })
        );
      }

      dependencies.push({
        groupId,
        artifactId,
        version,
        scope: readXmlTagText(dependencyText, "scope"),
        optional: readXmlTagText(dependencyText, "optional") === "true"
      });
    }
  }

  return ok(deduplicateMavenDependencies(dependencies));
}

function readMavenDependencyManagementVersions(
  text: string,
  properties: Map<string, string>,
  pomPath: string,
  context: MavenPomParseContext,
  depth: number
): Result<Map<string, string>, OhriskError> {
  const managedVersions = new Map<string, string>();
  const dependencyManagementSections = text.matchAll(
    /<dependencyManagement\b[^>]*>([\s\S]*?)<\/dependencyManagement>/gi
  );

  for (const section of dependencyManagementSections) {
    const dependencyBlocks = section[1]?.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi) ?? [];
    for (const block of dependencyBlocks) {
      const dependencyText = block[1] ?? "";
      const groupId = readXmlTagText(dependencyText, "groupId");
      const artifactId = readXmlTagText(dependencyText, "artifactId");
      const rawVersion = readXmlTagText(dependencyText, "version");
      const type = readXmlTagText(dependencyText, "type")?.toLowerCase();
      const scope = readXmlTagText(dependencyText, "scope")?.toLowerCase();

      if (!groupId || !artifactId || !rawVersion) {
        continue;
      }

      if (type === "pom" && scope === "import") {
        const version = resolveMavenExpression(rawVersion, properties);
        if (!version || version.includes("${")) {
          continue;
        }

        const bomModel = readExternalMavenPomModel(
          { groupId, artifactId, version },
          pomPath,
          context,
          depth + 1,
          "imported_bom"
        );
        if (!bomModel.ok) {
          return bomModel;
        }

        for (const [key, managedVersion] of bomModel.value?.managedVersions ?? []) {
          managedVersions.set(key, managedVersion);
        }
        continue;
      }

      const version = resolveMavenExpression(rawVersion, properties);
      if (version && !version.includes("${")) {
        managedVersions.set(mavenCoordinateKey(groupId, artifactId), version);
      }
    }
  }

  return ok(managedVersions);
}

function mergeMavenManagedVersions(
  parentVersions: Map<string, string> | undefined,
  ownVersions: Map<string, string>
): Map<string, string> {
  return new Map([
    ...(parentVersions ?? []),
    ...ownVersions
  ]);
}

function stripUnsupportedMavenSections(text: string): string {
  return stripXmlSections(text, ["build", "reporting", "profiles"]);
}

function stripXmlSections(text: string, tags: string[]): string {
  return tags.reduce((current, tag) => stripXmlSection(current, tag), text);
}

function stripXmlSection(text: string, tag: string): string {
  return text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
}

function readPomProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  const propertiesSection = text.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/i)?.[1];
  if (!propertiesSection) {
    return properties;
  }

  for (const match of propertiesSection.matchAll(/<([A-Za-z0-9_.-]+)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      properties.set(key, normalizePomText(value));
    }
  }

  return properties;
}

function readXmlTagText(text: string, tag: string): string | undefined {
  const value = text.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1];
  const normalized = value === undefined ? undefined : normalizePomText(value);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function readMavenParentCoordinates(text: string): MavenPomCoordinates | undefined {
  const parentText = text.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/i)?.[1];
  if (!parentText) {
    return undefined;
  }

  const groupId = readXmlTagText(parentText, "groupId");
  const artifactId = readXmlTagText(parentText, "artifactId");
  const version = readXmlTagText(parentText, "version");
  if (!groupId || !artifactId || !version || version.includes("${")) {
    return undefined;
  }

  return { groupId, artifactId, version };
}

function resolveMavenExpression(value: string, properties: Map<string, string>): string | undefined {
  let current = value;

  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
      const replacement = properties.get(key);
      return replacement === undefined ? match : replacement;
    });

    if (next === current) {
      return next.includes("${") ? undefined : next;
    }

    current = next;
  }

  return current.includes("${") ? undefined : current;
}

function mavenProjectRootFromPomPath(pomPath: string): string {
  if (pomPath.includes(":")) {
    return process.cwd();
  }

  return path.dirname(path.resolve(pomPath));
}

function mavenCoordinateKey(groupId: string, artifactId: string): string {
  return `${groupId}:${artifactId}`;
}

function mavenDependencyId(coordinates: MavenPomCoordinates): string {
  return `${coordinates.groupId}:${coordinates.artifactId}@${coordinates.version}`;
}

function recordMissingExternalMavenPom(
  context: MavenPomParseContext,
  missing: MissingExternalMavenPom
): void {
  if (context.missingExternalPoms.some((entry) =>
    entry.usage === missing.usage && entry.dependency === missing.dependency
  )) {
    return;
  }

  context.missingExternalPoms.push(missing);
}

function mavenResolutionDetails(context: MavenPomParseContext): Record<string, unknown> {
  return {
    searchedRepositoryRoots: context.repositoryRoots,
    ...(context.missingExternalPoms.length > 0
      ? { missingExternalPoms: context.missingExternalPoms }
      : {})
  };
}

function dependencyTypeForMavenDependency(dependency: MavenPomDependency): DependencyType {
  const scope = dependency.scope?.toLowerCase();
  if (dependency.optional) {
    return "optional";
  }

  if (scope === "test") {
    return "development";
  }

  if (scope === "provided" || scope === "system") {
    return "unknown";
  }

  return "production";
}

function deduplicateMavenDependencies(dependencies: MavenPomDependency[]): MavenPomDependency[] {
  const seen = new Map<string, MavenPomDependency>();

  for (const dependency of dependencies) {
    const key = `${dependency.groupId}:${dependency.artifactId}@${dependency.version}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, dependency);
      continue;
    }

    seen.set(key, {
      ...existing,
      optional: existing.optional && dependency.optional,
      scope: mergeMavenScope(existing.scope, dependency.scope)
    });
  }

  return [...seen.values()];
}

function mergeMavenScope(left: string | undefined, right: string | undefined): string | undefined {
  const leftType = dependencyTypeForMavenDependency({
    groupId: "group",
    artifactId: "artifact",
    version: "0",
    optional: false,
    scope: left
  });
  const rightType = dependencyTypeForMavenDependency({
    groupId: "group",
    artifactId: "artifact",
    version: "0",
    optional: false,
    scope: right
  });

  return dependencyTypeRank(leftType) >= dependencyTypeRank(rightType) ? left : right;
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

function normalizePomText(text: string): string {
  return decodeXmlEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
