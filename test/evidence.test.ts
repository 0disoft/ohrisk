import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { collectGraphEvidence } from "../src/evidence/collect";
import { classifyEvidenceFile } from "../src/evidence/license-files";
import { collectLocalPackageEvidence } from "../src/evidence/local-package";
import { collectTarballEvidence } from "../src/evidence/tarball";
import { parseBunLockfile } from "../src/graph/npm-bun-lock";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const bunProjectDir = path.join(fixturesDir, "bun-project");

describe("classifyEvidenceFile", () => {
  test("classifies common license evidence filename variants", () => {
    expect(classifyEvidenceFile("UNLICENSE")).toBe("license");
    expect(classifyEvidenceFile("LICENSE-MIT")).toBe("license");
    expect(classifyEvidenceFile("LICENCE_APACHE")).toBe("license");
    expect(classifyEvidenceFile("NOTICE_THIRD_PARTY")).toBe("notice");
    expect(classifyEvidenceFile("COPYING-LESSER")).toBe("copying");
    expect(classifyEvidenceFile("docs/LICENSE-MIT")).toBe("license");
    expect(classifyEvidenceFile("README.md")).toBeUndefined();
  });
});

describe("collectLocalPackageEvidence", () => {
  test("reads package metadata and license files", () => {
    const result = collectLocalPackageEvidence({
      packageId: "permissive-parent@1.0.0",
      packageDir: path.join(bunProjectDir, ".registry", "permissive-parent")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicense).toBe("MIT");
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files[0]?.path).toBe("LICENSE");
    expect(result.value.files[0]?.kind).toBe("license");
    expect(result.value.files[0]?.text).toContain("MIT License");
    expect(result.value.files[0]?.text).toContain("Permission is hereby granted");
    expect(result.value.warnings).toEqual([]);
  });

  test("reads local license evidence filename variants", () => {
    const packageDir = mkdtempSync(path.join(tmpdir(), "ohrisk-license-variant-"));

    try {
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "license-variant",
          version: "1.0.0"
        }),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "UNLICENSE"), "Unlicense fixture text.", "utf8");
      writeFileSync(path.join(packageDir, "NOTICE_THIRD_PARTY"), "Notice fixture text.", "utf8");

      const result = collectLocalPackageEvidence({
        packageId: "license-variant@1.0.0",
        packageDir
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.files.map((file) => file.path)).toEqual([
        "NOTICE_THIRD_PARTY",
        "UNLICENSE"
      ]);
      expect(result.value.files.map((file) => file.kind)).toEqual(["notice", "license"]);
      expect(result.value.warnings).toEqual([]);
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });

  test("reports non-object local package.json as package metadata failure", () => {
    const packageDir = mkdtempSync(path.join(tmpdir(), "ohrisk-local-package-json-shape-"));

    try {
      writeFileSync(path.join(packageDir, "package.json"), "[]", "utf8");
      writeFileSync(path.join(packageDir, "LICENSE"), "MIT License fixture text.", "utf8");

      const result = collectLocalPackageEvidence({
        packageId: "local-invalid-package-json@1.0.0",
        packageDir
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected non-object local package.json to fail.");
      }

      expect(result.error.code).toBe("PACKAGE_JSON_PARSE_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe("Failed to parse package.json from package artifact.");
      expect(result.error.details).toMatchObject({
        packageId: "local-invalid-package-json@1.0.0",
        packageJsonPath: path.join(packageDir, "package.json")
      });
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });

  test("rejects oversized local package.json before parsing metadata", () => {
    const packageDir = mkdtempSync(path.join(tmpdir(), "ohrisk-local-package-json-size-"));
    const packageJsonPath = path.join(packageDir, "package.json");

    try {
      writeFileSync(packageJsonPath, Buffer.alloc(9));
      writeFileSync(path.join(packageDir, "LICENSE"), "MIT License fixture text.", "utf8");

      const result = collectLocalPackageEvidence({
        packageId: "local-oversized-package-json@1.0.0",
        packageDir,
        packageJsonMaxBytes: 8
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected oversized local package.json to fail.");
      }

      expect(result.error.code).toBe("PACKAGE_EVIDENCE_READ_FAILED");
      expect(result.error.category).toBe("unsupported_input");
      expect(result.error.message).toBe(
        "Package artifact package.json exceeded the maximum supported size."
      );
      expect(result.error.details).toMatchObject({
        packageId: "local-oversized-package-json@1.0.0",
        packageJsonPath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });

  test("skips oversized local license evidence files without failing the package", () => {
    const packageDir = mkdtempSync(path.join(tmpdir(), "ohrisk-local-license-size-"));

    try {
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
          name: "local-oversized-license",
          version: "1.0.0",
          license: "MIT"
        }),
        "utf8"
      );
      writeFileSync(path.join(packageDir, "LICENSE"), Buffer.alloc(9));

      const result = collectLocalPackageEvidence({
        packageId: "local-oversized-license@1.0.0",
        packageDir,
        evidenceFileMaxBytes: 8
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.packageJsonLicense).toBe("MIT");
      expect(result.value.files).toEqual([]);
      expect(result.value.warnings).toEqual([
        "Skipped LICENSE: evidence file exceeded the maximum supported size (maxBytes: 8, observedBytes: 9)."
      ]);
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });
});

describe("collectTarballEvidence", () => {
  test("reads package metadata and license files from a gzipped tarball", () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "tarball-fixture",
        version: "1.0.0",
        license: "Apache-2.0"
      }),
      "package/LICENSE": "Apache License fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-fixture@1.0.0",
      tarball
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicense).toBe("Apache-2.0");
    expect(result.value.files).toEqual([
      {
        path: "LICENSE",
        kind: "license",
        text: "Apache License fixture text."
      }
    ]);
  });

  test("preserves deprecated package.json license objects from tarballs", () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "tarball-legacy-license",
        version: "1.0.0",
        license: { type: "BSD" }
      }),
      "package/LICENSE": "BSD license fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-legacy-license@1.0.0",
      tarball
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicenses).toEqual({ type: "BSD" });
  });

  test("reports malformed package.json inside tarballs as package metadata failure", () => {
    const tarball = createTarGz({
      "package/package.json": "{",
      "package/LICENSE": "MIT License fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-malformed-package-json@1.0.0",
      tarball
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed package.json to fail.");
    }

    expect(result.error.code).toBe("PACKAGE_JSON_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.message).toBe("Failed to parse package.json from package tarball.");
    expect(result.error.details).toMatchObject({
      packageId: "tarball-malformed-package-json@1.0.0"
    });
  });

  test("reports non-object package.json inside tarballs as package metadata failure", () => {
    const tarball = createTarGz({
      "package/package.json": "[]",
      "package/LICENSE": "MIT License fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-invalid-package-json@1.0.0",
      tarball
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected non-object tarball package.json to fail.");
    }

    expect(result.error.code).toBe("PACKAGE_JSON_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.message).toBe("Failed to parse package.json from package tarball.");
    expect(result.error.details).toMatchObject({
      packageId: "tarball-invalid-package-json@1.0.0"
    });
  });

  test("rejects truncated tarball entries before trusting package metadata", () => {
    const packageJson = JSON.stringify({
      name: "tarball-truncated-entry",
      version: "1.0.0",
      license: "MIT"
    });
    const tarball = createTruncatedTarGz({
      filePath: "package/package.json",
      content: packageJson,
      declaredSize: Buffer.byteLength(packageJson, "utf8") + 1024
    });

    const result = collectTarballEvidence({
      packageId: "tarball-truncated-entry@1.0.0",
      tarball
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected truncated tarball entry to fail.");
    }

    expect(result.error.code).toBe("TARBALL_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.message).toBe("Failed to parse package tarball evidence.");
    expect(result.error.details).toMatchObject({
      packageId: "tarball-truncated-entry@1.0.0",
      cause: "Tar entry package/package.json extends beyond archive data."
    });
  });

  test("rejects tarball entries with invalid header checksums before trusting package metadata", () => {
    const packageJson = JSON.stringify({
      name: "tarball-invalid-checksum",
      version: "1.0.0",
      license: "MIT"
    });
    const tarball = createInvalidChecksumTarGz({
      filePath: "package/package.json",
      content: packageJson
    });

    const result = collectTarballEvidence({
      packageId: "tarball-invalid-checksum@1.0.0",
      tarball
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid tarball header checksum to fail.");
    }

    expect(result.error.code).toBe("TARBALL_PARSE_FAILED");
    expect(result.error.category).toBe("unsupported_input");
    expect(result.error.message).toBe("Failed to parse package tarball evidence.");
    expect(result.error.details).toMatchObject({
      packageId: "tarball-invalid-checksum@1.0.0",
      cause: "Tar entry package/package.json has an invalid header checksum."
    });
  });

  test("reads tarball license evidence filename variants", () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "tarball-license-variant",
        version: "1.0.0"
      }),
      "package/LICENSE-MIT": "MIT License fixture text.",
      "package/COPYING-LESSER": "LGPL fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-license-variant@1.0.0",
      tarball
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.files).toEqual([
      {
        path: "COPYING-LESSER",
        kind: "copying",
        text: "LGPL fixture text."
      },
      {
        path: "LICENSE-MIT",
        kind: "license",
        text: "MIT License fixture text."
      }
    ]);
    expect(result.value.warnings).toEqual([]);
  });

  test("ignores nested tarball license evidence files", () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "tarball-nested-license",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/vendor/gpl-package/LICENSE": "Nested GPL fixture text.",
      "package/fixtures/NOTICE": "Nested notice fixture text.",
      "package/README.md": "Package README fixture text."
    });

    const result = collectTarballEvidence({
      packageId: "tarball-nested-license@1.0.0",
      tarball
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.packageJsonLicense).toBe("MIT");
    expect(result.value.files).toEqual([]);
    expect(result.value.warnings).toEqual([
      "No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."
    ]);
  });
});

