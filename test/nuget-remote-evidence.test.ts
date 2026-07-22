import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { collectGraphEvidence, type ArtifactFetcher } from "../src/evidence/collect";
import { createZip } from "./helpers/zip";

const SERVICE_INDEX_URL = "https://api.nuget.org/v3/index.json";
const PACKAGE_BASE_URL = "https://api.nuget.org/v3-flatcontainer/";
const REGISTRATION_BASE_URL = "https://api.nuget.org/v3/registration5-gz-semver2/";

describe("remote NuGet package evidence", () => {
  test("verifies catalog SHA-512 before trusting nuspec evidence", async () => {
    const fixture = nugetFixture("Risk.Package", "1.2.3", "Apache-2.0");
    const fetchedUrls: string[] = [];
    const observedHeaders: Array<Record<string, string> | undefined> = [];
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      registryAuthTokens: new Map([["api.nuget.org", "secret-must-not-leak"]]),
      resolveArtifactHost: publicResolver,
      fetchArtifact: async (url, options) => {
        fetchedUrls.push(url);
        observedHeaders.push(options?.headers);
        return fixture.fetch(url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(fetchedUrls).toEqual(fixture.urls);
    expect(observedHeaders.every((headers) => headers?.authorization === undefined)).toBe(true);
    expect(evidence.value[0]).toMatchObject({
      packageId: "Risk.Package@1.2.3",
      metadataLicense: "Apache-2.0",
      metadataSource: "nuspec",
      source: "tarball",
      warnings: []
    });
    expect(evidence.value[0]?.files.map((file) => file.path)).toEqual(["LICENSE"]);
  });

  test("normalizes an exact NuGet version through the flat-container version index", async () => {
    const fixture = nugetFixture("Risk.Package", "1.2.0", "MIT");
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Risk.Package", "1.2", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: publicResolver,
      fetchArtifact: fixture.fetch
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value[0]).toMatchObject({ metadataLicense: "MIT", source: "tarball" });
  });

  test("follows a discovered registration page on the fixed nuget.org host", async () => {
    const fixture = nugetFixture("Paged.Package", "2.0.0", "BSD-3-Clause", { paged: true });
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Paged.Package", "2.0.0", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: publicResolver,
      fetchArtifact: fixture.fetch
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(fixture.urls.some((url) => url.includes("/page/2.0.0/2.0.0.json"))).toBe(true);
    expect(evidence.value[0]).toMatchObject({ metadataLicense: "BSD-3-Clause" });
  });

  test("fails closed when NUPKG bytes do not match the catalog hash", async () => {
    const fixture = nugetFixture("Risk.Package", "1.2.3", "Apache-2.0", {
      catalogHash: Buffer.alloc(64).toString("base64")
    });
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: publicResolver,
      fetchArtifact: fixture.fetch
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected NuGet checksum mismatch to fail.");
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("rejects catalog identity drift before downloading package content", async () => {
    const fixture = nugetFixture("Risk.Package", "1.2.3", "Apache-2.0", {
      catalogName: "Other.Package"
    });
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: publicResolver,
      fetchArtifact: fixture.fetch
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected NuGet catalog identity mismatch to fail.");
    expect(evidence.error).toMatchObject({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      details: { reason: "catalog_identity_mismatch" }
    });
    expect(fixture.urls.at(-1)).toContain("/catalog0/");
  });

  test("rejects private DNS answers before contacting nuget.org", async () => {
    const fixture = nugetFixture("Risk.Package", "1.2.3", "Apache-2.0");
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "10.0.0.8", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return fixture.fetch(url);
      }
    });

    expect(fetchCount).toBe(0);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected private NuGet DNS to fail closed.");
    expect(evidence.error).toMatchObject({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      details: { artifactHost: "api.nuget.org", reason: "private_ipv4" }
    });
  });

  test("reuses cached NuGet metadata and NUPKG bytes while offline", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-offline-"));
    const fixture = nugetFixture("Risk.Package", "1.2.3", "Apache-2.0");
    try {
      const online = await collectGraphEvidence({
        graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
        projectRoot: cacheDir,
        allowLocalProjectEvidence: false,
        cacheDir,
        resolveArtifactHost: publicResolver,
        fetchArtifact: fixture.fetch
      });
      expect(online.ok).toBe(true);

      let fetchCount = 0;
      const offline = await collectGraphEvidence({
        graph: nugetGraph("Risk.Package", "1.2.3", fixture.integrity),
        projectRoot: cacheDir,
        allowLocalProjectEvidence: false,
        cacheDir,
        offline: true,
        fetchArtifact: async (url) => {
          fetchCount += 1;
          return fixture.fetch(url);
        }
      });
      expect(fetchCount).toBe(0);
      expect(offline.ok).toBe(true);
      if (!offline.ok) throw new Error(offline.error.message);
      expect(offline.value[0]).toMatchObject({ metadataLicense: "Apache-2.0", source: "tarball" });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test("does not substitute nuget.org bytes when the selected input has no content hash", async () => {
    const fixture = nugetFixture("Private.Package", "1.0.0", "MIT");
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: nugetGraph("Private.Package", "1.0.0"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return fixture.fetch(url);
      }
    });

    expect(fetchCount).toBe(0);
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
  });

  test("fails closed when the nuget.org catalog hash differs from the lock hash", async () => {
    const fixture = nugetFixture("Collision.Package", "1.0.0", "MIT");
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: nugetGraph(
        "Collision.Package",
        "1.0.0",
        `sha512-${Buffer.alloc(64).toString("base64")}`
      ),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: publicResolver,
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return fixture.fetch(url);
      }
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected NuGet lock/catalog mismatch to fail.");
    expect(evidence.error).toMatchObject({
      code: "PACKAGE_INTEGRITY_CHECK_FAILED",
      details: { reason: "nuget_catalog_lock_hash_mismatch" }
    });
    expect(fetchedUrls.some((url) => url.endsWith(".nupkg"))).toBe(false);
  });
});

