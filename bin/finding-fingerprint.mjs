/** Retain decision facts carried in provenance strings, while excluding file locations. */
export function semanticEvidenceSources(sources) {
  return [...new Set(sources.filter((source) =>
    /^(?:restriction scope:|bundled component license match:|conflicting |deprecated SPDX |warning:|package.json private:)/.test(source))
    .map((source) => source.startsWith("restriction scope:") ? source.replace(/ in .+$/s, "")
      : source.startsWith("bundled component license match:") ? source.replace(/ from .+$/s, "") : source))].sort();
}

/** Compare only recognized semantic fingerprints; opaque legacy formats stay exact. */
export function comparableFindingFingerprint(fingerprint) {
  const separator = fingerprint.lastIndexOf("::");
  if (separator < 0) return fingerprint;
  try {
    const value = JSON.parse(fingerprint.slice(separator + 2)
      .replace(/%7C/g, "|").replace(/%3E/g, ">").replace(/%3A/g, ":").replace(/%25/g, "%"));
    const keys = ["expression", "choices", "joiner", "signals", "confidence", "exceptions"];
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !keys.includes(key) && key !== "evidenceSources")
      || keys.some((key) => !Object.hasOwn(value, key))
      || (value.expression !== null && typeof value.expression !== "string")
      || typeof value.joiner !== "string" || typeof value.confidence !== "string"
      || ["choices", "signals", "exceptions", ...(Object.hasOwn(value, "evidenceSources") ? ["evidenceSources"] : [])]
        .some((key) => !Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string"))) return fingerprint;
    const canonical = Object.fromEntries(keys.map((key) => [key,
      Array.isArray(value[key]) ? [...new Set(value[key])].sort() : value[key]]));
    canonical.evidenceSources = semanticEvidenceSources(value.evidenceSources ?? []);
    return fingerprint.slice(0, separator + 2) + JSON.stringify(canonical)
      .replace(/%/g, "%25").replace(/:/g, "%3A").replace(/>/g, "%3E").replace(/\|/g, "%7C");
  } catch {
    return fingerprint;
  }
}
