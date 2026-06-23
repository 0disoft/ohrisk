import type { DependencyNode } from "../graph/types";

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
