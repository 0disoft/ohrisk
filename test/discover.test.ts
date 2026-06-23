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

  test("finds a Go go.work project and treats sibling go.mod as a workspace companion", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-go-work-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "go.work"),
        [
          "go 1.22",
          "",
          "use ./app"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "go.mod"),
        [
          "module example.com/root",
          "",
          "go 1.22"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("go-work");
      expect(path.basename(result.value.lockfile.path)).toBe("go.work");
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

  test("finds a Python pylock.toml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-pylock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-pylock\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "pylock.toml"),
        [
          "lock-version = '1.0'",
          "created-by = 'fixture-locker'",
          "",
          "[[packages]]",
          "name = 'risk-pkg'",
          "version = '1.0.0'"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("pylock");
      expect(path.basename(result.value.lockfile.path)).toBe("pylock.toml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a named Python pylock.<name>.toml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-named-pylock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pyproject.toml"),
        [
          "[project]",
          "name = \"fixture-named-pylock\"",
          "version = \"0.1.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "pylock.deploy.toml"),
        [
          "lock-version = '1.0'",
          "created-by = 'fixture-locker'",
          "",
          "[[packages]]",
          "name = 'risk-pkg'",
          "version = '1.0.0'"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("pylock");
      expect(path.basename(result.value.lockfile.path)).toBe("pylock.deploy.toml");
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

  test("finds a Java Gradle legacy dependency-locks lockfile project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-legacy-lock-discovery-"));

    try {
      mkdirSync(path.join(projectDir, "gradle", "dependency-locks"), { recursive: true });
      writeFileSync(path.join(projectDir, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "runtimeClasspath.lockfile"),
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
      expect(path.relative(projectDir, result.value.lockfile.path)).toBe(
        path.join("gradle", "dependency-locks")
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Java Gradle version catalog project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-catalog-discovery-"));

    try {
      mkdirSync(path.join(projectDir, "gradle"), { recursive: true });
      writeFileSync(path.join(projectDir, "build.gradle.kts"), "plugins { java }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle", "libs.versions.toml"),
        [
          "[libraries]",
          "demo = \"org.example:demo:1.2.3\""
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("gradle-version-catalog");
      expect(path.relative(projectDir, result.value.lockfile.path)).toBe(path.join("gradle", "libs.versions.toml"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Bazel MODULE.bazel project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-bazel-module-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "MODULE.bazel"),
        [
          "module(name = \"fixture_bazel\", version = \"0.1.0\")",
          "bazel_dep(name = \"rules_cc\", version = \"0.0.9\")"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("bazel-module");
      expect(path.basename(result.value.lockfile.path)).toBe("MODULE.bazel");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Haskell Stack stack.yaml.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-stack-lock-discovery-"));

    try {
      writeFileSync(path.join(projectDir, "stack.yaml"), "resolver: lts-22.0\n", "utf8");
      writeFileSync(
        path.join(projectDir, "stack.yaml.lock"),
        [
          "packages:",
          "- completed:",
          "    hackage: risk-haskell-1.2.3@sha256:abc,1234",
          "  original:",
          "    hackage: risk-haskell-1.2.3"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("stack-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("stack.yaml.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Perl Carton cpanfile.snapshot project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cpanfile-snapshot-discovery-"));

    try {
      writeFileSync(path.join(projectDir, "cpanfile"), "requires 'App::Risk';\n", "utf8");
      writeFileSync(
        path.join(projectDir, "cpanfile.snapshot"),
        [
          "# carton snapshot format: version 1.0",
          "DISTRIBUTIONS",
          "  App-Risk-1.0",
          "    pathname: A/AC/ACME/App-Risk-1.0.tar.gz",
          "    provides:",
          "      App::Risk 1.0",
          "    requirements:",
          "      perl 5.010000"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cpanfile-snapshot");
      expect(path.basename(result.value.lockfile.path)).toBe("cpanfile.snapshot");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("prefers a Java Gradle dependency lockfile over companion Gradle inputs", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-catalog-lock-discovery-"));

    try {
      mkdirSync(path.join(projectDir, "gradle", "dependency-locks"), { recursive: true });
      writeFileSync(path.join(projectDir, "build.gradle.kts"), "plugins { java }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle.lockfile"),
        "org.example:demo:1.2.3=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "runtimeClasspath.lockfile"),
        "org.example:legacy-demo:1.2.3=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "gradle", "libs.versions.toml"),
        [
          "[libraries]",
          "demo = \"org.example:demo:1.2.3\""
        ].join("\n"),
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

  test("finds a restored .NET NuGet obj/project.assets.json project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-assets-discovery-"));

    try {
      mkdirSync(path.join(projectDir, "obj"), { recursive: true });
      writeFileSync(
        path.join(projectDir, "obj", "project.assets.json"),
        JSON.stringify({
          version: 3,
          targets: {
            net8: {
              "Risk.Package/1.0.0": {
                type: "package"
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
      expect(result.value.lockfile.kind).toBe("nuget-assets");
      expect(result.value.lockfile.path).toBe(path.join(projectDir, "obj", "project.assets.json"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("treats explicit obj/project.assets.json paths as the parent .NET project root", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-nuget-assets-explicit-"));

    try {
      mkdirSync(path.join(projectDir, "obj"), { recursive: true });
      writeFileSync(
        path.join(projectDir, "obj", "project.assets.json"),
        JSON.stringify({
          version: 3,
          targets: {
            net8: {
              "Risk.Package/1.0.0": {
                type: "package"
              }
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: path.join("obj", "project.assets.json")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("nuget-assets");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a .NET csproj project with PackageReference entries", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-csproj-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Fixture.App.csproj"),
        [
          "<Project Sdk=\"Microsoft.NET.Sdk\">",
          "  <ItemGroup>",
          "    <PackageReference Include=\"Risk.Package\" Version=\"1.0.0\" />",
          "  </ItemGroup>",
          "</Project>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("dotnet-project");
      expect(path.basename(result.value.lockfile.path)).toBe("Fixture.App.csproj");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a .NET NuGet packages.config project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-packages-config-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "packages.config"),
        [
          "<packages>",
          "  <package id=\"Risk.Package\" version=\"1.0.0\" />",
          "</packages>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("nuget-packages-config");
      expect(path.basename(result.value.lockfile.path)).toBe("packages.config");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Conan conan.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-conan-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "conanfile.py"),
        [
          "from conan import ConanFile",
          "",
          "class FixtureConan(ConanFile):",
          "    requires = \"risklib/1.0.0\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "conan.lock"),
        JSON.stringify({
          version: "0.5",
          requires: ["risklib/1.0.0"]
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("conan-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("conan.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Conda environment.yml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-environment-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "environment.yml"),
        [
          "name: fixture-conda-env",
          "channels:",
          "  - conda-forge",
          "dependencies:",
          "  - risk-conda=1.0.0"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("conda-environment");
      expect(path.basename(result.value.lockfile.path)).toBe("environment.yml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Conda environment.yaml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-environment-yaml-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "environment.yaml"),
        [
          "name: fixture-conda-env",
          "dependencies:",
          "  - risk-conda=1.0.0"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("conda-environment");
      expect(path.basename(result.value.lockfile.path)).toBe("environment.yaml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Conda conda-lock.yml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "environment.yml"),
        [
          "channels:",
          "  - conda-forge",
          "dependencies:",
          "  - python=3.12",
          "  - risk-conda=1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "conda-lock.yml"),
        [
          "version: 1",
          "package:",
          "  - name: risk-conda",
          "    version: '1.0.0'",
          "    manager: conda",
          "    platform: linux-64"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("conda-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("conda-lock.yml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Conda conda-lock.yaml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-conda-lock-yaml-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "environment.yaml"),
        [
          "channels:",
          "  - conda-forge",
          "dependencies:",
          "  - python=3.12"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "conda-lock.yaml"),
        [
          "version: 1",
          "package:",
          "  - name: risk-conda",
          "    version: '1.0.0'",
          "    manager: conda",
          "    platform: linux-64"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("conda-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("conda-lock.yaml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a vcpkg.json manifest project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-vcpkg-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "vcpkg.json"),
        JSON.stringify({
          dependencies: ["zlib"],
          overrides: [
            {
              name: "zlib",
              version: "1.3.1"
            }
          ]
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("vcpkg-json");
      expect(path.basename(result.value.lockfile.path)).toBe("vcpkg.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Terraform .terraform.lock.hcl project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-terraform-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "main.tf"),
        [
          "terraform {",
          "  required_providers {",
          "    aws = { source = \"hashicorp/aws\" }",
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, ".terraform.lock.hcl"),
        [
          'provider "registry.terraform.io/hashicorp/aws" {',
          '  version = "5.31.0"',
          "}"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("terraform-lock");
      expect(path.basename(result.value.lockfile.path)).toBe(".terraform.lock.hcl");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Helm Chart.lock project and treats Chart.yaml as its companion manifest", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-helm-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Chart.yaml"),
        [
          "apiVersion: v2",
          "name: fixture-chart",
          "version: 0.1.0",
          "dependencies:",
          "  - name: postgresql",
          "    repository: https://charts.bitnami.com/bitnami",
          "    version: 15.5.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Chart.lock"),
        [
          "dependencies:",
          "  - name: postgresql",
          "    repository: https://charts.bitnami.com/bitnami",
          "    version: 15.5.0"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("helm-chart-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("Chart.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Helm Chart.yaml project when no Chart.lock exists", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-helm-yaml-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Chart.yaml"),
        [
          "apiVersion: v2",
          "name: fixture-chart",
          "version: 0.1.0",
          "dependencies:",
          "  - name: postgresql",
          "    repository: https://charts.bitnami.com/bitnami",
          "    version: 15.5.0"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("helm-chart-yaml");
      expect(path.basename(result.value.lockfile.path)).toBe("Chart.yaml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Nix flake.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-nix-flake-discovery-"));

    try {
      writeFileSync(path.join(projectDir, "flake.nix"), "{ inputs.nixpkgs.url = \"github:NixOS/nixpkgs\"; }", "utf8");
      writeFileSync(
        path.join(projectDir, "flake.lock"),
        JSON.stringify({
          root: "root",
          nodes: {
            root: {
              inputs: {
                nixpkgs: "nixpkgs"
              }
            },
            nixpkgs: {
              locked: {
                type: "github",
                owner: "NixOS",
                repo: "nixpkgs",
                rev: "0123456789abcdef"
              }
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("nix-flake-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("flake.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Unity Packages/packages-lock.json project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-unity-packages-lock-discovery-"));

    try {
      mkdirSync(path.join(projectDir, "Packages"), { recursive: true });
      writeFileSync(
        path.join(projectDir, "Packages", "manifest.json"),
        JSON.stringify({
          dependencies: {
            "com.acme.risk": "1.2.3"
          }
        }),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Packages", "packages-lock.json"),
        JSON.stringify({
          dependencies: {
            "com.acme.risk": {
              version: "1.2.3",
              depth: 0,
              source: "registry",
              dependencies: {}
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: path.join(projectDir, "Packages") });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("unity-packages-lock");
      expect(result.value.lockfile.path).toBe(path.join(projectDir, "Packages", "packages-lock.json"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("treats explicit Unity Packages/packages-lock.json paths as the parent Unity project root", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-unity-packages-lock-explicit-"));

    try {
      mkdirSync(path.join(projectDir, "Packages"), { recursive: true });
      writeFileSync(
        path.join(projectDir, "Packages", "packages-lock.json"),
        JSON.stringify({
          dependencies: {
            "com.acme.risk": {
              version: "1.2.3",
              depth: 0,
              source: "registry",
              dependencies: {}
            }
          }
        }),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: path.join("Packages", "packages-lock.json")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("unity-packages-lock");
      expect(result.value.lockfile.path).toBe(path.join(projectDir, "Packages", "packages-lock.json"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an R renv.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-renv-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "renv.lock"),
        JSON.stringify({
          Packages: {
            RiskR: {
              Package: "RiskR",
              Version: "1.2.3"
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
      expect(result.value.lockfile.kind).toBe("renv-lock");
      expect(result.value.lockfile.path).toBe(path.join(projectDir, "renv.lock"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Julia Manifest.toml project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-julia-manifest-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Project.toml"),
        [
          "name = \"Analysis\"",
          "uuid = \"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\""
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Manifest.toml"),
        [
          "[[deps.RiskJulia]]",
          "uuid = \"11111111-1111-1111-1111-111111111111\"",
          "version = \"1.2.3\""
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("julia-manifest");
      expect(result.value.lockfile.path).toBe(path.join(projectDir, "Manifest.toml"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a LuaRocks luarocks.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-luarocks-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "luarocks.lock"),
        [
          "return {",
          "  dependencies = {",
          '    ["lua-cjson"] = "2.1.0-1"',
          "  }",
          "}"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile).toEqual({
        kind: "luarocks-lock",
        path: path.join(projectDir, "luarocks.lock")
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Dart pubspec.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-pubspec-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "pubspec.yaml"),
        [
          "name: fixture_dart",
          "dependencies:",
          "  risk_package: ^1.0.0"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "pubspec.lock"),
        [
          "packages:",
          "  risk_package:",
          "    dependency: \"direct main\"",
          "    source: hosted",
          "    version: \"1.0.0\""
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("pubspec-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("pubspec.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Swift Package.resolved project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-swift-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Package.swift"),
        [
          "// swift-tools-version: 5.10",
          "import PackageDescription",
          "let package = Package(name: \"FixtureSwift\")"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Package.resolved"),
        JSON.stringify({
          pins: [
            {
              identity: "risk-swift",
              kind: "remoteSourceControl",
              location: "https://github.com/acme/risk-swift.git",
              state: {
                revision: "0123456789abcdef",
                version: "1.0.0"
              }
            }
          ],
          version: 2
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("swift-package-resolved");
      expect(path.basename(result.value.lockfile.path)).toBe("Package.resolved");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an Xcode nested Swift Package.resolved project root", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-xcode-swift-discovery-"));
    const lockfileDir = path.join(
      projectDir,
      "FixtureApp.xcodeproj",
      "project.xcworkspace",
      "xcshareddata",
      "swiftpm"
    );

    try {
      mkdirSync(lockfileDir, { recursive: true });
      writeFileSync(
        path.join(lockfileDir, "Package.resolved"),
        JSON.stringify({
          pins: [
            {
              identity: "risk-swift",
              state: {
                revision: "0123456789abcdef",
                version: "1.0.0"
              }
            }
          ],
          version: 2
        }),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("swift-package-resolved");
      expect(result.value.lockfile.path).toBe(path.join(lockfileDir, "Package.resolved"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a Carthage Cartfile.resolved project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-carthage-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Cartfile"),
        'github "Acme/RiskKit" ~> 1.2',
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Cartfile.resolved"),
        'github "Acme/RiskKit" "1.2.3"',
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cartfile-resolved");
      expect(path.basename(result.value.lockfile.path)).toBe("Cartfile.resolved");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds a CocoaPods Podfile.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-podfile-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "Podfile"),
        [
          "platform :ios, '17.0'",
          "target 'FixtureApp' do",
          "  pod 'RiskPod', '~> 1.0'",
          "end"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "Podfile.lock"),
        [
          "PODS:",
          "  - RiskPod (1.0.0)",
          "",
          "DEPENDENCIES:",
          "  - RiskPod (~> 1.0)"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("podfile-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("Podfile.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an Elixir Mix mix.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-mix-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "mix.exs"),
        [
          "defmodule Fixture.MixProject do",
          "  use Mix.Project",
          "  def project, do: [app: :fixture, deps: deps()]",
          "  defp deps, do: [{:risk_hex, \"~> 1.0\"}]",
          "end"
        ].join("\n"),
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "mix.lock"),
        '%{"risk_hex": {:hex, :risk_hex, "1.0.0", "checksum", [:mix], [], "hexpm", "checksum"}}',
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("mix-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("mix.lock");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an Erlang Rebar3 rebar.lock project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-rebar-lock-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "rebar.config"),
        "{deps, [risk_hex]}.\n",
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "rebar.lock"),
        '{"1.2.3",[{<<"risk_hex">>,{pkg,<<"risk_hex">>,<<"1.0.0">>},0}]}.\n',
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("rebar-lock");
      expect(path.basename(result.value.lockfile.path)).toBe("rebar.lock");
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

  test("finds a CycloneDX XML SBOM project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-cyclonedx-xml-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "cyclonedx.xml"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<bom xmlns=\"http://cyclonedx.org/schema/bom/1.5\" version=\"1\">",
          "  <components />",
          "</bom>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cyclonedx-xml");
      expect(path.basename(result.value.lockfile.path)).toBe("cyclonedx.xml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("accepts explicit CycloneDX .cdx.json paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-cyclonedx-json-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.cdx.json"),
        JSON.stringify({
          bomFormat: "CycloneDX",
          components: []
        }),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.cdx.json"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cyclonedx-json");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.cdx.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("accepts explicit CycloneDX .cdx.xml paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-cyclonedx-xml-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.cdx.xml"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<bom xmlns=\"http://cyclonedx.org/schema/bom/1.5\" version=\"1\">",
          "  <components />",
          "</bom>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.cdx.xml"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("cyclonedx-xml");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.cdx.xml");
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

  test("accepts explicit SPDX JSON .spdx.json paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-spdx-json-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.spdx.json"),
        JSON.stringify({
          spdxVersion: "SPDX-2.3",
          packages: []
        }),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.spdx.json"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-json");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.spdx.json");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an SPDX RDF SBOM project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-rdf-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "spdx.rdf"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:spdx=\"http://spdx.org/rdf/terms#\">",
          "  <spdx:SpdxDocument />",
          "</rdf:RDF>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-rdf");
      expect(path.basename(result.value.lockfile.path)).toBe("spdx.rdf");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("accepts explicit SPDX RDF .spdx.rdf.xml paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-spdx-rdf-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.spdx.rdf.xml"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:spdx=\"http://spdx.org/rdf/terms#\">",
          "  <spdx:SpdxDocument />",
          "</rdf:RDF>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.spdx.rdf.xml"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-rdf");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.spdx.rdf.xml");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("accepts explicit SPDX RDF .spdx.rdf paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-spdx-rdf-short-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.spdx.rdf"),
        [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:spdx=\"http://spdx.org/rdf/terms#\">",
          "  <spdx:SpdxDocument />",
          "</rdf:RDF>"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.spdx.rdf"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-rdf");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.spdx.rdf");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("finds an SPDX tag-value SBOM project", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-spdx-tag-value-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "sbom.spdx"),
        [
          "SPDXVersion: SPDX-2.3",
          "SPDXID: SPDXRef-DOCUMENT",
          "DocumentName: fixture-spdx-tag-value"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({ cwd: projectDir });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-tag-value");
      expect(path.basename(result.value.lockfile.path)).toBe("sbom.spdx");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("accepts explicit SPDX tag-value .spdx paths", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-spdx-tag-value-discovery-"));

    try {
      writeFileSync(
        path.join(projectDir, "licenses.spdx"),
        [
          "SPDXVersion: SPDX-2.3",
          "SPDXID: SPDXRef-DOCUMENT",
          "DocumentName: fixture-explicit-spdx-tag-value"
        ].join("\n"),
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: "licenses.spdx"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("spdx-tag-value");
      expect(path.basename(result.value.lockfile.path)).toBe("licenses.spdx");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("sniffs explicit SBOM paths without supported names or suffixes", () => {
    const cases = [
      {
        filename: "cyclonedx-report.input",
        kind: "cyclonedx-json",
        contents: JSON.stringify({
          bomFormat: "CycloneDX",
          components: []
        })
      },
      {
        filename: "spdx-report.input",
        kind: "spdx-json",
        contents: JSON.stringify({
          spdxVersion: "SPDX-2.3",
          packages: []
        })
      },
      {
        filename: "cyclonedx-report.data",
        kind: "cyclonedx-xml",
        contents: [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<bom xmlns=\"http://cyclonedx.org/schema/bom/1.5\" version=\"1\">",
          "  <components />",
          "</bom>"
        ].join("\n")
      },
      {
        filename: "spdx-rdf-report.data",
        kind: "spdx-rdf",
        contents: [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:spdx=\"http://spdx.org/rdf/terms#\">",
          "  <spdx:SpdxDocument />",
          "</rdf:RDF>"
        ].join("\n")
      },
      {
        filename: "spdx-tag-value-report.data",
        kind: "spdx-tag-value",
        contents: [
          "SPDXVersion: SPDX-2.3",
          "SPDXID: SPDXRef-DOCUMENT",
          "DocumentName: fixture-explicit-custom-spdx"
        ].join("\n")
      }
    ];

    for (const testCase of cases) {
      const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-explicit-sbom-sniffing-"));

      try {
        writeFileSync(path.join(projectDir, testCase.filename), testCase.contents, "utf8");

        const result = discoverProject({
          cwd: projectDir,
          lockfilePath: testCase.filename
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error(result.error.message);
        }

        expect(result.value.rootDir).toBe(projectDir);
        expect(result.value.lockfile.kind).toBe(testCase.kind);
        expect(path.basename(result.value.lockfile.path)).toBe(testCase.filename);
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
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

  test("uses an explicit Gradle dependency-locks lockfile path", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-explicit-legacy-lock-"));

    try {
      mkdirSync(path.join(projectDir, "gradle", "dependency-locks"), { recursive: true });
      writeFileSync(path.join(projectDir, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "runtimeClasspath.lockfile"),
        "org.example:runtime-demo:1.2.3=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "testRuntimeClasspath.lockfile"),
        "org.example:test-demo:4.5.6=testRuntimeClasspath\n",
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: path.join("gradle", "dependency-locks", "runtimeClasspath.lockfile")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("gradle-lock");
      expect(path.relative(projectDir, result.value.lockfile.path)).toBe(
        path.join("gradle", "dependency-locks", "runtimeClasspath.lockfile")
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("uses an explicit Gradle dependency-locks directory path", () => {
    const projectDir = mkdtempSync(path.join(tmpdir(), "ohrisk-gradle-explicit-legacy-lock-dir-"));

    try {
      mkdirSync(path.join(projectDir, "gradle", "dependency-locks"), { recursive: true });
      writeFileSync(path.join(projectDir, "build.gradle"), "plugins { id 'java' }\n", "utf8");
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "runtimeClasspath.lockfile"),
        "org.example:runtime-demo:1.2.3=runtimeClasspath\n",
        "utf8"
      );
      writeFileSync(
        path.join(projectDir, "gradle", "dependency-locks", "testRuntimeClasspath.lockfile"),
        "org.example:test-demo:4.5.6=testRuntimeClasspath\n",
        "utf8"
      );

      const result = discoverProject({
        cwd: projectDir,
        lockfilePath: path.join("gradle", "dependency-locks")
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.rootDir).toBe(projectDir);
      expect(result.value.lockfile.kind).toBe("gradle-lock");
      expect(path.relative(projectDir, result.value.lockfile.path)).toBe(
        path.join("gradle", "dependency-locks")
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("rejects unsupported explicit lockfile paths", () => {
    const result = discoverProject({
      cwd: path.join(fixturesDir, "multiple-lockfiles"),
      lockfilePath: "README.md"
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
