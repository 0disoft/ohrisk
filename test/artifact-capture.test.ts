import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { captureArtifacts, recordArtifactBytes, recordArtifactCheck, safeArtifactOrigin } from "../src/evidence/artifact-capture";
import { verifyPackageIntegrity } from "../src/evidence/package-integrity";

test("artifact receipts separate content hashes, verified checks and retrieval provenance", async () => {
  const bytes = Buffer.from("artifact");
  const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
  const captured = await captureArtifacts(async () => {
    for (const retrieval of ["network", "cache"] as const) {
      recordArtifactBytes({ packageId: "npm:a", bytes, requestedOrigin: "https://u:secret@example.com/a?token=secret#secret", retrieval });
    }
    expect(verifyPackageIntegrity({ packageId: "npm:a", artifact: bytes, integrity, resolvedDetail: undefined }).ok).toBe(true);
    return "done";
  });
  expect(captured.value).toBe("done");
  expect(captured.artifacts).toEqual([{
    packageId: "npm:a", requestedOrigin: "https://example.com/a", sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length, retrievals: ["cache", "network"], checks: [{ kind: "sri", value: integrity }]
  }]);
});

test("concurrent captures and nested captures never mix packages", async () => {
  const runs = await Promise.all(["a", "b"].map((packageId) => captureArtifacts(async () => {
    await Promise.resolve();
    recordArtifactBytes({ packageId, bytes: Buffer.from(packageId), retrieval: "local" });
    const nested = await captureArtifacts(async () => recordArtifactCheck({ packageId: "nested", bytes: Buffer.from("nested"), kind: "test", value: "ok" }));
    expect(nested.artifacts.map((receipt) => receipt.packageId)).toEqual(["nested"]);
  })));
  expect(runs.map((run) => run.artifacts.map((receipt) => receipt.packageId))).toEqual([["a"], ["b"]]);
});

test("capture limits retain explicit truncation and failed integrity never becomes a verified check", async () => {
  const captured = await captureArtifacts(async () => {
    recordArtifactBytes({ packageId: "a", bytes: Buffer.from("a"), retrieval: "local" });
    const failed = verifyPackageIntegrity({ packageId: "a", artifact: Buffer.from("a"), integrity: `sha256-${Buffer.alloc(32).toString("base64")}`, resolvedDetail: undefined });
    expect(failed.ok).toBe(false);
    recordArtifactBytes({ packageId: "b", bytes: Buffer.from("b"), retrieval: "local" });
  }, { maxArtifacts: 1 });
  expect(captured.truncated).toBe(true);
  expect(captured.artifacts).toHaveLength(1);
  expect(captured.artifacts[0]?.checks).toEqual([]);
  expect(safeArtifactOrigin("file:///private/a")).toBeUndefined();
  expect(safeArtifactOrigin("not-a-url")).toBeUndefined();
});
