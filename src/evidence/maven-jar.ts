import { readArchiveBytes } from "../archive/archive-reader";
import type { MavenCoordinates } from "../shared/maven-repository";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { classifyEvidenceFile } from "./license-files";
import type { LicenseEvidence, LicenseEvidenceFile } from "./types";

const MAVEN_JAR_MAX_BYTES = 100 * 1024 * 1024;
const MAVEN_JAR_MAX_ENTRIES = 50_000;
const MAVEN_JAR_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
const MAVEN_JAR_EXPANDED_MAX_BYTES = 256 * 1024 * 1024;
const MAVEN_JAR_MATERIALIZED_MAX_BYTES = 16 * 1024 * 1024;
const MAVEN_JAR_IDENTITY_MAX_BYTES = 64 * 1024;
const MAVEN_JAR_EVIDENCE_FILE_MAX_BYTES = 1024 * 1024;
const MAVEN_JAR_EVIDENCE_FILE_MAX_COUNT = 16;

export function collectMavenJarEvidence(input: {
  packageId: string;
  coordinates: MavenCoordinates;
  jar: Buffer | Uint8Array;
}): Result<LicenseEvidence, OhriskError> {
  const archive = readArchiveBytes({
    displayName: `${input.coordinates.artifactId}-${input.coordinates.version}.jar`,
    bytes: input.jar,
    formatHint: "zip",
    limits: {
      inputBytes: MAVEN_JAR_MAX_BYTES,
      entries: MAVEN_JAR_MAX_ENTRIES,
      entryBytes: MAVEN_JAR_ENTRY_MAX_BYTES,
      expandedBytes: MAVEN_JAR_EXPANDED_MAX_BYTES,
      materializedBytes: MAVEN_JAR_MATERIALIZED_MAX_BYTES
    }
  });
  if (!archive.ok) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        `Checksum-verified Maven JAR was rejected by the bounded archive reader (${archive.error.code}); its contents were not trusted.`
      ]
    });
  }

  const identityPath = mavenPomPropertiesPath(input.coordinates);
  if (!archive.value.listPaths().includes(identityPath)) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Checksum-verified Maven JAR did not contain exact embedded pom.properties identity; its contents were not trusted."
      ]
    });
  }
  const identityText = archive.value.readText(identityPath, MAVEN_JAR_IDENTITY_MAX_BYTES);
  if (!identityText.ok) {
    return err(identityText.error);
  }
  const identity = parsePomProperties(identityText.value);
  if (
    identity.groupId !== input.coordinates.groupId
    || identity.artifactId !== input.coordinates.artifactId
    || identity.version !== input.coordinates.version
  ) {
    return err(createError({
      code: "PACKAGE_EVIDENCE_READ_FAILED",
      category: "unsupported_input",
      message: "Maven JAR metadata did not match the requested package identity.",
      details: {
        packageId: input.packageId,
        reason: "maven_jar_identity_mismatch",
        expectedGroupId: input.coordinates.groupId,
        expectedArtifactId: input.coordinates.artifactId,
        expectedVersion: input.coordinates.version,
        ...(identity.groupId ? { observedGroupId: identity.groupId } : {}),
        ...(identity.artifactId ? { observedArtifactId: identity.artifactId } : {}),
        ...(identity.version ? { observedVersion: identity.version } : {})
      }
    }));
  }

  const evidencePaths = archive.value.listPaths()
    .filter(isPackageLicenseEvidencePath)
    .slice(0, MAVEN_JAR_EVIDENCE_FILE_MAX_COUNT);
  const files: LicenseEvidenceFile[] = [];
  for (const evidencePath of evidencePaths) {
    const kind = classifyEvidenceFile(evidencePath);
    if (!kind) {
      continue;
    }
    const text = archive.value.readText(evidencePath, MAVEN_JAR_EVIDENCE_FILE_MAX_BYTES);
    if (!text.ok) {
      return err(text.error);
    }
    files.push({ path: evidencePath, kind, text: text.value });
  }

  return ok({
    packageId: input.packageId,
    files,
    source: "tarball",
    warnings: files.length > 0
      ? ["Maven JAR license files were verified with repository SHA-256 and embedded package identity."]
      : ["Verified Maven JAR did not contain a root or META-INF license evidence file."]
  });
}

function mavenPomPropertiesPath(coordinates: MavenCoordinates): string {
  return [
    "META-INF",
    "maven",
    coordinates.groupId,
    coordinates.artifactId,
    "pom.properties"
  ].join("/");
}

function parsePomProperties(text: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    const separator = trimmed.search(/[=:]/u);
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key !== "" && value !== "") {
      properties[key] = value;
    }
  }
  return properties;
}

function isPackageLicenseEvidencePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/gu, "/");
  if (normalized.includes("/../") || normalized.startsWith("../")) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.length === 1) {
    return classifyEvidenceFile(normalized) !== undefined;
  }
  return segments.length === 2
    && segments[0]?.toUpperCase() === "META-INF"
    && classifyEvidenceFile(segments[1] ?? "") !== undefined;
}
