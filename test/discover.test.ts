import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { discoverProject } from "../src/project/discover";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("discoverProject", () => {
  test("finds a bun.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "bun-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "bun-project"));
    expect(result.value.lockfile.kind).toBe("bun");
    expect(path.basename(result.value.lockfile.path)).toBe("bun.lock");
  });

  test("finds a package-lock.json project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "package-lock-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "package-lock-project"));
    expect(result.value.lockfile.kind).toBe("package-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("package-lock.json");
  });

  test("finds an npm-shrinkwrap.json project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-npm-shrinkwrap-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "package.json"),
        JSON.stringify({ name: "fixture-npm-shrinkwrap-project" }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "npm-shrinkwrap.json"),
        JSON.stringify({
          name: "fixture-npm-shrinkwrap-project",
          lockfileVersion: 3,
          packages: {
            "": {
              name: "fixture-npm-shrinkwrap-project"
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("npm-shrinkwrap");
      expect(path.basename(result.value.lockfile.path)).toBe("npm-shrinkwrap.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a pnpm-lock.yaml project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "pnpm-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "pnpm-project"));
    expect(result.value.lockfile.kind).toBe("pnpm-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("pnpm-lock.yaml");
  });

  test("finds a Yarn yarn.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "yarn-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "yarn-project"));
    expect(result.value.lockfile.kind).toBe("yarn-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("yarn.lock");
  });

  test("finds a Deno deno.lock project", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "deno-project") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "deno-project"));
    expect(result.value.lockfile.kind).toBe("deno-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("deno.lock");
  });

  test("finds a Rust Cargo.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cargo-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Cargo.toml"),
        [
          "[package]",
          "name = \"fixture-rust\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Cargo.lock"),
        [
          "[[package]]",
          "name = \"risk-crate\"",
          "version = \"1.0.0\""
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cargo-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("Cargo.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Go go.mod project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-go-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "go.mod"),
        [
          "module example.com/fixture-go",
          "",
          "go 1.22",
          "",
          "require github.com/acme/risk v1.0.0"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("go-mod");
      expect(path.basename(result.value.lockfile.path)).toBe("go.mod");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Python uv.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-uv-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-python\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(projectDir, "uv.lock"), "version = 1\n", "utf8");

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("uv-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("uv.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Python Pipfile.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-pipfile-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Pipfile"),
        [
          "[packages]",
          "requests = \"*\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Pipfile.lock"),
        JSON.stringify({
          default: {
            requests: {
              version: "==2.32.3"
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("pipfile-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("Pipfile.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Python PDM pdm.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-pdm-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pdm\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "pdm.lock"),
        [
          "[[package]]",
          "name = \"risk-pkg\"",
          "version = \"1.0.0\"",
          "groups = [\"default\"]"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("pdm-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("pdm.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Python poetry.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-poetry-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[tool.poetry]",
          "name = \"fixture-poetry\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "poetry.lock"),
        [
          "[[package]]",
          "name = \"risk-pkg\"",
          "version = \"1.0.0\""
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("poetry-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("poetry.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Python requirements.txt project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-requirements-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-python\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(path.join(projectDir, "requirements.txt"), "risk-pkg==1.0.0\n", "utf8");

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("requirements-txt");
      expect(path.basename(result.value.lockfile.path)).toBe("requirements.txt");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Java Gradle dependency lockfile project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-discovery-"));

    try {
      writeFileSync(path.join(projectDir, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle.lockfile"),
        "org.example:demo:1.2.3=runtimeClasspath\n",
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("gradle-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("gradle.lockfile");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Java Maven pom.xml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-maven-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pom.xml"),
        [
          "<project>",
          "  <artifactId>fixture-maven</artifactId>",
          "  <dependencies>",
          "    <dependency>",
          "      <groupId>com.acme</groupId>",
          "      <artifactId>risk</artifactId>",
          "      <version>1.0.0</version>",
          "    </dependency>",
          "  </dependencies>",
          "</project>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("maven-pom");
      expect(path.basename(result.value.lockfile.path)).toBe("pom.xml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a .NET NuGet packages.lock.json project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "packages.lock.json"),
        JSON.stringify({
          version: 1,
          dependencies: {
            net8: {
              "Risk.Package": {
                type: "Direct",
                resolved: "1.0.0"
              }
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("nuget-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("packages.lock.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Ruby Bundler Gemfile.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gemfile-discovery-"));

    try {
      writeFileSync(path.join(projectDir, "Gemfile"), "source \"https://rubygems.org\"\n", "utf8");
      writeFileSync(
        path.join(projectDir, "Gemfile.lock"),
        [
          "GEM",
          "  specs:",
          "    risk-gem (1.0.0)",
          "",
          "DEPENDENCIES",
          "  risk-gem"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("gemfile-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("Gemfile.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a PHP Composer composer.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-composer-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "composer.json"),
        JSON.stringify({
          name: "acme/app",
          require: {
            "acme/risk": "^1.0"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "composer.lock"),
        JSON.stringify({
          packages: [
            {
              name: "acme/risk",
              version: "1.0.0"
            }
          ]
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("composer-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("composer.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a CycloneDX JSON SBOM project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "cyclonedx.json"),
        JSON.stringify({
          bomFormat: "CycloneDX",
          components: []
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cyclonedx-json");
      expect(path.basename(result.value.lockfile.path)).toBe("cyclonedx.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an SPDX JSON SBOM project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "spdx.json"),
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          packages: []
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-json");
      expect(path.basename(result.value.lockfile.path)).toBe("spdx.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("walks up from a nested directory", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "bun-project", "packages", "app") });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "bun-project"));
  });

  test("rejects projects without a supported lockfile", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "no-lockfile") });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
  });

  test("rejects projects with multiple lockfiles", () => {
    const result = discoverProject({ cwd: path.join(fixturesDir, "multiple-lockfiles") });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("MULTIPLE_LOCKFILES");
  });

  test("uses an explicit lockfile path when a project has multiple lockfiles", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "package-lock.json"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.rootDir).toBe(path.join(fixturesDir, "multiple-lockfiles"));
    expect(result.value.lockfile.kind).toBe("package-lock");
    expect(path.basename(result.value.lockfile.path)).toBe("package-lock.json");
  });

  test("rejects unsupported explicit lockfile paths", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "environment.yml"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("UNSUPPORTED_LOCKFILE");
  });

  test("rejects missing explicit lockfile paths", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "pnpm-lock.yaml"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("LOCKFILE_NOT_FOUND");
  });

  test("rejects explicit lockfile paths that are directories", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-lockfile-directory-"));
    mkdirSync(path.join(projectDir, "package-lock.json"));

    const result = discoverProject({
      cwd: projectDir,
      lockfilePath: "package-lock.json"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("LOCKFILE_NOT_FILE");
    expect(result.error.details).toMatchObject({
      lockfilePath: path.join(projectDir, "package-lock.json")
    });
  });

  test("ignores known lockfile names that are directories during project discovery", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-lockfile-directory-discovery-"));
    writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "directory-lockfile" }));
    mkdirSync(path.join(projectDir, "bun.lock"));

    const result = discoverProject({ cwd: projectDir });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected discovery to fail.");
    }

    expect(result.error.code).toBe("NO_SUPPORTED_LOCKFILE");
    expect(result.error.details).toMatchObject({
      rootDir: projectDir
    });
  });
});
