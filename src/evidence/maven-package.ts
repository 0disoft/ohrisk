import { createError, type OhriskError } from "../shared/errors";
import { findMavenPomInRepository, mavenRepositoryRoots } from "../shared/maven-repository";
import {
  readTextFileWithLimit,
  textFileReadErrorCategory,
  textFileReadErrorDetails,
  type TextFileReadError
} from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import type { LicenseEvidence } from "./types";

const MAVEN_POM_MAX_BYTES = 2 * 1024 * 1024;

export function collectMavenPackageEvidence(input: {
  packageId: string;
  coordinates: string;
  version: string;
  projectRoot: string;
  pomMaxBytes?: number;
}): Result<LicenseEvidence, OhriskError> {
  const coordinates = parseMavenCoordinates(input.coordinates);
  if (!coordinates) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [`Maven coordinates were not parseable: ${input.coordinates}`]
    });
  }

  const pomPath = findMavenPom({
    projectRoot: input.projectRoot,
    groupId: coordinates.groupId,
    artifactId: coordinates.artifactId,
    version: input.version
  });

  if (!pomPath) {
    return ok({
      packageId: input.packageId,
      files: [],
      source: "unavailable",
      warnings: [
        "Maven POM metadata was not found in a local .m2/repository cache."
      ]
    });
  }

  const pomText = readTextFileWithLimit({
    filePath: pomPath,
    maxBytes: input.pomMaxBytes ?? MAVEN_POM_MAX_BYTES
  });

  if (!pomText.ok) {
    return err(
      createError({
        code: "PACKAGE_EVIDENCE_READ_FAILED",
        category: textFileReadErrorCategory(pomText.error),
        message: pomReadFailedMessage(pomText.error),
        details: {
          packageId: input.packageId,
          pomPath,
          ...textFileReadErrorDetails(pomText.error)
        }
      })
    );
  }

  const licenses = readPomLicenseNames(pomText.value);
  const warnings = licenses.length === 0
    ? ["Maven POM did not declare license names."]
    : [];

  return ok({
    packageId: input.packageId,
    ...(licenses.length > 0
      ? {
          metadataLicense: [...new Set(licenses)].join(" OR "),
          metadataSource: "pom.xml"
        }
      : {}),
    files: [],
    source: "local",
    warnings
  });
}

function parseMavenCoordinates(coordinates: string): {
  groupId: string;
  artifactId: string;
} | undefined {
  const [groupId, artifactId, extra] = coordinates.split(":");
  if (!groupId || !artifactId || extra !== undefined) {
    return undefined;
  }

  return { groupId, artifactId };
}

function findMavenPom(input: {
  projectRoot: string;
  groupId: string;
  artifactId: string;
  version: string;
}): string | undefined {
  return findMavenPomInRepository({
    repositoryRoots: mavenRepositoryRoots(input.projectRoot),
    groupId: input.groupId,
    artifactId: input.artifactId,
    version: input.version
  });
}

function readPomLicenseNames(text: string): string[] {
  const licensesSection = text.match(/<licenses\b[^>]*>([\s\S]*?)<\/licenses>/i)?.[1];
  if (!licensesSection) {
    return [];
  }

  const names: string[] = [];
  const licenseBlocks = licensesSection.matchAll(/<license\b[^>]*>([\s\S]*?)<\/license>/gi);
  for (const block of licenseBlocks) {
    const name = block[1]?.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1];
    if (!name) {
      continue;
    }

    const normalized = normalizePomText(name);
    if (normalized) {
      names.push(normalized);
    }
  }

  return names;
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

function pomReadFailedMessage(error: TextFileReadError): string {
  return error.kind === "too_large"
    ? "Maven POM metadata exceeded the maximum supported size."
    : "Failed to read Maven POM metadata.";
}
