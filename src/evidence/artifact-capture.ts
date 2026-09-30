import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export type ArtifactRetrieval = "network" | "cache" | "revalidated-cache" | "local" | "verification-only";
export type ArtifactCheck = { kind: string; value: string };
export type ArtifactReceipt = {
  packageId: string;
  /** Requested source URL; redirects and cache reuse do not prove a final URL. */
  requestedOrigin?: string;
  sha256: string;
  byteLength: number;
  retrievals: ArtifactRetrieval[];
  checks: ArtifactCheck[];
};

type Capture = {
  receipts: Map<string, ArtifactReceipt>;
  contentKeys: Set<string>;
  checks: Map<string, Map<string, ArtifactCheck>>;
  maxArtifacts: number;
  truncated: boolean;
  closed: boolean;
};
const activeCapture = new AsyncLocalStorage<Capture>();

export async function captureArtifacts<T>(
  work: () => Promise<T>, options: { maxArtifacts?: number } = {}
): Promise<{ value: T; artifacts: ArtifactReceipt[]; truncated: boolean }> {
  const maxArtifacts = options.maxArtifacts ?? 50_000;
  if (!Number.isSafeInteger(maxArtifacts) || maxArtifacts < 1 || maxArtifacts > 50_000) {
    throw new RangeError("Artifact capture limit must be an integer from 1 to 50000.");
  }
  const capture: Capture = { receipts: new Map(), contentKeys: new Set(), checks: new Map(), maxArtifacts, truncated: false, closed: false };
  const value = await activeCapture.run(capture, async () => {
    try { return await work(); } finally { capture.closed = true; }
  });
  const artifacts = [...capture.receipts.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, receipt]) => ({
    ...receipt, retrievals: [...receipt.retrievals].sort(),
    checks: [...(capture.checks.get(contentKey(receipt.packageId, receipt.sha256))?.entries() ?? [])]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, check]) => ({ ...check }))
  }));
  return { value, artifacts, truncated: capture.truncated };
}

export function recordArtifactBytes(input: {
  packageId: string; bytes: Uint8Array; requestedOrigin?: string; retrieval: ArtifactRetrieval;
}): void {
  const capture = activeCapture.getStore();
  if (!capture || capture.closed) return;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const requestedOrigin = safeArtifactOrigin(input.requestedOrigin);
  const key = JSON.stringify([input.packageId, requestedOrigin ?? null, sha256]);
  const existing = capture.receipts.get(key);
  if (existing) {
    if (!existing.retrievals.includes(input.retrieval)) existing.retrievals.push(input.retrieval);
    return;
  }
  if (capture.receipts.size >= capture.maxArtifacts) { capture.truncated = true; return; }
  capture.receipts.set(key, { packageId: input.packageId, ...(requestedOrigin ? { requestedOrigin } : {}),
    sha256, byteLength: input.bytes.byteLength, retrievals: [input.retrieval], checks: [] });
  capture.contentKeys.add(contentKey(input.packageId, sha256));
}

/** Call only after the declared integrity check has succeeded on these bytes. */
export function recordArtifactCheck(input: {
  packageId: string; bytes: Uint8Array; kind: string; value: string;
}): void {
  const capture = activeCapture.getStore();
  if (!capture || capture.closed) return;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const key = contentKey(input.packageId, sha256);
  if (!capture.contentKeys.has(key)) recordArtifactBytes({ packageId: input.packageId, bytes: input.bytes, retrieval: "verification-only" });
  if (!capture.contentKeys.has(key)) return;
  const checks = capture.checks.get(key) ?? new Map<string, ArtifactCheck>();
  checks.set(JSON.stringify([input.kind, input.value]), { kind: input.kind, value: input.value });
  capture.checks.set(key, checks);
}

function contentKey(packageId: string, sha256: string): string { return JSON.stringify([packageId, sha256]); }

export function safeArtifactOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return undefined; }
}
