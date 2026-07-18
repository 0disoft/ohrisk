import {
  childNodes,
  childText,
  firstChild,
  parseXmlDocument,
  type XmlNode
} from "../graph/xml";
import { createError, type OhriskError } from "../shared/errors";
import {
  findMavenPomInRepository,
  mavenPomRepositoryPath,
  mavenRepositoryRoots,
  type MavenCoordinates
} from "../shared/maven-repository";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import type { LicenseEvidence } from "./types";

export const MAVEN_POM_METADATA_MAX_BYTES = 2 * 1024 * 1024;
export const MAVEN_LICENSE_PARENT_MAX_DEPTH = 8;

const MAVEN_LICENSE_NAME_MAX_CHARS = 200;
const MAVEN_LICENSE_COUNT_MAX = 16;
const MAVEN_PROPERTY_RESOLUTION_MAX_DEPTH = 8;
const MAVEN_PROPERTY_REFERENCE_PATTERN = /\$\{([^{}]+)\}/gu;

export type MavenPomLicenseMetadata = {
  licenses: string[];
  parent?: MavenCoordinates;
};

export function collectMavenPackageEvidence(input: {
  packageId: string;
  coordinates: string;
  version: string;
  projectRoot: string;
  pomMaxBytes?: number;
  maxParentDepth?: number;
}): Result<LicenseEvidence, OhriskError> {
  const requested = parseMavenPackageCoordinates(input.coordinates, input.version);
  if (!requested) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [`Maven coordinates were not parseable: ${input.coordinates}`]
    });
  }

  const repositoryRoots = mavenRepositoryRoots(input.projectRoot);
  const maxParentDepth = input.maxParentDepth ?? MAVEN_LICENSE_PARENT_MAX_DEPTH;
  const visited = new Set<string>();
  let current = requested;

  for (let depth = 0; depth <= maxParentDepth; depth += 1) {
    const coordinateKey = mavenCoordinateKey(current);
    if (visited.has(coordinateKey)) {
      return err(mavenPomMetadataError({
        packageId: input.packageId,
        source: coordinateKey,
        message: "Maven POM license inheritance contains a parent cycle.",
        details: { reason: "parent_cycle", coordinates: coordinateKey }
      }));
    }
    visited.add(coordinateKey);

    const pomPath = findMavenPomInRepository({ repositoryRoots, ...current });
    if (!pomPath) {
      const warning = depth === 0
        ? `Maven POM metadata for ${input.coordinates}@${input.version} was not found in local .m2/repository caches; run Maven/Gradle dependency resolution first or provide a project .m2/repository cache.`
        : `Maven parent POM metadata for ${coordinateKey} was not found in local .m2/repository caches.`;
      return ok({
        packageId: input.packageId,
        files: [],
        source: "unavailable",
        warnings: [warning]
      });
    }

    const pomText = readTextFileWithLimit({
      filePath: pomPath,
      maxBytes: input.pomMaxBytes ?? MAVEN_POM_METADATA_MAX_BYTES
    });
    if (!pomText.ok) {
      return err(createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(pomText.error),
        message: pomReadFailedMessage(pomText.error),
        details: {
          packageId: input.packageId,
          pomPath,
          ...textFileReadErrorDetails(pomText.error)
        }
      }));
    }

    const metadata = parseMavenPomLicenseMetadata({
      packageId: input.packageId,
      requested: current,
      source: coordinateKey,
      text: pomText.value
    });
    if (!metadata.ok) {
      return metadata;
    }

    if (metadata.value.licenses.length > 0) {
      return ok({
        packageId: input.packageId,
        metadataLicense: metadata.value.licenses.join(" OR "),
        metadataSource: depth === 0
          ? "pom.xml"
          : `parent pom.xml (${coordinateKey})`,
        files: [],
        source: "local",
        warnings: []
      });
    }

    if (!metadata.value.parent) {
      return ok({
        packageId: input.packageId,
        files: [],
        source: "local",
        warnings: ["Maven POM and its resolvable parent chain did not declare license names."]
      });
    }

    current = metadata.value.parent;
  }

  return err(mavenPomMetadataError({
    packageId: input.packageId,
    source: mavenCoordinateKey(current),
    message: "Maven POM license inheritance exceeded the maximum supported parent depth.",
    details: { reason: "parent_depth", maxParentDepth }
  }));
}

export function parseMavenPackageCoordinates(
  coordinates: string,
  version: string
): MavenCoordinates | undefined {
  const [groupId, artifactId, extra] = coordinates.split(":");
  if (!groupId || !artifactId || extra !== undefined) {
    return undefined;
  }

  const parsed = { groupId, artifactId, version };
  return mavenPomRepositoryPath(parsed) ? parsed : undefined;
}

