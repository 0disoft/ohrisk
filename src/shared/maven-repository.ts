import { existsSync } from "node:fs";
import path from "node:path";

const MAVEN_GROUP_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAVEN_ARTIFACT_SEGMENT_PATTERN = /^[A-Za-z0-9_.+-]+$/;

export type MavenCoordinates = {
  groupId: string;
  artifactId: string;
  version: string;
};

export function mavenRepositoryRoots(projectRoot: string, extraRoots: string[] = []): string[] {
  const roots = [
    ...extraRoots,
    path.join(projectRoot, ".m2", "repository")
  ];

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    roots.push(path.join(home, ".m2", "repository"));
  }

  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function findMavenPomInRepository(input: {
  repositoryRoots: string[];
  groupId: string;
  artifactId: string;
  version: string;
}): string | undefined {
  const repositoryPath = mavenPomRepositoryPath(input);
  const relativePomPath = repositoryPath?.replaceAll("/", path.sep);
  if (!relativePomPath) {
    return undefined;
  }

  for (const repositoryRoot of input.repositoryRoots) {
    const root = path.resolve(repositoryRoot);
    const candidate = path.resolve(root, relativePomPath);
    if (!isPathInside(root, candidate)) {
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function mavenPomRepositoryPath(input: MavenCoordinates): string | undefined {
  const groupSegments = input.groupId.split(".");
  if (
    groupSegments.some((segment) => !isSafeMavenPathSegment(segment, MAVEN_GROUP_SEGMENT_PATTERN)) ||
    !isSafeMavenPathSegment(input.artifactId, MAVEN_ARTIFACT_SEGMENT_PATTERN) ||
    !isSafeMavenPathSegment(input.version, MAVEN_ARTIFACT_SEGMENT_PATTERN)
  ) {
    return undefined;
  }

  return [
    ...groupSegments,
    input.artifactId,
    input.version,
    `${input.artifactId}-${input.version}.pom`
  ].join("/");
}

function isSafeMavenPathSegment(segment: string, pattern: RegExp): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("..") &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0") &&
    !path.isAbsolute(segment) &&
    !/^[A-Za-z]:/.test(segment) &&
    pattern.test(segment)
  );
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
