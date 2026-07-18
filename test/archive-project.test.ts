import { describe, expect, test } from "bun:test";
import path from "node:path";

import { loadArchiveProject } from "../src/archive/archive-project";
import { readArchiveBytes } from "../src/archive/archive-reader";
import { PACKAGE_JSON_MAX_BYTES } from "../src/graph/read-input-file";
import { formatError, type OhriskError } from "../src/shared/errors";
import { createZip } from "./helpers/zip";

function load(files: Record<string, string>, allLockfiles = false) {
  const archive = readArchiveBytes({
    displayName: "fixture.zip",
    bytes: createZip(files)
  });
  expect(archive.ok).toBe(true);
  if (!archive.ok) throw new Error(archive.error.message);
  return loadArchiveProject({ source: archive.value, allLockfiles });
}

const packageLock = JSON.stringify({
  name: "archive-app",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": { name: "archive-app", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } },
    "node_modules/left-pad": { version: "1.3.0" }
  }
});

describe("archive project loading", () => {
  test("loads a supported project at the archive root", () => {
    const result = load({ "package-lock.json": packageLock });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.project.source).toMatchObject({
      kind: "archive",
      displayPath: "fixture.zip",
      format: "zip",
      entryRoot: "."
    });
    expect(result.value.graph.nodes.map((node) => node.name)).toEqual(["left-pad"]);
    expect(path.isAbsolute(result.value.project.rootDir)).toBe(true);
  });

  test("unwraps one directory around a project", () => {
    const result = load({
      "release/README.md": "fixture",
      "release/package-lock.json": packageLock
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.project.source?.entryRoot).toBe("release");
  });

  test("rejects independent project roots", () => {
    const result = load({
      "apps/one/package-lock.json": packageLock,
      "apps/two/package-lock.json": packageLock
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected multiple archive projects to fail.");
    expect(result.error.code).toBe("ARCHIVE_MULTIPLE_PROJECTS");
    expect(result.error.details?.entryPath).toBe("apps/one,apps/two");
  });

  test("rejects archives without supported projects", () => {
    const result = load({ "README.md": "nothing to scan" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected archive discovery to fail.");
    expect(result.error.code).toBe("ARCHIVE_NO_SUPPORTED_PROJECT");
  });

  test("loads a dependency-free package.json fallback", () => {
    const result = load({
      "package.json": JSON.stringify({ name: "archive-empty", version: "1.0.0" })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.project.lockfile.kind).toBe("package-json");
    expect(result.value.graph.nodes).toEqual([]);
  });

  test("preserves the multiple-lockfile opt-in", () => {
    const files = {
      "package-lock.json": packageLock,
      "Cargo.lock": [
        "version = 3",
        "",
        "[[package]]",
        "name = \"archive-app\"",
        "version = \"0.1.0\""
      ].join("\n")
    };
    const rejected = load(files);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected multiple lockfiles to fail.");
    expect(rejected.error.code).toBe("MULTIPLE_LOCKFILES");

    const accepted = load(files, true);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.error.message);
    expect(accepted.value.project.lockfiles?.map((item) => item.kind)).toEqual([
      "cargo-lock",
      "package-lock"
    ]);
  });

  test("passes package.json companion text to the Yarn parser", () => {
    const result = load({
      "package.json": JSON.stringify({
        name: "archive-yarn-app",
        dependencies: { "left-pad": "1.3.0" }
      }),
      "yarn.lock": [
        'left-pad@1.3.0:',
        '  version "1.3.0"'
      ].join("\n")
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.graph.rootName).toBe("archive-yarn-app");
    expect(result.value.graph.nodes.map((node) => node.name)).toEqual(["left-pad"]);
  });

  test("reads Maven aggregator modules through the archive virtual filesystem", () => {
    const result = load({
      "pom.xml": [
        "<project>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>archive-parent</artifactId>",
        "  <version>1.0.0</version>",
        "  <packaging>pom</packaging>",
        "  <modules><module>modules/core</module></modules>",
        "</project>"
      ].join("\n"),
      "modules/core/pom.xml": [
        "<project>",
        "  <parent>",
        "    <groupId>com.example</groupId>",
        "    <artifactId>archive-parent</artifactId>",
        "    <version>1.0.0</version>",
        "  </parent>",
        "  <artifactId>archive-core</artifactId>",
        "  <dependencies>",
        "    <dependency>",
        "      <groupId>org.example</groupId>",
        "      <artifactId>archive-library</artifactId>",
        "      <version>2.0.0</version>",
        "    </dependency>",
        "  </dependencies>",
        "</project>"
      ].join("\n")
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.graph.nodes).toEqual([
      expect.objectContaining({
        id: "org.example:archive-library@2.0.0",
        paths: [[
          "archive-parent",
          "archive-core",
          "org.example:archive-library@2.0.0"
        ]]
      })
    ]);
  });

  test("propagates a size failure from an existing companion manifest", () => {
    const result = load({
      "package.json": "x".repeat(PACKAGE_JSON_MAX_BYTES + 1),
      "yarn.lock": [
        'left-pad@1.3.0:',
        '  version "1.3.0"'
      ].join("\n")
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected oversized archive companion to fail.");
    expect(result.error.code).toBe("ARCHIVE_LIMIT_EXCEEDED");
  });

  test("indexes wide maximum-depth archives within a linear checkpoint budget", () => {
    const deepTail = Array.from({ length: 62 }, (_, index) => `d${index}`);
    const files: Record<string, string> = {};
    for (let index = 0; index < 1_024; index += 1) {
      files[[`noise-${index}`, ...deepTail, "note.txt"].join("/")] = "not a project";
    }
    files["release/package-lock.json"] = packageLock;
    let projectPhase = false;
    let ticks = 0;
    const archive = readArchiveBytes({
      displayName: "wide-deep.zip",
      bytes: createZip(files),
      limits: { entries: 1_100, workDeadlineMs: 4_000 },
      now: () => projectPhase ? ticks++ : 0
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) throw new Error(archive.error.message);

    projectPhase = true;
    const result = loadArchiveProject({ source: archive.value });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.project.source?.entryRoot).toBe("release");
    expect(ticks).toBeLessThanOrEqual(4_000);
  });

  test("uses the archive reader deadline during project discovery", () => {
    let projectPhase = false;
    let ticks = 0;
    const archive = readArchiveBytes({
      displayName: "deadline.zip",
      bytes: createZip({ "package-lock.json": packageLock }),
      limits: { workDeadlineMs: 1 },
      now: () => projectPhase ? ticks++ : 0
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) throw new Error(archive.error.message);

    projectPhase = true;
    const result = loadArchiveProject({ source: archive.value });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected archive project discovery to exceed its deadline.");
    expect(result.error.code).toBe("ARCHIVE_LIMIT_EXCEEDED");
    expect(result.error.details?.limit).toBe("workDeadlineMs");
  });

  test("sanitizes malformed parser paths at the archive boundary", () => {
    const archive = readArchiveBytes({
      displayName: "fixture.zip",
      bytes: createZip({ "release/package-lock.json": "{" })
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) throw new Error(archive.error.message);

    const result = loadArchiveProject({ source: archive.value });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed package-lock.json to fail.");
    expect(result.error.details?.lockfilePath).toBe(
      "fixture.zip!/release/package-lock.json"
    );
    expectSanitizedArchiveError(result.error, archive.value.sha256);
  });

  test("sanitizes nested requirements include errors at the archive boundary", () => {
    const archive = readArchiveBytes({
      displayName: "fixture.zip",
      bytes: createZip({
        "release/requirements.txt": "-r base.txt",
        "release/base.txt": "-r requirements.txt"
      })
    });
    expect(archive.ok).toBe(true);
    if (!archive.ok) throw new Error(archive.error.message);

    const result = loadArchiveProject({ source: archive.value });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a requirements include cycle to fail.");
    expect(result.error.code).toBe("REQUIREMENTS_PARSE_FAILED");
    expect(result.error.details?.lockfilePath).toBe(
      "fixture.zip!/release/requirements.txt"
    );
    expectSanitizedArchiveError(result.error, archive.value.sha256);
  });
});

function expectSanitizedArchiveError(error: OhriskError, sha256: string): void {
  const formatted = formatError(error);
  expect(formatted).toContain("fixture.zip!/release/");
  expect(formatted).not.toContain("__ohrisk_archive__");
  expect(formatted).not.toContain(sha256);
  expect(formatted).not.toMatch(/[A-Za-z]:[\\/]/);
}