describe("collectGraphEvidence", () => {
  test("collects evidence for every package in a parsed graph", async () => {
    const graph = parseBunLockfile(path.join(bunProjectDir, "bun.lock"));

    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      throw new Error(graph.error.message);
    }

    const evidence = await collectGraphEvidence({
      graph: graph.value,
      projectRoot: bunProjectDir
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toHaveLength(6);
    expect(evidence.value.map((item) => item.packageId)).toEqual([
      "agpl-child@0.1.0",
      "dev-risk@3.0.0",
      "dual-license@2.0.0",
      "gpl-package@5.0.0",
      "missing-license@4.0.0",
      "permissive-parent@1.0.0"
    ]);
    expect(evidence.value.flatMap((item) => item.files)).toHaveLength(5);
    const missingLicense = evidence.value.find((item) => item.packageId === "missing-license@4.0.0");
    expect(missingLicense).toMatchObject({
      files: [],
      warnings: ["No LICENSE, LICENCE, UNLICENSE, COPYING, or NOTICE file found."]
    });
    expect(missingLicense).not.toHaveProperty("packageJsonLicense");
  });

  test("fetches remote tarball evidence from HTTP resolved artifacts", async () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "remote-fixture",
        version: "1.2.3",
        license: "ISC"
      }),
      "package/LICENSE": "ISC License fixture text."
    });

    let fetchRedirectMode: string | undefined;
    const resolvedHosts: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "remote-fixture@1.2.3",
            name: "remote-fixture",
            version: "1.2.3",
            ecosystem: "npm",
            resolved: "https://registry.example.test/remote-fixture/-/remote-fixture-1.2.3.tgz",
            integrity: integrityFor(tarball),
            dependencyType: "production",
            direct: true,
            paths: [["root", "remote-fixture@1.2.3"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      resolveArtifactHost: async (hostname) => {
        resolvedHosts.push(hostname);
        return [{ address: "93.184.216.34", family: 4 }];
      },
      fetchArtifact: async (_url, options) => {
        fetchRedirectMode = options?.redirect;
        return okArtifactResponseFromBuffer(tarball);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toEqual([
      expect.objectContaining({
        packageId: "remote-fixture@1.2.3",
        packageJsonLicense: "ISC",
        source: "tarball",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "ISC License fixture text."
          }
        ]
      })
    ]);
    expect(resolvedHosts).toEqual(["registry.example.test"]);
    expect(fetchRedirectMode).toBe("manual");
  });

  test("rejects local tarballs that do not match lockfile integrity", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-local-integrity-"));
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "local-integrity-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License fixture text."
    });
    const tarballPath = path.join(projectRoot, "local-integrity-fixture.tgz");
    writeFileSync(tarballPath, tarball);

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "bun.lock",
          nodes: [
            {
              id: "local-integrity-fixture@1.0.0",
              name: "local-integrity-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: "file:local-integrity-fixture.tgz",
              integrity: integrityFor(Buffer.from("different tarball bytes")),
              dependencyType: "production",
              direct: true,
              paths: [["root", "local-integrity-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot
      });

      expect(evidence.ok).toBe(false);
      if (evidence.ok) {
        throw new Error("Expected local tarball integrity mismatch to fail.");
      }

      expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
      expect(evidence.error.category).toBe("unsupported_input");
      expect(evidence.error.details).toMatchObject({
        packageId: "local-integrity-fixture@1.0.0",
        resolved: "file:local-integrity-fixture.tgz"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects oversized local tarballs before reading package evidence", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-local-size-limit-"));
    const tarballPath = path.join(projectRoot, "oversized-local-fixture.tgz");
    writeFileSync(tarballPath, Buffer.alloc(9));

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "bun.lock",
          nodes: [
            {
              id: "oversized-local-fixture@1.0.0",
              name: "oversized-local-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: "file:oversized-local-fixture.tgz",
              dependencyType: "production",
              direct: true,
              paths: [["root", "oversized-local-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot,
        tarballMaxBytes: 8
      });

      expect(evidence.ok).toBe(false);
      if (evidence.ok) {
        throw new Error("Expected oversized local tarball to fail.");
      }

      expect(evidence.error.code).toBe("PACKAGE_EVIDENCE_READ_FAILED");
      expect(evidence.error.category).toBe("unsupported_input");
      expect(evidence.error.message).toBe(
        "Resolved package artifact exceeded the maximum supported size."
      );
      expect(evidence.error.details).toMatchObject({
        packageId: "oversized-local-fixture@1.0.0",
        resolved: "file:oversized-local-fixture.tgz",
        artifactPath: tarballPath,
        maxBytes: 8,
        observedBytes: 9
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("resolves URL-encoded file dependency artifact paths", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-encoded-file-artifact-"));
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "encoded-file-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License from encoded file artifact."
    });
    writeFileSync(path.join(projectRoot, "encoded file fixture.tgz"), tarball);

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "encoded-file-fixture@1.0.0",
              name: "encoded-file-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: "file:encoded%20file%20fixture.tgz",
              integrity: integrityFor(tarball),
              dependencyType: "production",
              direct: true,
              paths: [["root", "encoded-file-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toEqual([
        expect.objectContaining({
          packageId: "encoded-file-fixture@1.0.0",
          packageJsonLicense: "MIT",
          source: "tarball",
          files: [
            {
              path: "LICENSE",
              kind: "license",
              text: "MIT License from encoded file artifact."
            }
          ]
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects malformed integrity digests before comparing tarball bytes", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-malformed-integrity-"));
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "malformed-integrity-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License fixture text."
    });
    const tarballPath = path.join(projectRoot, "malformed-integrity-fixture.tgz");
    writeFileSync(tarballPath, tarball);

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "bun.lock",
          nodes: [
            {
              id: "malformed-integrity-fixture@1.0.0",
              name: "malformed-integrity-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: "file:malformed-integrity-fixture.tgz",
              integrity: "sha512-not-base64",
              dependencyType: "production",
              direct: true,
              paths: [["root", "malformed-integrity-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot
      });

      expect(evidence.ok).toBe(false);
      if (evidence.ok) {
        throw new Error("Expected malformed integrity to fail.");
      }

      expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
      expect(evidence.error.category).toBe("unsupported_input");
      expect(evidence.error.message).toBe(
        "Package artifact integrity could not be verified because no supported digest was found."
      );
      expect(evidence.error.details).toMatchObject({
        packageId: "malformed-integrity-fixture@1.0.0",
        resolved: "file:malformed-integrity-fixture.tgz",
        integrity: "sha512-not-base64",
        supportedAlgorithms: ["sha512", "sha384", "sha256", "sha1"]
      });
      expect(evidence.error.details).not.toHaveProperty("computed");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("rejects remote tarballs that do not match lockfile integrity", async () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "remote-integrity-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License fixture text."
    });

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "remote-integrity-fixture@1.0.0",
            name: "remote-integrity-fixture",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/remote-integrity-fixture/-/remote-integrity-fixture-1.0.0.tgz",
            integrity: integrityFor(Buffer.from("different tarball bytes")),
            dependencyType: "production",
            direct: true,
            paths: [["root", "remote-integrity-fixture@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => okArtifactResponseFromBuffer(tarball)
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected remote tarball integrity mismatch to fail.");
    }

    expect(evidence.error.code).toBe("PACKAGE_INTEGRITY_CHECK_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.details).toMatchObject({
      packageId: "remote-integrity-fixture@1.0.0",
      resolved: "https://registry.example.test/remote-integrity-fixture/-/remote-integrity-fixture-1.0.0.tgz"
    });
  });

  test("resolves npm registry metadata when a node has no direct artifact", async () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "registry-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License fixture text."
    });
    const fetchedUrls: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "registry-fixture@1.0.0",
            name: "registry-fixture",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "registry-fixture@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);

        if (url === "https://registry.npmjs.org/registry-fixture") {
          return okArtifactResponseFromBuffer(JSON.stringify({
            versions: {
              "1.0.0": {
                dist: {
                  tarball: "https://registry.example.test/registry-fixture/-/registry-fixture-1.0.0.tgz"
                }
              }
            }
          }));
        }

        return okArtifactResponseFromBuffer(tarball);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(fetchedUrls).toEqual([
      "https://registry.npmjs.org/registry-fixture",
      "https://registry.example.test/registry-fixture/-/registry-fixture-1.0.0.tgz"
    ]);
    expect(evidence.value).toEqual([
      expect.objectContaining({
        packageId: "registry-fixture@1.0.0",
        packageJsonLicense: "MIT",
        source: "tarball"
      })
    ]);
  });

  test("encodes scoped npm registry metadata URLs", async () => {
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "@scope/registry-fixture",
        version: "1.0.0",
        license: "MIT"
      }),
      "package/LICENSE": "MIT License fixture text."
    });
    const fetchedUrls: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "@scope/registry-fixture@1.0.0",
            name: "@scope/registry-fixture",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "@scope/registry-fixture@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);

        if (url === "https://registry.npmjs.org/@scope%2Fregistry-fixture") {
          return okArtifactResponseFromBuffer(JSON.stringify({
            versions: {
              "1.0.0": {
                dist: {
                  tarball: "https://registry.example.test/@scope/registry-fixture/-/registry-fixture-1.0.0.tgz"
                }
              }
            }
          }));
        }

        return okArtifactResponseFromBuffer(tarball);
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(fetchedUrls).toEqual([
      "https://registry.npmjs.org/@scope%2Fregistry-fixture",
      "https://registry.example.test/@scope/registry-fixture/-/registry-fixture-1.0.0.tgz"
    ]);
    expect(evidence.value).toEqual([
      expect.objectContaining({
        packageId: "@scope/registry-fixture@1.0.0",
        packageJsonLicense: "MIT",
        source: "tarball"
      })
    ]);
  });

  test("uses installed node_modules package evidence before registry fallback", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "installed-fixture",
      version: "1.0.0",
      license: "MIT",
      licenseText: "MIT License from node_modules."
    });

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "installed-fixture@1.0.0",
              name: "installed-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              dependencyType: "production",
              direct: true,
              paths: [["root", "installed-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async () => {
          throw new Error("Registry fallback should not run when node_modules evidence exists.");
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toEqual([
        expect.objectContaining({
          packageId: "installed-fixture@1.0.0",
          packageJsonLicense: "MIT",
          source: "local",
          files: [
            {
              path: "LICENSE",
              kind: "license",
              text: "MIT License from node_modules."
            }
          ]
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores oversized node_modules package metadata before trusting installed evidence", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "oversized-installed",
      version: "1.0.0",
      license: "MIT",
      licenseText: "MIT License from oversized node_modules package."
    });
    const packageJsonPath = path.join(
      projectRoot,
      "node_modules",
      "oversized-installed",
      "package.json"
    );

    try {
      writeFileSync(
        packageJsonPath,
        JSON.stringify({
          name: "oversized-installed",
          version: "1.0.0",
          license: "MIT",
          padding: "x".repeat(32)
        }),
        "utf8"
      );

      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "oversized-installed@1.0.0",
              name: "oversized-installed",
              version: "1.0.0",
              ecosystem: "npm",
              resolved: "workspace:oversized-installed",
              dependencyType: "production",
              direct: true,
              paths: [["root", "oversized-installed@1.0.0"]]
            }
          ]
        },
        projectRoot,
        installedPackageJsonMaxBytes: 8,
        fetchArtifact: async () => {
          throw new Error("Registry fallback should not run for unsupported resolved artifacts.");
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toEqual([
        {
          packageId: "oversized-installed@1.0.0",
          files: [],
          source: "unavailable",
          warnings: ["Unsupported resolved artifact specifier: workspace:oversized-installed"]
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses scoped installed node_modules package evidence", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "@scope/installed-fixture",
      version: "1.0.0",
      license: "MIT",
      licenseText: "MIT License from scoped node_modules package."
    });

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "@scope/installed-fixture@1.0.0",
              name: "@scope/installed-fixture",
              version: "1.0.0",
              ecosystem: "npm",
              dependencyType: "production",
              direct: true,
              paths: [["root", "@scope/installed-fixture@1.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async () => {
          throw new Error("Registry fallback should not run when scoped node_modules evidence exists.");
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toEqual([
        expect.objectContaining({
          packageId: "@scope/installed-fixture@1.0.0",
          packageJsonLicense: "MIT",
          source: "local",
          files: [
            {
              path: "LICENSE",
              kind: "license",
              text: "MIT License from scoped node_modules package."
            }
          ]
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses npm alias install names for node_modules package evidence", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "permissive-parent",
      installName: "compat-parent",
      version: "1.0.0",
      license: "MIT",
      licenseText: "MIT License from aliased node_modules package."
    });

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "permissive-parent@1.0.0",
              name: "permissive-parent",
              installNames: ["compat-parent"],
              version: "1.0.0",
              ecosystem: "npm",
              dependencyType: "production",
              direct: true,
              paths: [["root", "compat-parent -> permissive-parent@1.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async () => {
          throw new Error("Registry fallback should not run when alias node_modules evidence exists.");
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value).toEqual([
        expect.objectContaining({
          packageId: "permissive-parent@1.0.0",
          packageJsonLicense: "MIT",
          source: "local",
          files: [
            {
              path: "LICENSE",
              kind: "license",
              text: "MIT License from aliased node_modules package."
            }
          ]
        })
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses installed node_modules package evidence before remote tarball fetch", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "remote-but-installed",
      version: "2.0.0",
      license: "Apache-2.0",
      licenseText: "Apache License from node_modules."
    });

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "remote-but-installed@2.0.0",
              name: "remote-but-installed",
              version: "2.0.0",
              ecosystem: "npm",
              resolved: "https://registry.example.test/remote-but-installed/-/remote-but-installed-2.0.0.tgz",
              dependencyType: "production",
              direct: true,
              paths: [["root", "remote-but-installed@2.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async () => {
          throw new Error("Remote tarball fetch should not run when node_modules evidence exists.");
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(evidence.value[0]).toMatchObject({
        packageId: "remote-but-installed@2.0.0",
        packageJsonLicense: "Apache-2.0",
        source: "local"
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("ignores stale node_modules package evidence that does not match the lockfile node", async () => {
    const projectRoot = createInstalledPackageProject({
      name: "stale-installed",
      version: "1.0.0",
      license: "MIT",
      licenseText: "MIT License from stale node_modules."
    });
    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "stale-installed",
        version: "2.0.0",
        license: "Apache-2.0"
      }),
      "package/LICENSE": "Apache License from lockfile tarball."
    });
    const fetchedUrls: string[] = [];

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "stale-installed@2.0.0",
              name: "stale-installed",
              version: "2.0.0",
              ecosystem: "npm",
              resolved: "https://registry.example.test/stale-installed/-/stale-installed-2.0.0.tgz",
              integrity: integrityFor(tarball),
              dependencyType: "production",
              direct: true,
              paths: [["root", "stale-installed@2.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async (url) => {
          fetchedUrls.push(url);
          return okArtifactResponseFromBuffer(tarball);
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(fetchedUrls).toEqual([
        "https://registry.example.test/stale-installed/-/stale-installed-2.0.0.tgz"
      ]);
      expect(evidence.value[0]).toMatchObject({
        packageId: "stale-installed@2.0.0",
        packageJsonLicense: "Apache-2.0",
        source: "tarball",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "Apache License from lockfile tarball."
          }
        ]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not resolve invalid package names outside node_modules", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-node-modules-escape-"));
    const escapedPackageDir = path.join(projectRoot, "escaped-installed");
    mkdirSync(escapedPackageDir, { recursive: true });
    writeFileSync(
      path.join(escapedPackageDir, "package.json"),
      JSON.stringify({
        name: "../escaped-installed",
        version: "2.0.0",
        license: "MIT"
      }),
      "utf8"
    );
    writeFileSync(path.join(escapedPackageDir, "LICENSE"), "MIT License from escaped path.", "utf8");

    const tarball = createTarGz({
      "package/package.json": JSON.stringify({
        name: "../escaped-installed",
        version: "2.0.0",
        license: "Apache-2.0"
      }),
      "package/LICENSE": "Apache License from lockfile tarball."
    });
    const fetchedUrls: string[] = [];

    try {
      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "package-lock.json",
          nodes: [
            {
              id: "../escaped-installed@2.0.0",
              name: "../escaped-installed",
              version: "2.0.0",
              ecosystem: "npm",
              resolved: "https://registry.example.test/escaped-installed/-/escaped-installed-2.0.0.tgz",
              integrity: integrityFor(tarball),
              dependencyType: "production",
              direct: true,
              paths: [["root", "../escaped-installed@2.0.0"]]
            }
          ]
        },
        projectRoot,
        fetchArtifact: async (url) => {
          fetchedUrls.push(url);
          return okArtifactResponseFromBuffer(tarball);
        }
      });

      expect(evidence.ok).toBe(true);
      if (!evidence.ok) {
        throw new Error(evidence.error.message);
      }

      expect(fetchedUrls).toEqual([
        "https://registry.example.test/escaped-installed/-/escaped-installed-2.0.0.tgz"
      ]);
      expect(evidence.value[0]).toMatchObject({
        packageId: "../escaped-installed@2.0.0",
        packageJsonLicense: "Apache-2.0",
        source: "tarball",
        files: [
          {
            path: "LICENSE",
            kind: "license",
            text: "Apache License from lockfile tarball."
          }
        ]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports missing registry tarball metadata", async () => {
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "metadata-missing@1.0.0",
            name: "metadata-missing",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "metadata-missing@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => okArtifactResponseFromBuffer(JSON.stringify({ versions: {} }))
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected missing registry metadata to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
  });

  test("reports unsupported registry tarball URLs instead of treating evidence as unavailable", async () => {
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "metadata-file-url@1.0.0",
            name: "metadata-file-url",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "metadata-file-url@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => okArtifactResponseFromBuffer(JSON.stringify({
          versions: {
            "1.0.0": {
              dist: {
                tarball: "file:metadata-file-url-1.0.0.tgz"
              }
            }
          }
        }))
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected unsupported registry tarball URL to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe("npm registry metadata included an unsupported tarball URL.");
    expect(evidence.error.details).toMatchObject({
      packageId: "metadata-file-url@1.0.0",
      registryUrl: "https://registry.npmjs.org/metadata-file-url",
      version: "1.0.0",
      tarballUrl: "file:metadata-file-url-1.0.0.tgz"
    });
  });

  test("rejects registry tarball URLs that target local network hosts before fetching tarballs", async () => {
    const tarballUrl = "http://169.254.169.254/latest/meta-data/metadata-local-tarball.tgz";
    const fetchedUrls: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "metadata-local-tarball@1.0.0",
            name: "metadata-local-tarball",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "metadata-local-tarball@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        if (url !== "https://registry.npmjs.org/metadata-local-tarball") {
          throw new Error("Blocked registry tarball URL should not be fetched.");
        }

        return okArtifactResponseFromBuffer(JSON.stringify({
          versions: {
            "1.0.0": {
              dist: {
                tarball: tarballUrl
              }
            }
          }
        }));
      }
    });

    expect(fetchedUrls).toEqual(["https://registry.npmjs.org/metadata-local-tarball"]);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected local-network registry tarball URL to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe("npm registry metadata included an unsupported tarball URL.");
    expect(evidence.error.details).toMatchObject({
      packageId: "metadata-local-tarball@1.0.0",
      registryUrl: "https://registry.npmjs.org/metadata-local-tarball",
      version: "1.0.0",
      tarballUrl,
      artifactHost: "169.254.169.254",
      reason: "link_local_ipv4"
    });
  });

  test("rejects registry tarball hostnames that resolve to private hosts before fetching tarballs", async () => {
    const tarballUrl = "https://tarballs.example.test/metadata-dns-private-1.0.0.tgz";
    const fetchedUrls: string[] = [];
    const resolvedHosts: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "metadata-dns-private@1.0.0",
            name: "metadata-dns-private",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "metadata-dns-private@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      resolveArtifactHost: async (hostname) => {
        resolvedHosts.push(hostname);
        return hostname === "registry.npmjs.org"
          ? [{ address: "104.16.0.1", family: 4 }]
          : [{ address: "169.254.169.254", family: 4 }];
      },
      fetchArtifact: async (url) => {
        fetchedUrls.push(url);
        if (url !== "https://registry.npmjs.org/metadata-dns-private") {
          throw new Error("DNS-private registry tarball URL should not be fetched.");
        }

        return okArtifactResponseFromBuffer(JSON.stringify({
          versions: {
            "1.0.0": {
              dist: {
                tarball: tarballUrl
              }
            }
          }
        }));
      }
    });

    expect(resolvedHosts).toEqual(["registry.npmjs.org", "tarballs.example.test"]);
    expect(fetchedUrls).toEqual(["https://registry.npmjs.org/metadata-dns-private"]);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected DNS-private registry tarball host to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe("npm registry metadata included an unsupported tarball URL.");
    expect(evidence.error.details).toMatchObject({
      packageId: "metadata-dns-private@1.0.0",
      registryUrl: "https://registry.npmjs.org/metadata-dns-private",
      version: "1.0.0",
      tarballUrl,
      artifactHost: "tarballs.example.test",
      resolvedAddress: "169.254.169.254",
      reason: "link_local_ipv4"
    });
  });

  test("reports malformed registry metadata as unsupported input", async () => {
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "metadata-malformed@1.0.0",
            name: "metadata-malformed",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "metadata-malformed@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => okArtifactResponseFromBuffer(Uint8Array.of(123))
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected malformed registry metadata to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe("npm registry metadata was not valid JSON.");
    expect(evidence.error.details).toMatchObject({
      packageId: "metadata-malformed@1.0.0",
      registryUrl: "https://registry.npmjs.org/metadata-malformed"
    });
  });

  test("does not replace unsupported resolved artifacts with registry packages", async () => {
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "workspace-package@1.0.0",
            name: "workspace-package",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "workspace:*",
            dependencyType: "production",
            direct: true,
            paths: [["root", "workspace-package@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => {
        throw new Error("Registry fallback should not run for explicit unsupported artifacts.");
      }
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      throw new Error(evidence.error.message);
    }

    expect(evidence.value).toEqual([
      {
        packageId: "workspace-package@1.0.0",
        files: [],
        source: "unavailable",
        warnings: ["Unsupported resolved artifact specifier: workspace:*"]
      }
    ]);
  });

  test("reports remote tarball fetch failures", async () => {
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "missing-remote@9.9.9",
            name: "missing-remote",
            version: "9.9.9",
            ecosystem: "npm",
            resolved: "https://registry.example.test/missing-remote/-/missing-remote-9.9.9.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "missing-remote@9.9.9"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0)
      })
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected remote tarball fetch to fail.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("network");
  });

  test("does not automatically follow remote tarball redirects", async () => {
    const fetchedUrls: string[] = [];
    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "redirect-remote@1.0.0",
            name: "redirect-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/redirect-remote/-/redirect-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "redirect-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async (url, options) => {
        fetchedUrls.push(`${url} ${options?.redirect ?? "none"}`);
        return {
          ok: false,
          status: 302,
          statusText: "Found",
          headers: {
            get: (name) => name.toLowerCase() === "location"
              ? "http://127.0.0.1:4873/redirect-remote/-/redirect-remote-1.0.0.tgz"
              : null
          },
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    expect(fetchedUrls).toEqual([
      "https://registry.example.test/redirect-remote/-/redirect-remote-1.0.0.tgz manual"
    ]);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected redirecting remote tarball fetch to fail.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("network");
    expect(evidence.error.details).toMatchObject({
      packageId: "redirect-remote@1.0.0",
      resolved: "https://registry.example.test/redirect-remote/-/redirect-remote-1.0.0.tgz",
      status: 302,
      statusText: "Found"
    });
  });

  test("rejects remote tarball URLs that target local or private hosts before fetch", async () => {
    const blockedUrls = [
      {
        resolved: "http://localhost:4873/local-remote/-/local-remote-1.0.0.tgz",
        artifactHost: "localhost",
        reason: "localhost"
      },
      {
        resolved: "http://127.0.0.1:4873/local-remote/-/local-remote-1.0.0.tgz",
        artifactHost: "127.0.0.1",
        reason: "loopback_ipv4"
      },
      {
        resolved: "http://10.0.0.5/private-remote/-/private-remote-1.0.0.tgz",
        artifactHost: "10.0.0.5",
        reason: "private_ipv4"
      },
      {
        resolved: "http://[::1]/local-remote/-/local-remote-1.0.0.tgz",
        artifactHost: "::1",
        reason: "loopback_ipv6"
      },
      {
        resolved: "http://[::ffff:127.0.0.1]/mapped-local-remote/-/mapped-local-remote-1.0.0.tgz",
        artifactHost: "::ffff:7f00:1",
        reason: "loopback_ipv4"
      },
      {
        resolved: "http://[::ffff:0a00:0005]/mapped-private-remote/-/mapped-private-remote-1.0.0.tgz",
        artifactHost: "::ffff:a00:5",
        reason: "private_ipv4"
      }
    ];

    for (const { resolved, artifactHost, reason } of blockedUrls) {
      let fetchCalled = false;

      const evidence = await collectGraphEvidence({
        graph: {
          lockfilePath: "bun.lock",
          nodes: [
            {
              id: "blocked-remote@1.0.0",
              name: "blocked-remote",
              version: "1.0.0",
              ecosystem: "npm",
              resolved,
              dependencyType: "production",
              direct: true,
              paths: [["root", "blocked-remote@1.0.0"]]
            }
          ]
        },
        projectRoot: bunProjectDir,
        fetchArtifact: async () => {
          fetchCalled = true;
          return okArtifactResponseFromBuffer(Uint8Array.of(1, 2, 3));
        }
      });

      expect(fetchCalled).toBe(false);
      expect(evidence.ok).toBe(false);
      if (evidence.ok) {
        throw new Error("Expected blocked remote tarball URL to fail.");
      }

      expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
      expect(evidence.error.category).toBe("unsupported_input");
      expect(evidence.error.message).toBe(
        "Package tarball URL targets an unsupported or blocked host."
      );
      expect(evidence.error.details).toMatchObject({
        packageId: "blocked-remote@1.0.0",
        resolved,
        artifactHost,
        reason
      });
    }
  });

  test("rejects remote tarball hostnames that resolve to private hosts before fetch", async () => {
    let fetchCalled = false;
    const resolvedHosts: string[] = [];

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "dns-private-remote@1.0.0",
            name: "dns-private-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://tarballs.example.test/dns-private-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "dns-private-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      resolveArtifactHost: async (hostname) => {
        resolvedHosts.push(hostname);
        return [{ address: "10.0.0.5", family: 4 }];
      },
      fetchArtifact: async () => {
        fetchCalled = true;
        return okArtifactResponseFromBuffer(Uint8Array.of(1, 2, 3));
      }
    });

    expect(resolvedHosts).toEqual(["tarballs.example.test"]);
    expect(fetchCalled).toBe(false);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected DNS-private remote tarball host to fail.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe(
      "Package tarball URL targets an unsupported or blocked host."
    );
    expect(evidence.error.details).toMatchObject({
      packageId: "dns-private-remote@1.0.0",
      resolved: "https://tarballs.example.test/dns-private-remote-1.0.0.tgz",
      artifactHost: "tarballs.example.test",
      resolvedAddress: "10.0.0.5",
      reason: "private_ipv4"
    });
  });

  test("reports DNS resolution failures before remote tarball fetch", async () => {
    let fetchCalled = false;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "dns-failure-remote@1.0.0",
            name: "dns-failure-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://tarballs.example.test/dns-failure-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "dns-failure-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      resolveArtifactHost: async () => {
        throw new Error("DNS unavailable");
      },
      fetchArtifact: async () => {
        fetchCalled = true;
        return okArtifactResponseFromBuffer(Uint8Array.of(1, 2, 3));
      }
    });

    expect(fetchCalled).toBe(false);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected DNS resolution failure to fail before fetch.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("network");
    expect(evidence.error.message).toBe("Failed to resolve package tarball host.");
    expect(evidence.error.details).toMatchObject({
      packageId: "dns-failure-remote@1.0.0",
      resolved: "https://tarballs.example.test/dns-failure-remote-1.0.0.tgz",
      artifactHost: "tarballs.example.test",
      cause: "DNS unavailable"
    });
  });

  test("rejects registry metadata responses without readable body streams", async () => {
    let arrayBufferRead = false;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "bodyless-metadata@1.0.0",
            name: "bodyless-metadata",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "bodyless-metadata@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => {
          arrayBufferRead = true;
          return Buffer.from(JSON.stringify({ versions: {} })).buffer;
        }
      })
    });

    expect(arrayBufferRead).toBe(false);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected bodyless registry metadata to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe(
      "npm registry metadata response did not expose a readable body stream."
    );
    expect(evidence.error.details).toMatchObject({
      packageId: "bodyless-metadata@1.0.0",
      registryUrl: "https://registry.npmjs.org/bodyless-metadata"
    });
  });

  test("rejects remote tarball responses without readable body streams", async () => {
    let arrayBufferRead = false;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "bodyless-remote@1.0.0",
            name: "bodyless-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/bodyless-remote/-/bodyless-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "bodyless-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchArtifact: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => {
          arrayBufferRead = true;
          return Uint8Array.of(1, 2, 3).buffer;
        }
      })
    });

    expect(arrayBufferRead).toBe(false);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected bodyless remote tarball to fail.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe(
      "Package tarball response did not expose a readable body stream."
    );
    expect(evidence.error.details).toMatchObject({
      packageId: "bodyless-remote@1.0.0",
      resolved: "https://registry.example.test/bodyless-remote/-/bodyless-remote-1.0.0.tgz"
    });
  });

  test("times out stalled remote tarball fetches", async () => {
    let fetchSignal: AbortSignal | undefined;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "stalled-remote@1.0.0",
            name: "stalled-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/stalled-remote/-/stalled-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "stalled-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchTimeoutMs: 1,
      fetchArtifact: async (_url, options) => {
        fetchSignal = options?.signal;
        return await new Promise<never>(() => {});
      }
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected stalled remote tarball fetch to fail.");
    }

    expect(fetchSignal?.aborted).toBe(true);
    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("network");
    expect(evidence.error.details).toMatchObject({
      packageId: "stalled-remote@1.0.0",
      resolved: "https://registry.example.test/stalled-remote/-/stalled-remote-1.0.0.tgz",
      cause: "Artifact fetch timed out after 1ms."
    });
  });

  test("times out stalled remote tarball body reads", async () => {
    let fetchSignal: AbortSignal | undefined;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "stalled-body@1.0.0",
            name: "stalled-body",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/stalled-body/-/stalled-body-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "stalled-body@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      fetchTimeoutMs: 1,
      fetchArtifact: async (_url, options) => {
        fetchSignal = options?.signal;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          body: new ReadableStream<Uint8Array>({
            pull: async () => await new Promise<never>(() => {})
          }),
          arrayBuffer: async () => {
            throw new Error("Streamed responses should not fall back to arrayBuffer().");
          }
        };
      }
    });

    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected stalled remote tarball body read to fail.");
    }

    expect(fetchSignal?.aborted).toBe(true);
    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("network");
    expect(evidence.error.details).toMatchObject({
      packageId: "stalled-body@1.0.0",
      resolved: "https://registry.example.test/stalled-body/-/stalled-body-1.0.0.tgz",
      cause: "Artifact fetch timed out after 1ms."
    });
  });

  test("rejects oversized registry metadata before reading the response body", async () => {
    let bodyRead = false;

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "oversized-metadata@1.0.0",
            name: "oversized-metadata",
            version: "1.0.0",
            ecosystem: "npm",
            dependencyType: "production",
            direct: true,
            paths: [["root", "oversized-metadata@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      registryMetadataMaxBytes: 8,
      fetchArtifact: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: (name) => name.toLowerCase() === "content-length" ? "9" : null
        },
        arrayBuffer: async () => {
          bodyRead = true;
          return new ArrayBuffer(0);
        }
      })
    });

    expect(bodyRead).toBe(false);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected oversized registry metadata to fail.");
    }

    expect(evidence.error.code).toBe("REGISTRY_METADATA_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe(
      "npm registry metadata response exceeded the maximum supported size."
    );
    expect(evidence.error.details).toMatchObject({
      packageId: "oversized-metadata@1.0.0",
      registryUrl: "https://registry.npmjs.org/oversized-metadata",
      maxBytes: 8,
      observedBytes: 9,
      contentLength: 9
    });
  });

  test("rejects remote tarball streams that exceed the maximum response size", async () => {
    let cancelled = false;
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(
          pullCount === 1
            ? Uint8Array.of(1, 2, 3, 4, 5)
            : Uint8Array.of(6, 7, 8, 9)
        );
      },
      cancel() {
        cancelled = true;
      }
    });

    const evidence = await collectGraphEvidence({
      graph: {
        lockfilePath: "bun.lock",
        nodes: [
          {
            id: "oversized-remote@1.0.0",
            name: "oversized-remote",
            version: "1.0.0",
            ecosystem: "npm",
            resolved: "https://registry.example.test/oversized-remote/-/oversized-remote-1.0.0.tgz",
            dependencyType: "production",
            direct: true,
            paths: [["root", "oversized-remote@1.0.0"]]
          }
        ]
      },
      projectRoot: bunProjectDir,
      tarballMaxBytes: 8,
      fetchArtifact: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        body,
        arrayBuffer: async () => {
          throw new Error("Streamed responses should not fall back to arrayBuffer().");
        }
      })
    });

    expect(cancelled).toBe(true);
    expect(evidence.ok).toBe(false);
    if (evidence.ok) {
      throw new Error("Expected oversized remote tarball stream to fail.");
    }

    expect(evidence.error.code).toBe("TARBALL_FETCH_FAILED");
    expect(evidence.error.category).toBe("unsupported_input");
    expect(evidence.error.message).toBe(
      "Package tarball response exceeded the maximum supported size."
    );
    expect(evidence.error.details).toMatchObject({
      packageId: "oversized-remote@1.0.0",
      resolved: "https://registry.example.test/oversized-remote/-/oversized-remote-1.0.0.tgz",
      maxBytes: 8,
      observedBytes: 9
    });
  });
});

