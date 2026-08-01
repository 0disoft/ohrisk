import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import {
  collectGraphEvidence,
  goModuleProxyModUrl,
  goModuleProxyZipUrl
} from "../src/evidence/collect";
import { collectGoModuleZipEvidence } from "../src/evidence/go-module-zip";
import { normalizeLicenseEvidence } from "../src/license/normalize";
import { createZip } from "./helpers/zip";

describe("remote Go module evidence", () => {
  test("verifies go.sum h1 and reads root license files from a module zip", () => {
    const files = goModuleFiles("github.com/acme/risk", "v1.0.0", {
      "go.mod": [
        "module github.com/acme/risk",
        "require github.com/acme/child v1.2.0"
      ].join("\n"),
      LICENSE: [
        "MIT License",
        "Permission is hereby granted, free of charge, to any person obtaining a copy",
        "THE SOFTWARE IS PROVIDED \"AS IS\""
      ].join("\n")
    });
    const evidence = collectGoModuleZipEvidence({
      packageId: "github.com/acme/risk@v1.0.0",
      modulePath: "github.com/acme/risk",
      version: "v1.0.0",
      checksum: goH1(files),
      zip: createZip(files),
      artifactMaxBytes: 10 * 1024 * 1024
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value).toMatchObject({
      packageId: "github.com/acme/risk@v1.0.0",
      source: "tarball",
      warnings: [],
      goModuleRequirements: ["github.com/acme/child"]
    });
    expect(evidence.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
    expect(normalizeLicenseEvidence(evidence.value)).toMatchObject({
      expression: "MIT",
      confidence: "medium"
    });
  });


  test("fails closed when a module zip does not match go.sum", () => {
    const files = goModuleFiles("github.com/acme/risk", "v1.0.0", {
      LICENSE: "MIT License\n"
    });
    const evidence = collectGoModuleZipEvidence({
      packageId: "github.com/acme/risk@v1.0.0",
      modulePath: "github.com/acme/risk",
      version: "v1.0.0",
      checksum: `h1:${"A".repeat(43)}=`,
      zip: createZip(files),
      artifactMaxBytes: 10 * 1024 * 1024
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected Go checksum mismatch to fail.");
    }
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("withholds module edges when a verified go.mod has an incomplete require block", () => {
    const files = goModuleFiles("example.com/incomplete", "v1.0.0", {
      "go.mod": [
        "module example.com/incomplete",
        "require (",
        "  example.com/valid v1.0.0",
        "  example.com/missing-version",
        ""
      ].join("\n"),
      LICENSE: "MIT License\n"
    });
    const evidence = collectGoModuleZipEvidence({
      packageId: "example.com/incomplete@v1.0.0",
      modulePath: "example.com/incomplete",
      version: "v1.0.0",
      checksum: goH1(files),
      zip: createZip(files),
      artifactMaxBytes: 10 * 1024 * 1024
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value.goModuleRequirements).toBeUndefined();
  });


  test("fetches an exact checksum-identified module from the fixed Go proxy", async () => {
    const files = goModuleFiles("github.com/Azure/risk", "v1.2.3", {
      LICENSE: "Apache License\nVersion 2.0, January 2004\n"
    });
    const zip = createZip(files);
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "go.mod",
        nodes: [{
          id: "github.com/Azure/risk@v1.2.3",
          name: "github.com/Azure/risk",
          version: "v1.2.3",
          ecosystem: "go",
          integrity: goH1(files),
          dependencyType: "production",
          direct: true,
          paths: [["root", "github.com/Azure/risk@v1.2.3"]]
        }]
      },
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(zip, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchedUrls).toEqual([
      "https://proxy.golang.org/github.com/!azure/risk/@v/v1.2.3.zip"
    ]);
    expect(evidence.value[0]).toMatchObject({
      source: "tarball"
    });
    expect(evidence.value[0]?.goModuleRequirements).toBeUndefined();
  });

  test("uses a separately checksummed proxy go.mod when the verified zip has no module edges", async () => {
    const modulePath = "example.com/legacy";
    const version = "v1.2.3";
    const files = goModuleFiles(modulePath, version, {
      LICENSE: "MIT License\n"
    });
    const zip = createZip(files);
    const goMod = [
      `module ${modulePath}`,
      "require example.com/child v1.0.0",
      ""
    ].join("\n");
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: goModuleGraph(modulePath, version, goH1(files), goModH1(goMod)),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(url.endsWith(".mod") ? Buffer.from(goMod) : zip, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchedUrls).toEqual([
      "https://proxy.golang.org/example.com/legacy/@v/v1.2.3.zip",
      "https://proxy.golang.org/example.com/legacy/@v/v1.2.3.mod"
    ]);
    expect(evidence.value[0]).toMatchObject({
      source: "tarball",
      goModuleRequirements: ["example.com/child"]
    });
  });

  test("uses the checksummed proxy go.mod when local cache evidence has no go.mod", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-go-mod-fallback-"));
    const modulePath = "example.com/cached";
    const version = "v1.2.3";
    const moduleDir = path.join(projectRoot, "pkg", "mod", "example.com", `cached@${version}`);
    const goMod = [
      `module ${modulePath}`,
      "require example.com/child v1.0.0",
      ""
    ].join("\n");
    const fetchedUrls: string[] = [];

    try {
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(path.join(moduleDir, "LICENSE"), "MIT License\n", "utf8");

      const evidence = await collectGraphEvidence({
        graph: goModuleGraph(
          modulePath,
          version,
          `h1:${"A".repeat(43)}=`,
          goModH1(goMod)
        ),
        projectRoot,
        resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
        fetchArtifact: async (url) => {
          fetchedUrls.push(url);
          return artifactResponse(Buffer.from(goMod), url);
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }
      expect(fetchedUrls).toEqual([
        "https://proxy.golang.org/example.com/cached/@v/v1.2.3.mod"
      ]);
      expect(evidence.value[0]).toMatchObject({
        source: "local",
        goModuleRequirements: ["example.com/child"]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("withholds proxy go.mod edges when the standalone checksum does not match", async () => {
    const modulePath = "example.com/mismatch";
    const version = "v1.0.0";
    const files = goModuleFiles(modulePath, version, { LICENSE: "MIT License\n" });
    const goMod = `module ${modulePath}\nrequire example.com/child v1.0.0\n`;
    const evidence = await collectGraphEvidence({
      graph: goModuleGraph(
        modulePath,
        version,
        goH1(files),
        `h1:${"A".repeat(43)}=`
      ),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(
        url.endsWith(".mod") ? Buffer.from(goMod) : createZip(files),
        url
      )
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value[0]?.goModuleRequirements).toBeUndefined();
  });


  test("accepts the official Go proxy storage redirect without forwarding credentials", async () => {
    const files = goModuleFiles("example.com/risk", "v1.2.3", {
      LICENSE: "MIT License\n"
    });
    const zip = createZip(files);
    const fetchedUrls: string[] = [];
    const storageUrl = "https://storage.googleapis.com/proxy-golang-org-prod/example.zip?X-Goog-Signature=sensitive";
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "go.mod",
        nodes: [{
          id: "example.com/risk@v1.2.3",
          name: "example.com/risk",
          version: "v1.2.3",
          ecosystem: "go",
          integrity: goH1(files),
          dependencyType: "production",
          direct: true,
          paths: [["root", "example.com/risk@v1.2.3"]]
        }]
      },
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return url.startsWith("https://proxy.golang.org/")
          ? {
              ok: false,
              status: 302,
              statusText: "Found",
              url,
              headers: { get: (name: string) => name.toLowerCase() === "location" ? storageUrl : null },
              arrayBuffer: async () => new ArrayBuffer(0)
            }
          : artifactResponse(zip, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchedUrls).toEqual([
      "https://proxy.golang.org/example.com/risk/@v/v1.2.3.zip",
      storageUrl
    ]);
    expect(evidence.value[0]).toMatchObject({ source: "tarball", warnings: [] });
  });

  test("retries one transient Go proxy response and keeps the verified result", async () => {
    const files = goModuleFiles("example.com/retry", "v1.0.0", {
      LICENSE: "MIT License\n"
    });
    const zip = createZip(files);
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: goModuleGraph("example.com/retry", "v1.0.0", goH1(files)),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return fetchCount === 1
          ? {
              ok: false,
              status: 503,
              statusText: "Service Unavailable",
              url,
              headers: { get: () => null },
              arrayBuffer: async () => new ArrayBuffer(0)
            }
          : artifactResponse(zip, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchCount).toBe(2);
    expect(evidence.value[0]).toMatchObject({ source: "tarball", warnings: [] });
  });

  test("does not retry permanent Go proxy responses", async () => {
    const checksum = `h1:${"A".repeat(43)}=`;
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: goModuleGraph("example.com/missing", "v1.0.0", checksum),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          url,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchCount).toBe(1);
    expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
  });

  test("does not multiply a full Go proxy timeout", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: goModuleGraph("example.com/stalled", "v1.0.0", `h1:${"A".repeat(43)}=`),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      fetchTimeoutMs: 1,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async () => {
        fetchCount += 1;
        return await new Promise<never>(() => {});
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(fetchCount).toBe(1);
    expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
  });

  test("does not fetch Go modules without zip checksums or with local replacements", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "go.mod",
        nodes: [
          {
            id: "example.com/no-sum@v1.0.0",
            name: "example.com/no-sum",
            version: "v1.0.0",
            ecosystem: "go",
            dependencyType: "production",
            direct: true,
            paths: [["root", "example.com/no-sum@v1.0.0"]]
          },
          {
            id: "example.com/local@v1.0.0",
            name: "example.com/local",
            version: "v1.0.0",
            ecosystem: "go",
            resolved: "./forks/local",
            integrity: `h1:${"A".repeat(43)}=`,
            dependencyType: "production",
            direct: true,
            paths: [["root", "example.com/local@v1.0.0"]]
          }
        ]
      },
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.alloc(0), url);
      }
    });

    expect(evidence.ok).toBe(true);
    expect(fetchCount).toBe(0);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }
    expect(evidence.value.map((item) => item.source)).toEqual(["unavailable", "unavailable"]);
  });

  test("rejects unsafe proxy coordinates before constructing a URL", () => {
    expect(goModuleProxyZipUrl("../private/module", "v1.0.0")).toBeUndefined();
    expect(goModuleProxyZipUrl("example.com/module", "../v1.0.0")).toBeUndefined();
    expect(goModuleProxyModUrl("../private/module", "v1.0.0")).toBeUndefined();
    expect(goModuleProxyModUrl("example.com/module", "../v1.0.0")).toBeUndefined();
  });
});

function goModuleFiles(
  modulePath: string,
  version: string,
  files: Record<string, string>
): Record<string, string> {
  const root = `${modulePath}@${version}`;
  return Object.fromEntries(Object.entries(files).map(([name, contents]) => [
    `${root}/${name}`,
    contents
  ]));
}

function goModuleGraph(
  modulePath: string,
  version: string,
  integrity: string,
  goModIntegrity?: string
) {
  const id = `${modulePath}@${version}`;
  return {
    lockfilePath: "go.mod",
    nodes: [{
      id,
      name: modulePath,
      version,
      ecosystem: "go" as const,
      integrity,
      ...(goModIntegrity ? { goModIntegrity } : {}),
      dependencyType: "production" as const,
      direct: true,
      paths: [["root", id]]
    }]
  };
}

function goH1(files: Record<string, string>): string {
  const summary = createHash("sha256");
  for (const fileName of Object.keys(files).sort()) {
    const contents = files[fileName] ?? "";
    const digest = createHash("sha256").update(contents, "utf8").digest("hex");
    summary.update(`${digest}  ${fileName}\n`, "utf8");
  }
  return `h1:${summary.digest("base64")}`;
}

function goModH1(goMod: string): string {
  const fileDigest = createHash("sha256").update(goMod, "utf8").digest("hex");
  return `h1:${createHash("sha256")
    .update(`${fileDigest}  go.mod\n`, "utf8")
    .digest("base64")}`;
}

function artifactResponse(bytes: Buffer, url: string) {
  const snapshot = Buffer.from(bytes);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: { get: () => null },
    body: new Blob([snapshot]).stream(),
    arrayBuffer: async () => Uint8Array.from(snapshot).buffer
  };
}
