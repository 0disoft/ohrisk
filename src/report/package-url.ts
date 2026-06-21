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
    case "gem":
      return `pkg:gem/${encodeURIComponent(node.name)}@${encodeURIComponent(node.version)}`;
    case "composer":
      return `pkg:composer/${encodePurlPath(node.name)}@${encodeURIComponent(node.version)}`;
  }
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
