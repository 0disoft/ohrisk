import type { LicenseEvidenceFileKind } from "./types";

export function classifyEvidenceFile(path: string): LicenseEvidenceFileKind | undefined {
  const normalized = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (hasEvidenceName(normalized, "notice")) {
    return "notice";
  }

  if (hasEvidenceName(normalized, "copying")) {
    return "copying";
  }

  if (
    normalized === "unlicense"
    || hasEvidenceName(normalized, "license")
    || hasEvidenceName(normalized, "licence")
  ) {
    return "license";
  }

  return undefined;
}

function hasEvidenceName(normalized: string, baseName: string): boolean {
  return normalized === baseName
    || normalized.startsWith(`${baseName}.`)
    || normalized.startsWith(`${baseName}-`)
    || normalized.startsWith(`${baseName}_`);
}
