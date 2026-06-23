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

  const ecosystem = packageEcosystemForPurlType({
    type: purlType,
    pathSegments
  });
  if (!ecosystem) {
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
    id: ecosystem === "conda" ? `conda:${name}@${version}` : `${name}@${version}`
  };
}

function packageEcosystemForPurlType(input: {
  type: string;
  pathSegments: string[];
}): PackageEcosystem | undefined {
  switch (input.type) {
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
    case "conan":
      return "conan";
    case "conda":
      return "conda";
    case "cran":
      return "cran";
    case "julia":
      return "julia";
    case "cpan":
      return "cpan";
    case "generic":
      return genericPackageEcosystem(input.pathSegments);
    case "cocoapods":
      return "cocoapods";
    case "hex":
      return "hex";
    case "gem":
      return "gem";
    case "composer":
      return "composer";
    case "pub":
      return "pub";
    case "swift":
      return "swift";
    default:
      return undefined;
  }
}

function genericPackageEcosystem(pathSegments: string[]): PackageEcosystem | undefined {
  switch (pathSegments[0]) {
    case "bazel-module":
      return "bazel";
    case "vcpkg":
      return "vcpkg";
    case "hackage":
      return "hackage";
    case "cpan":
      return "cpan";
    case "luarocks":
      return "luarocks";
    case "carthage":
      return "carthage";
    case "terraform-provider":
      return "terraform";
    case "helm":
      return "helm";
    case "nix":
      return "nix";
    case "unity":
      return "unity";
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
    case "bazel":
      return input.pathSegments[0] === "bazel-module" && input.pathSegments.length === 2
        ? input.pathSegments[1]
        : undefined;
    case "go":
      return input.pathSegments.join("/");
    case "vcpkg":
      return input.pathSegments[0] === "vcpkg" && input.pathSegments.length === 2
        ? input.pathSegments[1]
        : undefined;
    case "carthage":
      return input.pathSegments[0] === "carthage" && input.pathSegments.length >= 2
        ? input.pathSegments.slice(1).join("/")
        : undefined;
    case "terraform":
      return input.pathSegments[0] === "terraform-provider" && input.pathSegments.length >= 4
        ? input.pathSegments.slice(1).join("/")
        : undefined;
    case "helm":
      if (input.pathSegments[0] !== "helm" || input.pathSegments.length < 2) {
        return undefined;
      }

      return input.pathSegments.length >= 3
        ? `${input.pathSegments[1]}/${input.pathSegments.slice(2).join("/")}`
        : input.pathSegments.slice(1).join("/");
    case "nix":
      return input.pathSegments[0] === "nix" && input.pathSegments.length >= 2
        ? input.pathSegments.slice(1).join("/")
        : undefined;
    case "unity":
      return input.pathSegments[0] === "unity" && input.pathSegments.length === 2
        ? input.pathSegments[1]
        : undefined;
    case "hackage":
      return input.pathSegments[0] === "hackage" && input.pathSegments.length === 2
        ? input.pathSegments[1]
        : undefined;
    case "cpan":
      if (input.pathSegments[0] === "cpan" && input.pathSegments.length === 2) {
        return input.pathSegments[1];
      }

      return input.pathSegments.length === 2 ? input.pathSegments[1] : undefined;
    case "luarocks":
      return input.pathSegments[0] === "luarocks" && input.pathSegments.length === 2
        ? input.pathSegments[1]
        : undefined;
    case "pypi":
    case "cargo":
    case "nuget":
    case "conan":
    case "conda":
    case "cran":
    case "julia":
    case "cocoapods":
    case "hex":
    case "gem":
    case "pub":
    case "swift":
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
