import type { SnapshotPayload } from "./inspection-snapshot";
import { inputSupportForLockfile } from "../ecosystems/registry";

const ECOSYSTEMS = new Set("npm pypi maven cargo go nuget conan conda vcpkg bazel terraform helm nix unity cran julia hackage cpan luarocks carthage cocoapods hex gem composer pub swift zig".split(" "));
const DEPENDENCY_TYPES = new Set(["production", "development", "optional", "peer", "unknown"]);
const SOURCES = new Set(["local", "registry", "sbom", "tarball", "unavailable"]);
const RETRIEVALS = new Set(["network", "cache", "revalidated-cache", "local", "verification-only"]);
const SHA256 = /^[0-9a-f]{64}$/u;
type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && value.length <= 2 * 1024 * 1024;
const strings = (value: unknown, max = 50_000): value is string[] => Array.isArray(value) && value.length <= max && value.every(string);
const optional = (value: unknown, check: (v: unknown) => boolean): boolean => value === undefined || check(value);
const boolean = (value: unknown): boolean => typeof value === "boolean";
const hash = (value: unknown): boolean => string(value) && SHA256.test(value);
const nonnegative = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const array = (value: unknown, max: number, check: (v: unknown) => boolean): boolean => Array.isArray(value) && value.length <= max && value.every(check);

/** Bound and validate every field consumed by replay before passing it to graph or policy code. */
export function validateSnapshotPayload(value: unknown): value is SnapshotPayload {
  if (!record(value) || !record(value.tool) || !string(value.tool.version) || !string(value.tool.rulesVersion)
    || !string(value.tool.spdxSourceCommit) || !string(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt))
    || !hash(value.policyDigest) || !(value.waiverDigest === null || hash(value.waiverDigest))
    || !boolean(value.prodOnly) || !boolean(value.artifactsTruncated)
    || !record(value.project) || !Array.isArray(value.project.lockfiles) || value.project.lockfiles.length < 1
    || !array(value.project.lockfiles, 256, (v) => record(v) && string(v.kind) && inputSupportForLockfile(v.kind) !== undefined && string(v.path))
    || !optional(value.replayedFrom, hash)
    || !array(value.inputs, 256, (v) => record(v) && string(v.path)
      && (v.status === "unavailable" || (v.status === "hashed" && hash(v.sha256))))
    || !validGraph(value.graph) || !array(value.evidence, 50_000, validEvidence)
    || !array(value.artifacts, 50_000, validArtifact) || !optional(value.repository, validRepository)) return false;
  const ids = new Set(value.graph.nodes.map((node) => node.id));
  const evidenceIds = new Set<string>();
  for (const item of value.evidence as ObjectValue[]) {
    if (!ids.has(item.packageId as string) || evidenceIds.has(item.packageId as string)) return false;
    evidenceIds.add(item.packageId as string);
  }
  // A missing package receipt is not allowed to disappear from completeness calculation.
  if (evidenceIds.size !== ids.size) return false;
  // Maven model POMs and filtered dependencies may also have acquisition receipts.
  return true;
}

function validGraph(value: unknown): value is SnapshotPayload["graph"] {
  if (!record(value) || !string(value.lockfilePath) || !array(value.nodes, 50_000, validNode)
    || !optional(value.rootName, string) || !optional(value.lockfilePaths, strings)
    || !optional(value.mavenRepositoryUrls, strings) || !optional(value.warnings, strings)
    || !optional(value.rootDependenciesUnknown, boolean) || !optional(value.unknownDependencyNodeIds, strings)
    || !optional(value.diagnostics, (v) => array(v, 50_000, (d) => record(d)
      && (d.code === "dependency_paths_truncated" || d.code === "dependency_path_depth_summarized")
      && nonnegative(d.affectedNodeCount) && nonnegative(d.limit) && string(d.message)))) return false;
  const ids = new Set((value.nodes as ObjectValue[]).map((node) => node.id));
  if (ids.size !== (value.nodes as unknown[]).length) return false;
  const reference = (v: unknown): boolean => string(v) && ids.has(v);
  return optional(value.edges, (v) => array(v, 500_000, (edge) => record(edge)
    && reference(edge.to) && optional(edge.from, reference) && DEPENDENCY_TYPES.has(edge.dependencyType as string)
    && optional(edge.origins, validOrigins)))
    && optional(value.unknownDependencyNodeIds, (v) => array(v, 50_000, reference))
    && optional(value.unresolvedDependencies, (v) => array(v, 50_000, (item) => record(item)
      && optional(item.from, reference) && string(item.name) && DEPENDENCY_TYPES.has(item.dependencyType as string)
      && (item.reason === "missing_installation" || item.reason === "unproven_installation")));
}
function validOrigins(value: unknown): boolean {
  return array(value, 256, (v) => record(v) && string(v.lockfileKind) && string(v.lockfilePath));
}
function validNode(value: unknown): boolean {
  return record(value) && string(value.id) && string(value.name) && string(value.version)
    && ECOSYSTEMS.has(value.ecosystem as string) && DEPENDENCY_TYPES.has(value.dependencyType as string)
    && boolean(value.direct) && array(value.paths, 64, (v) => strings(v, 512))
    && optional(value.origins, validOrigins) && optional(value.installNames, strings)
    && ["resolved", "integrity", "yarnCacheChecksum", "goModIntegrity", "purlSubpath"].every((key) => optional(value[key], string))
    && optional(value.artifactIdentityConflict, (v) => v === true)
    && optional(value.purlQualifiers, (v) => record(v) && Object.values(v).every(string))
    && optional(value.artifactVariants, (v) => array(v, 256, (item) => record(item)
      && ["resolved", "integrity", "yarnCacheChecksum", "goModIntegrity"].every((key) => optional(item[key], string))));
}
function validEvidence(value: unknown): boolean {
  return record(value) && string(value.packageId) && SOURCES.has(value.source as string) && strings(value.warnings)
    && array(value.files, 256, (file) => record(file) && string(file.path) && string(file.text)
      && ["license", "notice", "copying", "other"].includes(file.kind as string)
      && optional(file.scope, (v) => v === "component"))
    && ["packageJsonLicense", "metadataLicense", "metadataSource", "sbomDeclaredLicense", "sbomConcludedLicense"].every((key) => optional(value[key], string))
    && optional(value.packageJsonPrivate, boolean) && optional(value.artifactIdentityConflict, (v) => v === true)
    && optional(value.metadataLicenseKind, (v) => v === "declared" || v === "classifier")
    && optional(value.goModuleRequirements, strings) && optional(value.conflictingLicenseClaims, strings);
}
function validArtifact(value: unknown): boolean {
  return record(value) && string(value.packageId) && hash(value.sha256) && nonnegative(value.byteLength)
    && optional(value.requestedOrigin, (v) => string(v) && /^https?:\/\//u.test(v)
      && (() => { try { const url = new URL(v); return !url.username && !url.password && !url.search && !url.hash; } catch { return false; } })())
    && array(value.retrievals, 5, (v) => RETRIEVALS.has(v as string))
    && array(value.checks, 256, (v) => record(v) && string(v.kind) && string(v.value));
}
function validRepository(value: unknown): boolean {
  return record(value) && string(value.owner) && string(value.name)
    && ["submodules", "symbolicLinks", "nonPortablePaths"].every((key) => record(value[key])
      && nonnegative(value[key].skippedCount) && strings(value[key].skippedPaths, 256) && boolean(value[key].pathsTruncated))
    && record(value.submodules) && ["ignore", "reject"].includes(value.submodules.mode as string);
}
