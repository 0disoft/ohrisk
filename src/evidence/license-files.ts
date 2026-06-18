import type { LicenseEvidenceFileKind } from "./types";

export function classifyEvidenceFile(path: string): LicenseEvidenceFileKind | undefined {
  const normalized = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "notice" || normalized.startsWith("notice.")) {
    return "notice";
  }

  if (normalized === "copying" || normalized.startsWith("copying.")) {
    return "copying";
  }

  if (
    normalized === "license"
    || normalized === "licence"
    || normalized.startsWith("license.")
    || normalized.startsWith("licence.")
  ) {
    return "license";
  }

  return undefined;
}
