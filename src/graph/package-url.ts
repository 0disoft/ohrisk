import type { PackageEcosystem } from "./types";

export type ParsedPackageUrl = {
  ecosystem: PackageEcosystem;
  name: string;
  version: string;
  id: string;
};

export function parsePackageUrl(input: string): ParsedPackageUrl | undefined {
  if (!input.startsWith("pkg:")) {
    return undefined;
  }

  const withoutPrefix = input.slice("pkg:".length);
  const typeSeparatorIndex = withoutPrefix.indexOf("/");
  if (typeSeparatorIndex <= 0) {
    return undefined;
  }

  const purlType = withoutPrefix.slice(0, typeSeparatorIndex).toLowerCase();
  const ecosystem = packageEcosystemForPurlType(purlType);
  if (!ecosystem) {
    return undefined;
  }

  const pathAndVersion = stripPurlQualifiersAndSubpath(
    withoutPrefix.slice(typeSeparatorIndex + 1)
  );
  const versionSeparatorIndex = pathAndVersion.lastIndexOf("@");
  if (versionSeparatorIndex <= 0 || versionSeparatorIndex === pathAndVersion.length - 1) {
    return undefined;
  }

  const encodedPath = pathAndVersion.slice(0, versionSeparatorIndex);
  const encodedVersion = pathAndVersion.slice(versionSeparatorIndex + 1);
  const pathSegments = encodedPath
    .split("/")
    .filter((segment) => segment !== "")
    .map(decodePurlComponent);
  const version = decodePurlComponent(encodedVersion);
  if (pathSegments.length === 0 || version === "") {
    return undefined;
  }

  const name = packageNameForPurlPath({
    ecosystem,
    pathSegments
  });
  if (!name) {
    return undefined;
  }

  return {
    ecosystem,
    name,
    version,
    id: `${name}@${version}`
  };
}

function packageEcosystemForPurlType(type: string): PackageEcosystem | undefined {
  switch (type) {
    case "npm":
      return "npm";
    case "pypi":
      return "pypi";
    case "maven":
      return "maven";
    case "cargo":
      return "cargo";
    case "golang":
      return "go";
    case "nuget":
      return "nuget";
    case "gem":
      return "gem";
    case "composer":
      return "composer";
    default:
      return undefined;
  }
}

function stripPurlQualifiersAndSubpath(value: string): string {
  const qualifierIndex = value.indexOf("?");
  const subpathIndex = value.indexOf("#");
  const cutCandidates = [qualifierIndex, subpathIndex].filter((index) => index >= 0);
  const cutIndex = cutCandidates.length > 0 ? Math.min(...cutCandidates) : -1;
  return cutIndex >= 0 ? value.slice(0, cutIndex) : value;
}

function packageNameForPurlPath(input: {
  ecosystem: PackageEcosystem;
  pathSegments: string[];
}): string | undefined {
  switch (input.ecosystem) {
    case "npm":
      return npmPackageName(input.pathSegments);
    case "maven":
      return mavenPackageName(input.pathSegments);
    case "composer":
      return input.pathSegments.length >= 2 ? input.pathSegments.join("/") : undefined;
    case "go":
      return input.pathSegments.join("/");
    case "pypi":
    case "cargo":
    case "nuget":
    case "gem":
      return input.pathSegments.join("/");
  }
}

function npmPackageName(segments: string[]): string | undefined {
  if (segments.length === 0) {
    return undefined;
  }

  if (segments[0]?.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }

  return segments[0];
}

function mavenPackageName(segments: string[]): string | undefined {
  if (segments.length < 2) {
    return undefined;
  }

  const artifact = segments[segments.length - 1];
  const namespace = segments.slice(0, -1).join("/");
  return namespace && artifact ? `${namespace}:${artifact}` : undefined;
}

function decodePurlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
