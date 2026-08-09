import type { RiskFinding } from "./types";

export function buildFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return joinFindingIdentity(
    input.packageId,
    input.dependencyType,
    input.dependencyScope,
    canonicalPathSet(input.paths)
  );
}

// Legacy raw-order identity used only to keep pre-canonicalization waivers
// matching. Reports, diffs, and new waivers always use buildFindingId.
export function buildLegacyFindingId(input: {
  packageId: string;
  dependencyType: RiskFinding["dependencyType"];
  dependencyScope: RiskFinding["dependencyScope"];
  paths: string[][];
}): string {
  return joinFindingIdentity(
    input.packageId,
    input.dependencyType,
    input.dependencyScope,
    input.paths
  );
}

function joinFindingIdentity(
  packageId: string,
  dependencyType: RiskFinding["dependencyType"],
  dependencyScope: RiskFinding["dependencyScope"],
  paths: string[][]
): string {
  return [
    encodeFindingComponent(packageId),
    encodeFindingComponent(dependencyType),
    encodeFindingComponent(dependencyScope),
    paths.map((items) => items.map(encodeFindingComponent).join(">")).join("|")
  ].join("::");
}

function canonicalPathSet(paths: string[][]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const dependencyPath of paths) {
    byKey.set(JSON.stringify(dependencyPath), dependencyPath);
  }

  return [...byKey.values()].sort(comparePaths);
}

function comparePaths(left: string[], right: string[]): number {
  const leftKey = left.join("\u0000");
  const rightKey = right.join("\u0000");
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
}

export function buildFindingFingerprint(input: {
  id: string;
  severity: RiskFinding["severity"];
  recommendation: RiskFinding["recommendation"];
  reason: string;
  evidence: string[];
}): string {
  return [
    input.id,
    encodeFindingComponent(input.severity),
    encodeFindingComponent(input.recommendation),
    encodeFindingComponent(input.reason),
    input.evidence.map(encodeFindingComponent).join("|")
  ].join("::");
}

function encodeFindingComponent(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/:/g, "%3A")
    .replace(/>/g, "%3E")
    .replace(/\|/g, "%7C");
}
