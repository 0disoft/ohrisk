import type { DependencyNode, PackageEcosystem } from "./types";

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

export function packageUrl(node: DependencyNode): string {
  switch (node.ecosystem) {
    case "npm":
      return `pkg:npm/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "pypi":
      return `pkg:pypi/${encodeURIComponent(normalizePypiName(node.name))}@${encodeURIComponent(node.version)}`;
    case "maven":
      return mavenPackageUrl(node);
    case "cargo":
      return `pkg:cargo/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "go":
      return `pkg:golang/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "nuget":
      return `pkg:nuget/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "conan":
      return `pkg:conan/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "conda":
      return `pkg:conda/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "bazel":
      return `pkg:generic/bazel-module/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "vcpkg":
      return `pkg:generic/vcpkg/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "terraform":
      return `pkg:generic/terraform-provider/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "helm":
      return helmPackageUrl(node);
    case "nix":
      return `pkg:generic/nix/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "unity":
      return `pkg:generic/unity/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "cran":
      return `pkg:cran/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "julia":
      return `pkg:julia/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "hackage":
      return `pkg:generic/hackage/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "cpan":
      return cpanPackageUrl(node);
    case "luarocks":
      return `pkg:generic/luarocks/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "carthage":
      return `pkg:generic/carthage/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "cocoapods":
      return `pkg:cocoapods/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "hex":
      return `pkg:hex/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "gem":
      return `pkg:gem/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "composer":
      return `pkg:composer/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
    case "pub":
      return `pkg:pub/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "swift":
      return `pkg:swift/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
  }
}

function cpanPackageUrl(node: DependencyNode): string {
  const author = cpanAuthorFromPathname(node.resolved);
  return author
    ? `pkg:cpan/${encodeURIComponent(author)}/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`
    : `pkg:generic/cpan/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
}

function cpanAuthorFromPathname(pathname: string | undefined): string | undefined {
  const segments = pathname?.split("/") ?? [];
  return segments.length >= 4 ? segments[2] : undefined;
}

function helmPackageUrl(node: DependencyNode): string {
  const installName = node.installNames?.[0];
  if (installName && node.resolved) {
    return `pkg:generic/helm/${encodeURIComponent(node.resolved)}/${encodeURIComponent(installName)}@${encodeURIComponent(node.version)}`;
  }

  return `pkg:generic/helm/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
}

function mavenPackageUrl(node: DependencyNode): string {
  const coordinates = parseMavenCoordinates(node.name);
  if (!coordinates) {
    return `pkg:maven/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
  }

  return `pkg:maven/${encodePurlPath(coordinates.namespace)}/${encodeURIComponent(coordinates.name)}@${encodeURIComponent(node.version)}`;
}

function parseMavenCoordinates(name: string): { namespace: string; name: string } | undefined {
  const colonIndex = name.indexOf(":");
  if (colonIndex > 0 && colonIndex < name.length - 1) {
    return {
      namespace: name.slice(0, colonIndex),
      name: name.slice(colonIndex + 1)
    };
  }

  const slashIndex = name.lastIndexOf("/");
  if (slashIndex > 0 && slashIndex < name.length - 1) {
    return {
      namespace: name.slice(0, slashIndex),
      name: name.slice(slashIndex + 1)
    };
  }

  return undefined;
}

function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[._-]+/g, "-");
}

function encodePurlPath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}
