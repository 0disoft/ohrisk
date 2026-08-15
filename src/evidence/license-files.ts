import type { LicenseEvidenceFileKind } from "./types";

export function classifyEvidenceFile(path: string): LicenseEvidenceFileKind | undefined {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const normalized = segments.at(-1)?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (segments.at(-2)?.toLowerCase() === "licenses" || normalized.endsWith(".license")) {
    return "license";
  }

  if (/^third[-_ ]party[-_ ]notices?(?:[._-]|$)/i.test(normalized)) {
    return "notice";
  }

  if (/^third[-_ ]party[-_ ]licenses?(?:[._-]|$)/i.test(normalized)) {
    return "license";
  }

  if (hasEvidenceName(normalized, "notice")) {
    return "notice";
  }

  if (hasEvidenceName(normalized, "copying")) {
    return "copying";
  }

  if (
    hasEvidenceName(normalized, "unlicense")
    || hasEvidenceName(normalized, "license")
    || hasEvidenceName(normalized, "licence")
  ) {
    return "license";
  }

  if (
    hasEvidenceName(normalized, "copyright")
    || hasEvidenceName(normalized, "authors")
    || hasEvidenceName(normalized, "patents")
    || hasEvidenceName(normalized, "legal")
  ) {
    return "other";
  }

  return undefined;
}

function hasEvidenceName(normalized: string, baseName: string): boolean {
  return normalized === baseName
    || normalized.startsWith(`${baseName}.`)
    || normalized.startsWith(`${baseName}-`)
    || normalized.startsWith(`${baseName}_`);
}
