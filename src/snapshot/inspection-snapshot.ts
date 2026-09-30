import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { OHRISK_VERSION } from "../cli/version";
import type { ScanResult } from "../cli/scan-policy";
import type { ArtifactReceipt } from "../evidence/artifact-capture";
import { safeArtifactOrigin } from "../evidence/artifact-capture";
import type { LicenseEvidence } from "../evidence/types";
import type { DependencyGraph } from "../graph/types";
import { SPDX_LICENSE_LIST_SOURCE_COMMIT } from "../license/spdx-catalog";
import { DEFAULT_WAIVER_FILE_NAME } from "../policy/waivers";
import { projectLockfiles, type ProjectInput } from "../project/discover";
import type { RemoteRepositoryReportSource } from "../report/scan-report";
import { createError, type OhriskError } from "../shared/errors";
import { readTextFileWithLimit } from "../shared/read-text-file";
import { err, ok, type Result } from "../shared/result";
import { validateSnapshotPayload } from "./snapshot-validation";

export const SNAPSHOT_SCHEMA_VERSION = "1.0.0";
export const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
export type InputReceipt = { path: string; sha256?: string; status: "hashed" | "unavailable" };
export type SnapshotPayload = {
  tool: { version: string; rulesVersion: string; spdxSourceCommit: string };
  capturedAt: string;
  inputs: InputReceipt[];
  policyDigest: string;
  waiverDigest: string | null;
  prodOnly: boolean;
  project: { lockfiles: import("../project/input").ProjectLockfile[] };
  replayedFrom?: string;
  graph: DependencyGraph;
  evidence: LicenseEvidence[];
  artifacts: ArtifactReceipt[];
  artifactsTruncated: boolean;
  repository?: RemoteRepositoryReportSource;
};
export type InspectionSnapshot = {
  $schema: "urn:ohrisk:schema:inspection-snapshot:1.0.0";
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  payloadSha256: string;
  payload: SnapshotPayload;
};

export function inputReceipts(project: ProjectInput): InputReceipt[] {
  if (project.source) return [{ path: path.basename(project.source.displayPath), sha256: project.source.sha256, status: "hashed" }];
  return projectLockfiles(project).map((file) => {
    const displayPath = relativePath(project.rootDir, file.path);
    try {
      if (!statSync(file.path).isFile() || statSync(file.path).size > SNAPSHOT_MAX_BYTES) return { path: displayPath, status: "unavailable" };
      const bytes = readFileSync(file.path);
      if (bytes.length > SNAPSHOT_MAX_BYTES) return { path: displayPath, status: "unavailable" };
      return { path: displayPath, sha256: digest(bytes), status: "hashed" };
    } catch { return { path: displayPath, status: "unavailable" }; }
  });
}

export function waiverDigest(root: string, enabled: boolean): string | null {
  const file = path.join(root, DEFAULT_WAIVER_FILE_NAME);
  if (!enabled || !existsSync(file)) return null;
  const bytes = readTextFileWithLimit({ filePath: file, maxBytes: 1024 * 1024 });
  if (!bytes.ok) return null; // The authoritative waiver reader reports read/size errors during evaluation.
  return digest(bytes.value);
}

export function createInspectionSnapshot(input: {
  scan: ScanResult; inputs: InputReceipt[]; waiverDigest: string | null; prodOnly: boolean;
  artifacts: ArtifactReceipt[]; artifactsTruncated: boolean; repository?: RemoteRepositoryReportSource;
  replayedFrom?: string;
}): InspectionSnapshot {
  const root = input.scan.project.rootDir;
  const graph = structuredClone(input.scan.graph);
  graph.lockfilePath = relativePath(root, graph.lockfilePath);
  if (graph.lockfilePaths) graph.lockfilePaths = graph.lockfilePaths.map((file) => relativePath(root, file));
  for (const node of graph.nodes) {
    for (const origin of node.origins ?? []) origin.lockfilePath = relativePath(root, origin.lockfilePath);
  }
  for (const edge of graph.edges ?? []) {
    for (const origin of edge.origins ?? []) origin.lockfilePath = relativePath(root, origin.lockfilePath);
  }
  // Replaying collected evidence must never trigger artifact acquisition again.
  delete graph.embeddedEvidence;
  const evidence = structuredClone(input.scan.evidence);
  for (const item of evidence) for (const file of item.files) file.path = relativePath(root, file.path);
  const payload = scrub({
    tool: { version: OHRISK_VERSION, rulesVersion: OHRISK_VERSION, spdxSourceCommit: SPDX_LICENSE_LIST_SOURCE_COMMIT },
    capturedAt: new Date().toISOString(), inputs: input.inputs, policyDigest: input.scan.policy.digest,
    waiverDigest: input.waiverDigest, prodOnly: input.prodOnly,
    project: { lockfiles: projectLockfiles(input.scan.project).map((file) => ({ kind: file.kind, path: relativePath(root, file.path) })) },
    ...(input.replayedFrom ? { replayedFrom: input.replayedFrom } : {}), graph, evidence,
    artifacts: input.artifacts, artifactsTruncated: input.artifactsTruncated,
    ...(input.repository ? { repository: input.repository } : {})
  }) as SnapshotPayload;
  return { $schema: "urn:ohrisk:schema:inspection-snapshot:1.0.0", schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    payloadSha256: digest(JSON.stringify(payload)), payload };
}

export function readInspectionSnapshot(filePath: string): Result<InspectionSnapshot, OhriskError> {
  const loaded = readTextFileWithLimit({ filePath, maxBytes: SNAPSHOT_MAX_BYTES });
  if (!loaded.ok) return snapshotError("Snapshot could not be read within the 32 MiB limit.");
  try {
    const value: unknown = JSON.parse(loaded.value);
    if (!isRecord(value) || value.$schema !== "urn:ohrisk:schema:inspection-snapshot:1.0.0"
      || value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || typeof value.payloadSha256 !== "string"
      || !validateSnapshotPayload(value.payload)
      || digest(JSON.stringify(value.payload)) !== value.payloadSha256) {
      return snapshotError("Snapshot structure or content digest does not match.");
    }
    return ok(value as InspectionSnapshot);
  } catch { return snapshotError("Snapshot is not valid bounded JSON."); }
}

export function snapshotError(message: string): Result<never, OhriskError> {
  return err(createError({ code: "INVALID_ARGUMENT", category: "invalid_input", message }));
}
export function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

function relativePath(root: string, value: string): string {
  if (!path.isAbsolute(value)) return value.replace(/\\/gu, "/");
  const relative = path.relative(root, value);
  return relative.startsWith("..") || path.isAbsolute(relative) ? `[external]/${path.basename(value)}` : relative.replace(/\\/gu, "/");
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/https?:\/\/[^\s<>"']+/giu, (url) => safeArtifactOrigin(url) ?? "[url]")
      .replace(/file:\/\/[^\s<>"']+/giu, "[local-path]")
      .replace(/[A-Za-z]:[\\/][^\s<>"']+/gu, "[local-path]");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}
