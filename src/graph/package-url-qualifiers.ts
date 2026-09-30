export type PackageUrlDetails = { qualifiers?: Record<string, string>; subpath?: string };

/** Keep identifying public attributes; authentication material is not package identity. */
export function readPackageUrlDetails(input: string): PackageUrlDetails {
  const hash = input.indexOf("#");
  const query = input.indexOf("?");
  const qualifiers: Record<string, string> = Object.create(null) as Record<string, string>;
  if (query >= 0 && (hash < 0 || query < hash)) {
    for (const entry of input.slice(query + 1, hash < 0 ? undefined : hash).split("&")) {
      const separator = entry.indexOf("=");
      if (separator <= 0) continue;
      const key = decode(entry.slice(0, separator)).toLowerCase();
      if (!/^[a-z][a-z0-9._-]*$/u.test(key) || /(?:auth|token|secret|password|credential|api[_.-]?key)/iu.test(key)) continue;
      const decoded = decode(entry.slice(separator + 1));
      const raw = key === "checksum" ? [...new Set(decoded.split(",").map((value) => value.toLowerCase()))].sort().join(",") : decoded;
      const value = key.endsWith("_url") || /^(?:[a-z][a-z0-9+.-]*):\/\//iu.test(raw) ? publicSourceUrl(raw) : raw;
      if (value) qualifiers[key] = value;
    }
  }
  const subpath = hash >= 0 ? input.slice(hash + 1).split("/").map(decode)
    .filter((part) => part !== "" && part !== ".").join("/") : "";
  return {
    ...(Object.keys(qualifiers).length ? { qualifiers } : {}),
    ...(subpath && !subpath.split("/").includes("..") ? { subpath } : {})
  };
}

export function packageUrlDetailsSuffix(details: PackageUrlDetails): string {
  const qualifiers = Object.entries(details.qualifiers ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const subpath = details.subpath?.split("/").map(encodeURIComponent).join("/");
  return `${qualifiers ? `?${qualifiers}` : ""}${subpath ? `#${subpath}` : ""}`;
}

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function publicSourceUrl(value: string): string | undefined {
  const vcsPrefix = value.match(/^(?:git|hg|svn|bzr)\+/u)?.[0] ?? "";
  try {
    const url = new URL(value.slice(vcsPrefix.length));
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return vcsPrefix + url.href;
  } catch { return undefined; }
}
