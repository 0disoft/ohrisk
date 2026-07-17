import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createArtifactCache } from "../src/evidence/cache";
import { collectGraphEvidence } from "../src/evidence/collect";
import {
  collectPythonDistributionEvidence,
  parsePyPiReleaseMetadata
} from "../src/evidence/pypi-package";
import type { DependencyGraph, PackageEcosystem } from "../src/graph/types";
import { createTarGz } from "./helpers/tar";
import { createZip } from "./helpers/zip";

const PYPI_METADATA_URL = "https://pypi.org/pypi/example-pkg/1.2.3/json";
const PYPI_ARTIFACT_URL =
  "https://files.pythonhosted.org/packages/example/example_pkg-1.2.3-py3-none-any.whl";

describe("PyPI release evidence", () => {
  test("selects a non-yanked wheel before an sdist and reads release license metadata", () => {
    const result = parsePyPiReleaseMetadata({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      registryUrl: PYPI_METADATA_URL,
      text: JSON.stringify({
        info: {
          name: "Example_Pkg",
          version: "1.2.3",
          license_expression: "Apache-2.0",
          classifiers: []
        },
        urls: [
          pypiArtifact({
            filename: "example_pkg-1.2.3-py3-none-any.whl",
            url: PYPI_ARTIFACT_URL,
            packageType: "bdist_wheel",
            sha256: "b".repeat(64)
          }),
          pypiArtifact({
            filename: "example_pkg-1.2.3.tar.gz",
            url: "https://files.pythonhosted.org/packages/example/example_pkg-1.2.3.tar.gz",
            packageType: "sdist",
            sha256: "a".repeat(64)
          }),
          pypiArtifact({
            filename: "example_pkg-1.2.3.zip",
            url: "https://files.pythonhosted.org/packages/example/example_pkg-1.2.3.zip",
            packageType: "sdist",
            sha256: "c".repeat(64),
            yanked: true
          })
        ]
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      artifact: {
        filename: "example_pkg-1.2.3-py3-none-any.whl",
        url: PYPI_ARTIFACT_URL,
        sha256: "b".repeat(64),
        packageType: "bdist_wheel",
        yanked: false
      },
      metadataLicense: "Apache-2.0"
    });
  });

  test("rejects release metadata without a supported SHA-256 distribution", () => {
    const result = parsePyPiReleaseMetadata({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      registryUrl: PYPI_METADATA_URL,
      text: JSON.stringify({
        info: { name: "example-pkg", version: "1.2.3" },
        urls: [{
          filename: "example_pkg-1.2.3.tar.gz",
          url: "https://files.pythonhosted.org/packages/example/example_pkg-1.2.3.tar.gz",
          packagetype: "sdist",
          digests: {}
        }]
      })
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing SHA-256 metadata to fail.");
    expect(result.error).toMatchObject({
      code: "REGISTRY_METADATA_FETCH_FAILED",
      category: "unsupported_input",
      message: "PyPI release metadata did not include a supported distribution with a SHA-256 digest."
    });
  });

  test("rejects distribution URLs outside the official PyPI file host", () => {
    const result = parsePyPiReleaseMetadata({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      registryUrl: PYPI_METADATA_URL,
      text: JSON.stringify({
        info: { name: "example-pkg", version: "1.2.3" },
        urls: [pypiArtifact({
          filename: "example_pkg-1.2.3-py3-none-any.whl",
          url: "https://cdn.example.com/example_pkg-1.2.3-py3-none-any.whl",
          packageType: "bdist_wheel",
          sha256: "a".repeat(64)
        })]
      })
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a non-PyPI distribution host to fail.");
    expect(result.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
  });

  test("reads wheel METADATA and PEP 639 license files", () => {
    const wheel = exampleWheel("Apache-2.0");
    const result = collectPythonDistributionEvidence({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      artifactFilename: "example_pkg-1.2.3-py3-none-any.whl",
      artifactBytes: wheel,
      artifactMaxBytes: 1024 * 1024
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      packageId: "example-pkg@1.2.3",
      metadataLicense: "Apache-2.0",
      metadataSource: "example_pkg-1.2.3.dist-info/METADATA",
      source: "tarball",
      warnings: []
    });
    expect(result.value.files).toEqual([{
      path: "example_pkg-1.2.3.dist-info/licenses/LICENSE.txt",
      kind: "license",
      text: "Apache License fixture text."
    }]);
  });

  test("prefers a valid PyPI license over malformed wheel license prose", () => {
    const wheel = createZip({
      "example_pkg-1.2.3.dist-info/METADATA": [
        "Metadata-Version: 2.1",
        "Name: Example_Pkg",
        "Version: 1.2.3",
        "License: Copyright 2010 Example Authors",
        ""
      ].join("\n")
    });
    const result = collectPythonDistributionEvidence({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      artifactFilename: "example_pkg-1.2.3-py3-none-any.whl",
      artifactBytes: wheel,
      artifactMaxBytes: 1024 * 1024,
      registryMetadataLicense: "BSD-3-Clause"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      metadataLicense: "BSD-3-Clause",
      metadataSource: "PyPI release metadata",
      source: "tarball"
    });
    expect(result.value.warnings).toContain(
      "Distribution metadata contained a malformed license value; the valid PyPI release metadata license was preferred."
    );
  });

  test("reads sdist PKG-INFO and root license files", () => {
    const sdist = createTarGz({
      "example_pkg-1.2.3/PKG-INFO": pythonMetadata("MIT"),
      "example_pkg-1.2.3/LICENSE": "MIT License fixture text."
    });
    const result = collectPythonDistributionEvidence({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      artifactFilename: "example_pkg-1.2.3.tar.gz",
      artifactBytes: sdist,
      artifactMaxBytes: 1024 * 1024
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ metadataLicense: "MIT", source: "tarball" });
    expect(result.value.files).toEqual([{
      path: "LICENSE",
      kind: "license",
      text: "MIT License fixture text."
    }]);
  });

  test("finds root license files when sdist metadata is under egg-info", () => {
    const sdist = createTarGz({
      "example_pkg-1.2.3/example_pkg.egg-info/PKG-INFO": pythonMetadata("MIT"),
      "example_pkg-1.2.3/LICENSE": "MIT License fixture text."
    });
    const result = collectPythonDistributionEvidence({
      packageId: "example-pkg@1.2.3",
      packageName: "example-pkg",
      version: "1.2.3",
      artifactFilename: "example_pkg-1.2.3.tar.gz",
      artifactBytes: sdist,
      artifactMaxBytes: 1024 * 1024
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.files.map((file) => file.path)).toEqual(["LICENSE"]);
  });

  test("fetches exact-version PyPI metadata and a SHA-256 verified wheel without npm credentials", async () => {
    const wheel = exampleWheel("Apache-2.0");
    const metadata = pypiMetadata(wheel);
    const observed: Array<{ url: string; authorization?: string }> = [];

    const result = await collectGraphEvidence({
      graph: graphFor("pypi"),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      registryAuthTokens: new Map([["pypi.org", "must-not-leak"]]),
      evidenceConcurrency: 1,
      fetchArtifact: async (url, options) => {
        observed.push({
          url,
          ...(options?.headers?.authorization
            ? { authorization: options.headers.authorization }
            : {})
        });
        return okResponse(url === PYPI_METADATA_URL ? metadata : wheel);
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(observed).toEqual([{ url: PYPI_METADATA_URL }, { url: PYPI_ARTIFACT_URL }]);
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(result.value[0]).toMatchObject({
      metadataLicense: "Apache-2.0",
      source: "tarball",
      warnings: []
    });
  });

  test("fails closed when the PyPI distribution digest does not match", async () => {
    const wheel = exampleWheel("MIT");
    const metadata = pypiMetadata(wheel, "0".repeat(64));
    const result = await collectGraphEvidence({
      graph: graphFor("pypi"),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async (url) => okResponse(url === PYPI_METADATA_URL ? metadata : wheel)
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a mismatched PyPI distribution digest to fail.");
    expect(result.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
  });

  test("does not follow PyPI distribution redirects to another public host", async () => {
    const wheel = exampleWheel("MIT");
    const metadata = pypiMetadata(wheel);
    const result = await collectGraphEvidence({
      graph: graphFor("pypi"),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      allowedArtifactHosts: ["cdn.example.com"],
      fetchArtifact: async (url) => {
        if (url === PYPI_METADATA_URL) {
          return okResponse(metadata);
        }
        return {
          ok: false,
          status: 302,
          statusText: "Found",
          headers: {
            get: (name: string) => name.toLowerCase() === "location"
              ? "https://cdn.example.com/example_pkg-1.2.3-py3-none-any.whl"
              : null
          },
          body: null,
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a cross-host PyPI redirect to fail.");
    expect(result.error).toMatchObject({
      code: "TARBALL_FETCH_FAILED",
      category: "unsupported_input",
      details: {
        artifactHost: "cdn.example.com",
        reason: "host_not_permitted"
      }
    });
  });

  test("uses cached PyPI metadata and distribution bytes while offline", async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), "ohrisk-pypi-offline-"));
    const wheel = exampleWheel("BSD-3-Clause");
    const metadata = Buffer.from(pypiMetadata(wheel), "utf8");
    let fetchCount = 0;
    try {
      const cache = createArtifactCache(cacheDir);
      const cacheMetadata = { fetchedAt: Date.now(), expiresAt: Date.now() + 60_000 };
      cache.write(PYPI_METADATA_URL, metadata, cacheMetadata);
      cache.write(PYPI_ARTIFACT_URL, wheel, cacheMetadata);

      const result = await collectGraphEvidence({
        graph: graphFor("pypi"),
        projectRoot: cacheDir,
        allowLocalProjectEvidence: false,
        cacheDir,
        offline: true,
        fetchArtifact: async () => {
          fetchCount += 1;
          throw new Error("Offline PyPI evidence must not use the network.");
        }
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(fetchCount).toBe(0);
      expect(result.value[0]).toMatchObject({
        metadataLicense: "BSD-3-Clause",
        source: "tarball"
      });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test("does not route unsupported ecosystems through the npm registry", async () => {
    let fetchCount = 0;
    const result = await collectGraphEvidence({
      graph: graphFor("maven"),
      projectRoot: process.cwd(),
      allowLocalProjectEvidence: false,
      fetchArtifact: async () => {
        fetchCount += 1;
        throw new Error("Unsupported ecosystems must not be routed to npm.");
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(fetchCount).toBe(0);
    expect(result.value).toEqual([{
      packageId: "example-pkg@1.2.3",
      files: [],
      source: "unavailable",
      warnings: ["Remote package evidence is not configured for the maven ecosystem."]
    }]);
  });
});

function graphFor(ecosystem: PackageEcosystem): DependencyGraph {
  return {
    rootName: "fixture",
    lockfilePath: ecosystem === "pypi" ? "requirements.txt" : "pom.xml",
    nodes: [{
      id: "example-pkg@1.2.3",
      name: "example-pkg",
      version: "1.2.3",
      ecosystem,
      dependencyType: "production",
      direct: true,
      paths: [["fixture", "example-pkg@1.2.3"]]
    }]
  };
}

function exampleWheel(license: string): Buffer {
  return createZip({
    "example_pkg-1.2.3.dist-info/METADATA": [
      pythonMetadata(license),
      "License-File: LICENSE.txt",
      ""
    ].join("\n"),
    "example_pkg-1.2.3.dist-info/licenses/LICENSE.txt": "Apache License fixture text."
  });
}

function pythonMetadata(license: string): string {
  return [
    "Metadata-Version: 2.4",
    "Name: Example_Pkg",
    "Version: 1.2.3",
    `License-Expression: ${license}`,
    ""
  ].join("\n");
}

function pypiMetadata(wheel: Buffer, sha256 = digestHex(wheel)): string {
  return JSON.stringify({
    info: {
      name: "example-pkg",
      version: "1.2.3",
      license_expression: "Apache-2.0",
      classifiers: []
    },
    urls: [pypiArtifact({
      filename: "example_pkg-1.2.3-py3-none-any.whl",
      url: PYPI_ARTIFACT_URL,
      packageType: "bdist_wheel",
      sha256,
      size: wheel.length
    })]
  });
}

function pypiArtifact(input: {
  filename: string;
  url: string;
  packageType: "sdist" | "bdist_wheel";
  sha256: string;
  yanked?: boolean;
  size?: number;
}): Record<string, unknown> {
  return {
    filename: input.filename,
    url: input.url,
    packagetype: input.packageType,
    digests: { sha256: input.sha256 },
    yanked: input.yanked ?? false,
    ...(input.size !== undefined ? { size: input.size } : {})
  };
}

function digestHex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function okResponse(input: Buffer | string): {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: () => null };
  body: ReadableStream<Uint8Array>;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
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
