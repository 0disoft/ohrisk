import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "bun:test";

import { collectGraphEvidence } from "../src/evidence/collect";
import { createTarEntries, createTarGz } from "./helpers/tar";

describe("remote RubyGems evidence", () => {
  test("uses checksum-verified gem contents instead of registry license claims", async () => {
    const gem = rubyGem("risk-gem", "1.2.3", ["AGPL-3.0-only"], {
      LICENSE: "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n"
    });
    const metadata = rubyGemsMetadata("risk-gem", "1.2.3", gem, {
      licenses: ["MIT"]
    });
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: gemGraph("risk-gem", "1.2.3"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        return artifactResponse(url.includes("/api/v2/") ? Buffer.from(metadata) : gem, url);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(fetchedUrls).toEqual([
      "https://rubygems.org/api/v2/rubygems/risk-gem/versions/1.2.3.json?platform=ruby",
      "https://rubygems.org/gems/risk-gem-1.2.3.gem"
    ]);
    expect(evidence.value[0]).toMatchObject({
      packageId: "risk-gem@1.2.3",
      metadataLicense: "AGPL-3.0-only",
      metadataSource: "metadata.gz",
      source: "tarball",
      warnings: []
    });
    expect(evidence.value[0]?.files.map((file) => file.path)).toEqual(["LICENSE"]);
  });

  test("fails closed when the RubyGems API checksum does not match the gem", async () => {
    const gem = rubyGem("risk-gem", "1.2.3", ["MIT"], { LICENSE: "MIT License\n" });
    const metadata = JSON.stringify({
      name: "risk-gem",
      version: "1.2.3",
      platform: "ruby",
      sha: "00".repeat(32),
      gem_uri: "https://rubygems.org/gems/risk-gem-1.2.3.gem"
    });
    const evidence = await collectGraphEvidence({
      graph: gemGraph("risk-gem", "1.2.3"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(url.includes("/api/v2/") ? Buffer.from(metadata) : gem, url)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected Ruby gem checksum mismatch to fail.");
    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("rejects metadata for another gem before fetching its artifact", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: gemGraph("risk-gem", "1.2.3"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.from(JSON.stringify({
          name: "other-gem",
          version: "1.2.3",
          platform: "ruby",
          sha: "00".repeat(32),
          gem_uri: "https://rubygems.org/gems/other-gem-1.2.3.gem"
        })), url);
      }
    });

    expect(fetchCount).toBe(1);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) throw new Error("Expected mismatched RubyGems metadata to fail.");
    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
  });

  test("does not contact RubyGems.org in offline mode without a cache entry", async () => {
    let fetchCount = 0;
    const evidence = await collectGraphEvidence({
      graph: gemGraph("risk-gem", "1.2.3"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      offline: true,
      fetchArtifact: async (url) => {
        fetchCount += 1;
        return artifactResponse(Buffer.alloc(0), url);
      }
    });

    expect(fetchCount).toBe(0);
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value[0]).toMatchObject({ source: "unavailable" });
  });

  test("isolates a checksum-verified gem that exceeds archive inspection limits", async () => {
    const dataArchive = gzipSync(createTarEntries([{
      path: "LICENSE",
      content: Buffer.alloc(50 * 1024 * 1024 + 1)
    }]));
    const gem = rubyGemWithDataArchive("large-gem", "1.0.0", ["MIT"], dataArchive);
    const metadata = rubyGemsMetadata("large-gem", "1.0.0", gem);
    const evidence = await collectGraphEvidence({
      graph: gemGraph("large-gem", "1.0.0"),
      projectRoot: ".",
      allowLocalProjectEvidence: false,
      resolveArtifactHost: async () => [{ address: "1.1.1.1", family: 4 }],
      fetchArtifact: async (url) => artifactResponse(
        url.includes("/api/v2/") ? Buffer.from(metadata) : gem,
        url
      )
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) throw new Error(evidence.error.message);
    expect(evidence.value[0]).toMatchObject({
      packageId: "large-gem@1.0.0",
      files: [],
      source: "unavailable"
    });
    expect(evidence.value[0]?.warnings.join("\n")).toContain("bounded archive inspection limit");
  });
});

function rubyGem(
  name: string,
  version: string,
  licenses: string[],
  files: Record<string, string>
): Buffer {
  return rubyGemWithDataArchive(name, version, licenses, createTarGz(files));
}

function rubyGemWithDataArchive(
  name: string,
  version: string,
  licenses: string[],
  dataArchive: Buffer
): Buffer {
  const metadata = [
    "--- !ruby/object:Gem::Specification",
    `name: ${name}`,
    "version: !ruby/object:Gem::Version",
    `  version: '${version}'`,
    "platform: ruby",
    "licenses:",
    ...licenses.map((license) => `- ${license}`),
    ""
  ].join("\n");
  return createTarEntries([
    { path: "metadata.gz", content: gzipSync(Buffer.from(metadata)) },
    { path: "data.tar.gz", content: dataArchive }
  ]);
}

function rubyGemsMetadata(
  name: string,
  version: string,
  gem: Buffer,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    name,
    version,
    platform: "ruby",
    sha: createHash("sha256").update(gem).digest("hex"),
    gem_uri: `https://rubygems.org/gems/${name}-${version}.gem`,
    ...extra
  });
}

function gemGraph(name: string, version: string) {
  const id = `${name}@${version}`;
  return {
    lockfilePath: "Gemfile.lock",
    nodes: [{
      id,
      name,
      version,
      ecosystem: "gem" as const,
      dependencyType: "production" as const,
      direct: true,
      paths: [["root", id]]
    }]
  };
}

function artifactResponse(bytes: Buffer, url: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: {
      get: (name: string) => name.toLowerCase() === "content-length" ? String(bytes.length) : null
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
