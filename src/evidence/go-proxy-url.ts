import type { DependencyNode } from "../graph/types";

export const GO_MODULE_PROXY_BASE_URL = "https://proxy.golang.org";

export function remoteGoModuleCoordinates(node: DependencyNode): {
  modulePath: string;
  version: string;
} | undefined {
  if (!node.resolved) {
    return { modulePath: node.name, version: node.version };
  }
  if (!node.resolved.startsWith("go-module:")) {
    return undefined;
  }
  const specifier = node.resolved.slice("go-module:".length);
  const separator = specifier.lastIndexOf("@");
  if (separator <= 0 || separator === specifier.length - 1) {
    return undefined;
  }
  return {
    modulePath: specifier.slice(0, separator),
    version: specifier.slice(separator + 1)
  };
}

export function goModuleProxyZipUrl(modulePath: string, version: string): string | undefined {
  return goModuleProxyArtifactUrl(modulePath, version, "zip");
}

export function goModuleProxyModUrl(modulePath: string, version: string): string | undefined {
  return goModuleProxyArtifactUrl(modulePath, version, "mod");
}

function goModuleProxyArtifactUrl(
  modulePath: string,
  version: string,
  extension: "mod" | "zip"
): string | undefined {
  const escapedModulePath = escapeGoProxyModulePath(modulePath);
  const escapedVersion = escapeGoProxyVersion(version);
  return escapedModulePath && escapedVersion
    ? `${GO_MODULE_PROXY_BASE_URL}/${escapedModulePath}/@v/${escapedVersion}.${extension}`
    : undefined;
}

function escapeGoProxyModulePath(modulePath: string): string | undefined {
  if (
    modulePath === ""
    || modulePath.startsWith("/")
    || modulePath.endsWith("/")
    || !/^[A-Za-z0-9.!_~+\-/]+$/u.test(modulePath)
  ) {
    return undefined;
  }
  const segments = modulePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return escapeGoProxyText(modulePath);
}

function escapeGoProxyVersion(version: string): string | undefined {
  return /^v[A-Za-z0-9.!_~+\-]+$/u.test(version) ? escapeGoProxyText(version) : undefined;
}

function escapeGoProxyText(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "!") {
      escaped += "!!";
    } else if (character >= "A" && character <= "Z") {
      escaped += `!${character.toLowerCase()}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}
