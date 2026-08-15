import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createArtifactCache } from "../src/evidence/cache";
import { collectGraphEvidence } from "../src/evidence/collect";
import type { DependencyGraph } from "../src/graph/types";
import { createTarGz, integrityFor } from "./helpers/tar";

const TEST_INTEGRITY = `sha512-${Buffer.alloc(64).toString("base64")}`;

function graphForUrls(urls: string[]): DependencyGraph {
  return {
    rootName: "runtime-test",
    lockfilePath: "package-lock.json",
    nodes: urls.map((resolved, index) => ({
      id: `package-${index}@1.0.0`,
      name: `package-${index}`,
      version: "1.0.0",
      ecosystem: "npm",
      resolved,
      integrity: TEST_INTEGRITY,
      dependencyType: "production",
      direct: true,
      paths: [["runtime-test", `package-${index}@1.0.0`]]
    }))
  };
}

describe("evidence runtime controls", () => {
  test("offline cache misses never invoke the network fetcher", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-offline-"));
    let fetchCount = 0;
    try {
      const result = await collectGraphEvidence({
        graph: graphForUrls(["https://registry.npmjs.org/package/-/package-1.0.0.tgz"]),
        projectRoot: cacheDir,
        cacheDir,
        offline: true,
        fetchArtifact: async () => {
          fetchCount += 1;
          throw new Error("network must not be called");
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(fetchCount).toBe(0);
      expect(result.value).toEqual([expect.objectContaining({
        source: "unavailable",
        warnings: [expect.stringContaining("Offline mode")]
      })]);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("sends bearer authorization only to the exact configured registry host", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-auth-"));
    const observed: Array<{ url: string; authorization?: string }> = [];
    try {
      const result = await collectGraphEvidence({
        graph: graphForUrls([
          "https://packages.example.com/a.tgz",
          "https://cdn.example.com/b.tgz"
        ]),
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 1,
        allowedArtifactHosts: ["packages.example.com", "cdn.example.com"],
        registryAuthTokens: new Map([["packages.example.com", "secret-token"]]),
        fetchArtifact: async (url, options) => {
          observed.push({
            url,
            ...(options?.headers?.authorization
              ? { authorization: options.headers.authorization }
              : {})
          });
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: { get: () => null },
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
      });

      expect(result.ok).toBe(true);
      expect(observed).toEqual([
        {
          url: "https://packages.example.com/a.tgz",
          authorization: "Bearer secret-token"
        },
        { url: "https://cdn.example.com/b.tgz" }
      ]);
      expect(JSON.stringify(result)).not.toContain("secret-token");
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("revalidates stale entries with validators and reuses bytes after 304", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-304-"));
    const url = "https://registry.npmjs.org/cache-test/-/cache-test-1.0.0.tgz";
    const tarball = fixtureTarball("MIT");
    const observedHeaders: Array<Record<string, string> | undefined> = [];
    try {
      createArtifactCache(cacheDir, { now: () => 1_000 }).write(url, tarball, {
        fetchedAt: 1_000,
        expiresAt: 1_000,
        etag: '"v1"',
        lastModified: "Wed, 21 Oct 2015 07:28:00 GMT"
      });

      const result = await collectGraphEvidence({
        graph: graphForArtifact(url, integrityFor(tarball)),
        projectRoot: cacheDir,
        cacheDir,
        fetchArtifact: async (_requestedUrl, options) => {
          observedHeaders.push(options?.headers);
          return {
            ok: false,
            status: 304,
            statusText: "Not Modified",
            headers: headersFrom({
              "cache-control": "max-age=3600",
              etag: '"v1"'
            }),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(observedHeaders).toEqual([{
        "if-none-match": '"v1"',
        "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT"
      }]);
      expect(result.value).toEqual([expect.objectContaining({
        packageId: "cache-test@1.0.0",
        packageJsonLicense: "MIT",
        source: "tarball"
      })]);
      expect(createArtifactCache(cacheDir).read(url, 1024 * 1024)?.stale).toBe(false);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("uses validated stale bytes in offline mode without a network request", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-offline-stale-"));
    const url = "https://registry.npmjs.org/cache-test/-/cache-test-1.0.0.tgz";
    const tarball = fixtureTarball("Apache-2.0");
    let fetchCount = 0;
    try {
      createArtifactCache(cacheDir, { now: () => 1_000 }).write(url, tarball, {
        fetchedAt: 1_000,
        expiresAt: 1_000,
        etag: '"v1"'
      });

      const result = await collectGraphEvidence({
        graph: graphForArtifact(url, integrityFor(tarball)),
        projectRoot: cacheDir,
        cacheDir,
        offline: true,
        fetchArtifact: async () => {
          fetchCount += 1;
          throw new Error("network must not be called");
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(fetchCount).toBe(0);
      expect(result.value[0]).toMatchObject({
        packageJsonLicense: "Apache-2.0",
        source: "tarball"
      });
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("removes a stale entry when a successful response declares no-store", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-no-store-"));
    const url = "https://registry.npmjs.org/cache-test/-/cache-test-1.0.0.tgz";
    const oldTarball = fixtureTarball("MIT");
    const newTarball = fixtureTarball("BSD-3-Clause");
    try {
      createArtifactCache(cacheDir, { now: () => 1_000 }).write(url, oldTarball, {
        fetchedAt: 1_000,
        expiresAt: 1_000,
        etag: '"old"'
      });

      const result = await collectGraphEvidence({
        graph: graphForArtifact(url, integrityFor(newTarball)),
        projectRoot: cacheDir,
        cacheDir,
        fetchArtifact: async () => okResponse(newTarball, {
          "cache-control": "no-store",
          etag: '"new"'
        })
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]).toMatchObject({
        packageJsonLicense: "BSD-3-Clause",
        source: "tarball"
      });
      expect(createArtifactCache(cacheDir).read(url, 1024 * 1024)).toBeUndefined();
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("does not forward conditional cache validators across redirects", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cache-redirect-"));
    const url = "https://packages.example.com/cache-test.tgz";
    const redirectedUrl = "https://cdn.example.com/cache-test.tgz";
    const tarball = fixtureTarball("MIT");
    const observed: Array<{ url: string; headers?: Record<string, string> }> = [];
    try {
      createArtifactCache(cacheDir, { now: () => 1_000 }).write(url, tarball, {
        fetchedAt: 1_000,
        expiresAt: 1_000,
        etag: '"v1"'
      });

      const result = await collectGraphEvidence({
        graph: graphForArtifact(url, integrityFor(tarball)),
        projectRoot: cacheDir,
        cacheDir,
        allowedArtifactHosts: ["packages.example.com", "cdn.example.com"],
        fetchArtifact: async (requestedUrl, options) => {
          observed.push({
            url: requestedUrl,
            ...(options?.headers ? { headers: options.headers } : {})
          });
          if (requestedUrl === url) {
            return {
              ok: false,
              status: 302,
              statusText: "Found",
              headers: headersFrom({ location: redirectedUrl }),
              body: null,
              arrayBuffer: async () => new ArrayBuffer(0)
            };
          }
          return okResponse(tarball, { "cache-control": "max-age=3600" });
        }
      });

      expect(result.ok).toBe(true);
      expect(observed).toEqual([
        { url, headers: { "if-none-match": '"v1"' } },
        { url: redirectedUrl }
      ]);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

});


describe("batch cancellation propagation", () => {
  test("first fatal aborts in-flight sibling fetches, blocks queued work, and keeps the representative error", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-batch-"));
    const tarball = fixtureTarball("MIT");
    const urls = [
      "https://registry.npmjs.org/pending-b/-/pending-b-1.0.0.tgz",
      "https://registry.npmjs.org/pending-c/-/pending-c-1.0.0.tgz",
      "https://registry.npmjs.org/fatal-a/-/fatal-a-1.0.0.tgz",
      "https://registry.npmjs.org/queued-d/-/queued-d-1.0.0.tgz"
    ];
    const started: Array<{ url: string; signal: AbortSignal }> = [];
    const aborted: string[] = [];
    const completed: string[] = [];

    try {
      const result = await collectGraphEvidence({
        graph: graphForUrls(urls),
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 3,
        fetchTimeoutMs: 500,
        progress: (progress) => {
          completed.push(progress.packageId);
        },
        fetchArtifact: (url, options) => {
          const signal = options?.signal ?? new AbortController().signal;
          started.push({ url, signal });
          if (url === urls[2]) {
            return Promise.resolve(okResponse(tarball, { "cache-control": "max-age=3600" }));
          }
          return new Promise((_resolve, reject) => {
            const onAbort = () => {
              aborted.push(url);
              reject(new DOMException("aborted", "AbortError"));
            };
            if (signal.aborted) {
              onAbort();
            } else {
              signal.addEventListener("abort", onAbort, { once: true });
            }
          });
        }
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the batch to fail");
      expect(result.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
      expect(result.error.details?.packageId).toBe("package-2@1.0.0");
      expect(aborted).toEqual([
        "https://registry.npmjs.org/pending-b/-/pending-b-1.0.0.tgz",
        "https://registry.npmjs.org/pending-c/-/pending-c-1.0.0.tgz"
      ]);
      expect(completed).toEqual([]);
      expect(started.map((entry) => entry.url)).toEqual(urls.slice(0, 3));
      const indexFiles = readdirSync(path.join(cacheDir, "index"), {
        recursive: true,
        encoding: "utf8"
      }).filter((entry) => entry.endsWith(".json"));
      expect(indexFiles).toHaveLength(1);
      expect(existsSync(path.join(cacheDir, ".ohrisk-artifact-cache-maintained"))).toBe(false);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("caller signal abort propagates to every in-flight fetch without retries", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-caller-"));
    const urls = [
      "https://registry.npmjs.org/caller-a/-/caller-a-1.0.0.tgz",
      "https://registry.npmjs.org/caller-b/-/caller-b-1.0.0.tgz"
    ];
    const caller = new AbortController();
    let startedCount = 0;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const aborted: string[] = [];

    try {
      const run = collectGraphEvidence({
        graph: graphForUrls(urls),
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 2,
        fetchTimeoutMs: 500,
        signal: caller.signal,
        fetchArtifact: (url, options) => {
          startedCount += 1;
          if (startedCount === 2) {
            resolveStarted();
          }
          return new Promise((_resolve, reject) => {
            const onAbort = () => {
              aborted.push(url);
              reject(new DOMException("aborted", "AbortError"));
            };
            const signal = options?.signal;
            if (signal?.aborted) {
              onAbort();
            } else {
              signal?.addEventListener("abort", onAbort, { once: true });
            }
          });
        }
      });

      await started;
      caller.abort();
      const result = await run;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the batch to fail");
      expect(result.error.details?.reason).toBe("aborted");
      expect(aborted).toEqual(urls);
      expect(startedCount).toBe(2);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("transient retry backoff stops after a fatal sibling without another network attempt", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-retry-"));
    const tarball = fixtureTarball("MIT");
    const goZipUrl = "https://proxy.golang.org/github.com/example/mod/@v/v1.0.0.zip";
    const fatalUrl = "https://registry.npmjs.org/fatal-a/-/fatal-a-1.0.0.tgz";
    let goZipCalls = 0;

    try {
      const result = await collectGraphEvidence({
        graph: {
          rootName: "cancel-retry",
          lockfilePath: "go.mod",
          nodes: [
            {
              id: "github.com/example/mod@v1.0.0",
              name: "github.com/example/mod",
              version: "v1.0.0",
              ecosystem: "go",
              resolved: "go-module:github.com/example/mod@v1.0.0",
              integrity: `h1:${"A".repeat(43)}=`,
              dependencyType: "production",
              direct: true,
              paths: [["cancel-retry", "github.com/example/mod@v1.0.0"]]
            },
            {
              id: "package-a@1.0.0",
              name: "package-a",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: fatalUrl,
              integrity: TEST_INTEGRITY,
              dependencyType: "production",
              direct: true,
              paths: [["cancel-retry", "package-a@1.0.0"]]
            }
          ]
        },
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 2,
        fetchArtifact: (url) => {
          if (url === goZipUrl) {
            goZipCalls += 1;
            return Promise.resolve({
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
              headers: headersFrom({}),
              body: null,
              arrayBuffer: async () => new ArrayBuffer(0)
            });
          }
          return Promise.resolve(okResponse(tarball, { "cache-control": "max-age=3600" }));
        }
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the batch to fail");
      expect(result.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
      expect(result.error.details?.packageId).toBe("package-a@1.0.0");
      expect(goZipCalls).toBe(1);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("non-fatal evidence miss does not cancel sibling fetches", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-miss-"));
    const tarball = fixtureTarball("MIT");
    const missUrl = "https://registry.npmjs.org/miss/-/miss-1.0.0.tgz";
    const hitUrl = "https://registry.npmjs.org/hit/-/hit-1.0.0.tgz";
    const hitSignal: AbortSignal[] = [];

    try {
      const result = await collectGraphEvidence({
        graph: {
          rootName: "cancel-miss",
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "miss@1.0.0",
              name: "miss",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: missUrl,
              integrity: TEST_INTEGRITY,
              dependencyType: "production",
              direct: true,
              paths: [["cancel-miss", "miss@1.0.0"]]
            },
            {
              id: "hit@1.0.0",
              name: "hit",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: hitUrl,
              integrity: integrityFor(tarball),
              dependencyType: "production",
              direct: true,
              paths: [["cancel-miss", "hit@1.0.0"]]
            }
          ]
        },
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 2,
        fetchTimeoutMs: 500,
        fetchArtifact: (url, options) => {
          if (url === hitUrl) {
            hitSignal.push(options?.signal ?? new AbortController().signal);
            return Promise.resolve(okResponse(tarball, { "cache-control": "max-age=3600" }));
          }
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: headersFrom({}),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0)
          });
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value[0]).toMatchObject({ source: "unavailable" });
      expect(result.value[1]).toMatchObject({ packageJsonLicense: "MIT", source: "tarball" });
      expect(hitSignal[0]?.aborted).toBe(false);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("pre-fetch fatals keep the lowest input index as the representative", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-arbitration-"));
    let fetchCalls = 0;

    try {
      const result = await collectGraphEvidence({
        graph: graphForUrls([
          "http://registry.npmjs.org/a.tgz",
          "http://registry.npmjs.org/b.tgz"
        ]),
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 2,
        fetchArtifact: async () => {
          fetchCalls += 1;
          throw new Error("validation must reject before any fetch");
        }
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the batch to fail");
      expect(result.error.details?.reason).toBe("insecure_http_not_supported");
      expect(result.error.details?.packageId).toBe("package-0@1.0.0");
      expect(fetchCalls).toBe(0);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });

  test("a second concurrent fatal aborts the first sibling instead of replacing the representative", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cancel-two-fatal-"));
    const tarball = fixtureTarball("MIT");
    const urls = [
      "https://registry.npmjs.org/fatal-0/-/fatal-0-1.0.0.tgz",
      "https://registry.npmjs.org/fatal-1/-/fatal-1-1.0.0.tgz"
    ];
    const gates: Array<{
      resolve: () => void;
      reject: (error: unknown) => void;
    }> = [];
    const rejectedWithAbort: string[] = [];
    const completed: string[] = [];
    let startedCount = 0;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    try {
      const run = collectGraphEvidence({
        graph: graphForUrls(urls),
        projectRoot: cacheDir,
        cacheDir,
        evidenceConcurrency: 2,
        fetchTimeoutMs: 500,
        progress: (progress) => {
          completed.push(progress.packageId);
        },
        fetchArtifact: (url, options) => {
          startedCount += 1;
          if (startedCount === 2) {
            resolveStarted();
          }
          return new Promise((resolve, reject) => {
            gates.push({
              resolve: () => resolve(okResponse(tarball, { "cache-control": "max-age=3600" })),
              reject
            });
            const onAbort = () => {
              rejectedWithAbort.push(url);
              reject(new DOMException("aborted", "AbortError"));
            };
            const signal = options?.signal;
            if (signal?.aborted) {
              onAbort();
            } else {
              signal?.addEventListener("abort", onAbort, { once: true });
            }
          });
        }
      });

      await started;
      gates[1]?.resolve();
      const result = await run;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected the batch to fail");
      expect(result.error.details?.packageId).toBe("package-1@1.0.0");
      expect(completed).toEqual([]);
      expect(rejectedWithAbort).toEqual(["https://registry.npmjs.org/fatal-0/-/fatal-0-1.0.0.tgz"]);
    } finally {
      rmSync(cacheDir, { force: true, recursive: true });
    }
  });
});


function graphForArtifact(url: string, integrity: string): DependencyGraph {
  return {
    rootName: "runtime-test",
    lockfilePath: "package-lock.json",
    nodes: [{
      id: "cache-test@1.0.0",
      name: "cache-test",
      version: "1.0.0",
      ecosystem: "npm",
      resolved: url,
      integrity,
      dependencyType: "production",
      direct: true,
      paths: [["runtime-test", "cache-test@1.0.0"]]
    }]
  };
}

function fixtureTarball(license: string): Buffer {
  return createTarGz({
    "package/package.json": JSON.stringify({
      name: "cache-test",
      version: "1.0.0",
      license
    }),
    "package/LICENSE": `${license} license text\n`
  });
}

function headersFrom(values: Record<string, string>): { get: (name: string) => string | null } {
  const normalized = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    get: (name) => normalized.get(name.toLowerCase()) ?? null
  };
}

function okResponse(bytes: Buffer, headers: Record<string, string>) {
  return {
    ok: true as const,
    status: 200 as const,
    statusText: "OK",
    headers: headersFrom(headers),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        controller.close();
      }
    }),
    arrayBuffer: async () => {
      throw new Error("Streamed test responses must not use arrayBuffer().");
    }
  };
}
