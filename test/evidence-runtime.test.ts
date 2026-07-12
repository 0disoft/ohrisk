import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