function nugetFixture(
  packageName: string,
  version: string,
  license: string,
  options: {
    paged?: boolean;
    catalogHash?: string;
    catalogName?: string;
  } = {}
): { fetch: ArtifactFetcher; urls: string[]; integrity: string } {
  const lowerName = packageName.toLowerCase();
  const lowerVersion = version.toLowerCase();
  const versionIndexUrl = `${PACKAGE_BASE_URL}${lowerName}/index.json`;
  const registrationUrl = `${REGISTRATION_BASE_URL}${lowerName}/index.json`;
  const registrationPageUrl = `${REGISTRATION_BASE_URL}${lowerName}/page/${lowerVersion}/${lowerVersion}.json`;
  const catalogUrl = `https://api.nuget.org/v3/catalog0/data/2026.07.22.00.00.00/${lowerName}.${lowerVersion}.json`;
  const packageUrl = `${PACKAGE_BASE_URL}${lowerName}/${lowerVersion}/${lowerName}.${lowerVersion}.nupkg`;
  const nupkg = createZip({
    [`${packageName}.nuspec`]: [
      "<package>",
      "  <metadata>",
      `    <id>${packageName}</id>`,
      `    <version>${version}</version>`,
      `    <license type=\"expression\">${license}</license>`,
      "  </metadata>",
      "</package>"
    ].join("\n"),
    LICENSE: license === "Apache-2.0"
      ? "Apache License\nVersion 2.0, January 2004\n"
      : `${license} license\n`
  });
  const leaf = {
    catalogEntry: {
      "@id": catalogUrl,
      id: packageName,
      version
    },
    packageContent: packageUrl
  };
  const catalogHash = options.catalogHash ?? createHash("sha512").update(nupkg).digest("base64");
  const documents = new Map<string, Buffer>([
    [SERVICE_INDEX_URL, jsonBytes({
      resources: [
        { "@id": PACKAGE_BASE_URL, "@type": "PackageBaseAddress/3.0.0" },
        { "@id": REGISTRATION_BASE_URL, "@type": "RegistrationsBaseUrl/3.6.0" }
      ]
    })],
    [versionIndexUrl, jsonBytes({ versions: [lowerVersion] })],
    [registrationUrl, gzipSync(jsonBytes({
      items: options.paged
        ? [{ "@id": registrationPageUrl, lower: version, upper: version }]
        : [{ lower: version, upper: version, items: [leaf] }]
    }))],
    [catalogUrl, jsonBytes({
      id: options.catalogName ?? packageName,
      version,
      packageHash: catalogHash,
      packageHashAlgorithm: "SHA512",
      packageSize: nupkg.length
    })],
    [packageUrl, nupkg]
  ]);
  if (options.paged) {
    documents.set(
      registrationPageUrl,
      gzipSync(jsonBytes({ items: [leaf], lower: version, upper: version }))
    );
  }
  const urls: string[] = [];
  return {
    urls,
    integrity: `sha512-${catalogHash}`,
    fetch: async (url) => {
      urls.push(url);
      const bytes = documents.get(url);
      if (!bytes) {
        return artifactResponse(Buffer.alloc(0), url, 404, "Not Found");
      }
      return artifactResponse(bytes, url);
    }
  };
}

function nugetGraph(name: string, version: string, integrity?: string) {
  const id = `${name}@${version}`;
  return {
    lockfilePath: "packages.lock.json",
    nodes: [{
      id,
      name,
      version,
      ecosystem: "nuget" as const,
      ...(integrity ? { integrity } : {}),
      dependencyType: "production" as const,
      direct: true,
      paths: [["root", id]]
    }]
  };
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function artifactResponse(bytes: Buffer, url: string, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
    headers: {
      get: (name: string) => name.toLowerCase() === "content-length"
        ? String(bytes.length)
        : null
    },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }),
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
  };
}

async function publicResolver() {
  return [{ address: "1.1.1.1", family: 4 }];
}