function okArtifactResponseFromBuffer(input: Buffer | Uint8Array | string): {
  ok: true;
  status: 200;
  statusText: string;
  body: ReadableStream<Uint8Array>;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: readableStreamFromBuffer(input),
    arrayBuffer: async () => {
      throw new Error("Streamed test responses should not fall back to arrayBuffer().");
    }
  };
}

function readableStreamFromBuffer(input: Buffer | Uint8Array | string): ReadableStream<Uint8Array> {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      controller.close();
    }
  });
}

function createTarGz(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const header = createTarHeader(filePath, data.length);

    chunks.push(header, data, Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length));
  }

  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function createTruncatedTarGz(input: {
  filePath: string;
  content: string;
  declaredSize: number;
}): Buffer {
  const data = Buffer.from(input.content, "utf8");
  return gzipSync(Buffer.concat([
    createTarHeader(input.filePath, input.declaredSize),
    data
  ]));
}

function createInvalidChecksumTarGz(input: {
  filePath: string;
  content: string;
}): Buffer {
  const data = Buffer.from(input.content, "utf8");
  const header = createTarHeader(input.filePath, data.length);

  header.write("000000\0 ", 148, 8, "ascii");

  return gzipSync(Buffer.concat([
    header,
    data,
    Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length),
    Buffer.alloc(1024)
  ]));
}

function createTarHeader(filePath: string, size: number): Buffer {
  const header = Buffer.alloc(512);

  header.write(filePath, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  return header;
}

function integrityFor(value: Buffer): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function createInstalledPackageProject(input: {
  name: string;
  installName?: string;
  version: string;
  license: string;
  licenseText: string;
}): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "ohrisk-installed-package-"));
  const packageDir = path.join(projectRoot, "node_modules", ...(input.installName ?? input.name).split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: input.name,
      version: input.version,
      license: input.license
    }),
    "utf8"
  );
  writeFileSync(path.join(packageDir, "LICENSE"), input.licenseText, "utf8");
  return projectRoot;
}
