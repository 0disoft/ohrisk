import { createError, type OhriskError } from "../shared/errors";
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
  properties: Map<string, string>;
};

export function parseMavenPomFile(
  pomPath: string,
  options: { maxBytes?: number } = {}
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

  return parseMavenPomText(pomText.value, pomPath);
}

export function parseMavenPomText(
  input: string,
  pomPath = "pom.xml"
): Result<DependencyGraph, OhriskError> {
  try {
    const scannedProject = stripUnsupportedMavenSections(input);
    const project = readMavenPomProject(scannedProject);
    const rootName = project.rootName ?? "<maven-project>";
    const dependencies = readMavenPomDependencies(scannedProject, project.properties, pomPath);

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

function readMavenPomProject(text: string): MavenPomProject {
  const projectText = stripXmlSection(text, "parent");
  const properties = readPomProperties(projectText);
  const artifactId = readXmlTagText(projectText, "artifactId");
  const version = readXmlTagText(projectText, "version");
  if (version) {
    properties.set("project.version", version);
    properties.set("pom.version", version);
  }

  return {
    ...(artifactId ? { rootName: artifactId } : {}),
    properties
  };
}

function readMavenPomDependencies(
  text: string,
  properties: Map<string, string>,
  pomPath: string
): Result<MavenPomDependency[], OhriskError> {
  const dependencies: MavenPomDependency[] = [];
  const managedVersions = readMavenDependencyManagementVersions(text, properties);
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
        ? managedVersions.get(mavenCoordinateKey(groupId, artifactId))
        : undefined;
      const rawResolvedVersion = rawVersion ?? managedVersion;

      if (!rawResolvedVersion) {
        return err(
          createError({
            code: "MAVEN_POM_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pom.xml dependency entry. Ohrisk v0 requires dependency versions to be explicit, resolvable from pom.xml properties, or resolvable from same-file dependencyManagement.",
            details: {
              lockfilePath: pomPath,
              dependency: `${groupId}:${artifactId}`
            }
          })
        );
      }

      const version = resolveMavenProperty(rawResolvedVersion, properties);
      if (!version || version.includes("${")) {
        return err(
          createError({
            code: "MAVEN_POM_PARSE_FAILED",
            category: "unsupported_input",
            message: "Failed to parse pom.xml dependency version. Ohrisk v0 does not resolve external Maven parent, BOM, or unresolved dependencyManagement versions.",
            details: {
              lockfilePath: pomPath,
              dependency: `${groupId}:${artifactId}`,
              version: rawResolvedVersion
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
  properties: Map<string, string>
): Map<string, string> {
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
        continue;
      }

      const version = resolveMavenProperty(rawVersion, properties);
      if (version) {
        managedVersions.set(mavenCoordinateKey(groupId, artifactId), version);
      }
    }
  }

  return managedVersions;
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

function resolveMavenProperty(value: string, properties: Map<string, string>): string | undefined {
  const propertyMatch = /^\$\{([^}]+)\}$/.exec(value);
  if (!propertyMatch?.[1]) {
    return value;
  }

  return properties.get(propertyMatch[1]);
}

function mavenCoordinateKey(groupId: string, artifactId: string): string {
  return `${groupId}:${artifactId}`;
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
