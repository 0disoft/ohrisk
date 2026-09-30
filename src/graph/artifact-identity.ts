import { parseSupportedIntegrityEntries } from "../evidence/package-integrity";
import type { DependencyArtifact, DependencyNode } from "./types";

const ARTIFACT_FIELDS = ["resolved", "integrity", "yarnCacheChecksum", "goModIntegrity"] as const;

/** Normalize only encodings of the same digest, never treat a URL as content proof. */
function canonicalIntegrity(value: string): string {
  return [...new Set(value.trim().split(/\s+/).map((token) => {
    const entry = parseSupportedIntegrityEntries(token)[0];
    return entry ? `${entry.algorithm}-${entry.digest.toString("base64")}` : token;
  }))].sort().join(" ");
}

function artifactDeclaration(node: DependencyArtifact): DependencyArtifact {
  const artifact: DependencyArtifact = {};
  for (const field of ARTIFACT_FIELDS) {
    const value = node[field];
    if (value) artifact[field] = field === "integrity" ? canonicalIntegrity(value) : value;
  }
  return artifact;
}

function compatible(left: DependencyArtifact, right: DependencyArtifact): boolean {
  for (const field of ARTIFACT_FIELDS) {
    if (field === "resolved") continue;
    if (left[field] && right[field] && left[field] !== right[field]) return false;
  }
  if (left.resolved && right.resolved && left.resolved !== right.resolved) {
    // Equal supported lockfile pins permit shared collection. The collector still
    // verifies the selected bytes against that pin before trusting evidence.
    return left.integrity !== undefined && left.integrity === right.integrity
      && parseSupportedIntegrityEntries(left.integrity).length > 0;
  }
  return true;
}

export function mergeArtifactIdentity(left: DependencyNode, right: DependencyNode):
  DependencyArtifact & Pick<DependencyNode, "artifactVariants" | "artifactIdentityConflict"> {
  const byKey = new Map<string, DependencyArtifact>();
  for (const node of [left, right]) {
    for (const source of node.artifactVariants ?? [node]) {
      const artifact = artifactDeclaration(source);
      if (Object.keys(artifact).length > 0) byKey.set(JSON.stringify(artifact), artifact);
    }
  }
  const variants = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, artifact]) => artifact);
  let conflicting = left.artifactIdentityConflict === true || right.artifactIdentityConflict === true;
  for (let index = 0; index < variants.length; index++) {
    for (const other of variants.slice(index + 1)) {
      conflicting ||= !compatible(variants[index]!, other);
    }
  }
  const retained = variants.length > 1 ? { artifactVariants: variants } : {};
  if (conflicting) return { ...retained, artifactIdentityConflict: true };
  const merged: DependencyArtifact = {};
  for (const field of ARTIFACT_FIELDS) {
    const values = variants.flatMap((artifact) => artifact[field] ? [artifact[field]!] : []).sort();
    if (values[0] !== undefined) merged[field] = values[0];
  }
  return { ...merged, ...retained };
}