export function parseMavenPomLicenseMetadata(input: {
  packageId: string;
  requested: MavenCoordinates;
  source: string;
  text: string;
}): Result<MavenPomLicenseMetadata, OhriskError> {
  const parsed = parseXmlDocument(
    input.text,
    input.source,
    (_source, cause) => err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven POM metadata was not valid bounded XML.",
      details: { reason: "malformed_xml", cause }
    }))
  );
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.name !== "project") {
    return err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven POM metadata did not use a project root element.",
      details: { reason: "invalid_root", rootElement: parsed.value.name }
    }));
  }

  const properties = readMavenPomProperties(parsed.value, input.requested);
  const parent = readParentCoordinates({
    packageId: input.packageId,
    source: input.source,
    parent: firstChild(parsed.value, "parent"),
    properties
  });
  if (!parent.ok) {
    return parent;
  }

  const artifactId = resolveMavenPomValue(childText(parsed.value, "artifactId"), properties);
  const groupId = resolveMavenPomValue(childText(parsed.value, "groupId"), properties)
    ?? parent.value?.groupId;
  const version = resolveMavenPomValue(childText(parsed.value, "version"), properties)
    ?? parent.value?.version;
  if (
    artifactId !== input.requested.artifactId
    || (groupId !== undefined && groupId !== input.requested.groupId)
    || (version !== undefined && version !== input.requested.version)
  ) {
    return err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven POM metadata did not match the requested package identity.",
      details: {
        reason: "identity_mismatch",
        requested: mavenCoordinateKey(input.requested),
        ...(groupId ? { metadataGroupId: groupId } : {}),
        ...(artifactId ? { metadataArtifactId: artifactId } : {}),
        ...(version ? { metadataVersion: version } : {})
      }
    }));
  }

  const licenses = readPomLicenseNames({
    packageId: input.packageId,
    source: input.source,
    project: parsed.value,
    properties
  });
  if (!licenses.ok) {
    return licenses;
  }

  return ok({
    licenses: licenses.value,
    ...(parent.value ? { parent: parent.value } : {})
  });
}

export function mavenCoordinateKey(coordinates: MavenCoordinates): string {
  return `${coordinates.groupId}:${coordinates.artifactId}@${coordinates.version}`;
}

function readParentCoordinates(input: {
  packageId: string;
  source: string;
  parent: XmlNode | undefined;
  properties: ReadonlyMap<string, string>;
}): Result<MavenCoordinates | undefined, OhriskError> {
  if (!input.parent) {
    return ok(undefined);
  }

  const groupId = resolveMavenPomValue(childText(input.parent, "groupId"), input.properties);
  const artifactId = resolveMavenPomValue(childText(input.parent, "artifactId"), input.properties);
  const version = resolveMavenPomValue(childText(input.parent, "version"), input.properties);
  if (!groupId || !artifactId || !version) {
    return err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven parent POM coordinates were incomplete or unresolved.",
      details: { reason: "parent_coordinates_unresolved" }
    }));
  }

  const coordinates = { groupId, artifactId, version };
  if (!mavenPomRepositoryPath(coordinates)) {
    return err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven parent POM coordinates were not safe exact repository coordinates.",
      details: { reason: "parent_coordinates_invalid" }
    }));
  }

  return ok(coordinates);
}

function readMavenPomProperties(
  project: XmlNode,
  requested: MavenCoordinates
): ReadonlyMap<string, string> {
  const properties = new Map<string, string>([
    ["project.groupId", requested.groupId],
    ["pom.groupId", requested.groupId],
    ["project.artifactId", requested.artifactId],
    ["pom.artifactId", requested.artifactId],
    ["project.version", requested.version],
    ["pom.version", requested.version]
  ]);
  for (const property of firstChild(project, "properties")?.children ?? []) {
    const value = property.text.trim();
    if (value !== "") {
      properties.set(property.name, value);
    }
  }
  return properties;
}

function resolveMavenPomValue(
  value: string | undefined,
  properties: ReadonlyMap<string, string>
): string | undefined {
  if (!value) {
    return undefined;
  }

  let resolved = value.trim();
  for (let depth = 0; depth < MAVEN_PROPERTY_RESOLUTION_MAX_DEPTH; depth += 1) {
    let changed = false;
    resolved = resolved.replace(MAVEN_PROPERTY_REFERENCE_PATTERN, (reference, key: string) => {
      const replacement = properties.get(key.trim());
      if (replacement === undefined) {
        return reference;
      }
      changed = true;
      return replacement;
    });
    if (!changed) {
      break;
    }
  }

  return resolved === "" || resolved.includes("${") ? undefined : resolved;
}

function readPomLicenseNames(input: {
  packageId: string;
  source: string;
  project: XmlNode;
  properties: ReadonlyMap<string, string>;
}): Result<string[], OhriskError> {
  const licenseNodes = childNodes(firstChild(input.project, "licenses"), "license");
  if (licenseNodes.length > MAVEN_LICENSE_COUNT_MAX) {
    return err(mavenPomMetadataError({
      packageId: input.packageId,
      source: input.source,
      message: "Maven POM declared too many license records.",
      details: {
        reason: "license_count",
        maxLicenses: MAVEN_LICENSE_COUNT_MAX,
        observedLicenses: licenseNodes.length
      }
    }));
  }

  const names: string[] = [];
  for (const license of licenseNodes) {
    const name = resolveMavenPomValue(childText(license, "name"), input.properties);
    if (!name) {
      continue;
    }
    const normalized = name.replace(/\s+/gu, " ").trim();
    if (normalized.length > MAVEN_LICENSE_NAME_MAX_CHARS) {
      return err(mavenPomMetadataError({
        packageId: input.packageId,
        source: input.source,
        message: "Maven POM license name exceeded the maximum supported length.",
        details: {
          reason: "license_name_length",
          maxChars: MAVEN_LICENSE_NAME_MAX_CHARS,
          observedChars: normalized.length
        }
      }));
    }
    if (normalized !== "") {
      names.push(normalized);
    }
  }

  return ok([...new Set(names)]);
}

function mavenPomMetadataError(input: {
  packageId: string;
  source: string;
  message: string;
  details?: Record<string, unknown>;
}): OhriskError {
  return createError({
    code: "PACKAGE_EVIDENCE_READ_FAILED",
    category: "unsupported_input",
    message: input.message,
    details: {
      packageId: input.packageId,
      pomSource: input.source,
      ...(input.details ?? {})
    }
  });
}

function pomReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Maven POM metadata exceeded the maximum supported size."
    : "Failed to read Maven POM metadata.";
}
