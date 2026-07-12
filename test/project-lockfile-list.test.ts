import { describe, expect, test } from "bun:test";
import path from "node:path";

import { projectLockfilesFromRelativePaths } from "../src/project/discover";

describe("projectLockfilesFromRelativePaths", () => {
  test("discovers supported root, nested, directory, dynamic, and Xcode inputs", () => {
    const rootDir = path.resolve("/tmp/ohrisk-listed-project");
    const lockfiles = projectLockfilesFromRelativePaths({
      rootDir,
      relativePaths: [
        "package-lock.json",
        "Cargo.lock",
        "gradle/dependency-locks/runtimeClasspath.lockfile",
        "gradle/dependency-locks/nested/ignored.lockfile",
        "App.csproj",
        "pylock.prod.toml",
        "obj/project.assets.json",
        "Packages/packages-lock.json",
        "Example.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
        "Workspace.xcworkspace/xcshareddata/swiftpm/Package.resolved",
        "nested/package-lock.json",
        "../outside/package-lock.json",
        "/absolute/Cargo.lock"
      ]
    });

    expect(lockfiles.map((lockfile) => ({
      kind: lockfile.kind,
      path: path.relative(rootDir, lockfile.path).replace(/\\/g, "/")
    }))).toEqual([
      { kind: "dotnet-project", path: "App.csproj" },
      { kind: "cargo-lock", path: "Cargo.lock" },
      {
        kind: "swift-package-resolved",
        path: "Example.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
      },
      { kind: "unity-packages-lock", path: "Packages/packages-lock.json" },
      {
        kind: "swift-package-resolved",
        path: "Workspace.xcworkspace/xcshareddata/swiftpm/Package.resolved"
      },
      { kind: "gradle-lock", path: "gradle/dependency-locks" },
      { kind: "nuget-assets", path: "obj/project.assets.json" },
      { kind: "package-lock", path: "package-lock.json" },
      { kind: "pylock", path: "pylock.prod.toml" }
    ]);
  });

  test("removes companion manifests when a resolved input is present", () => {
    const rootDir = path.resolve("/tmp/ohrisk-listed-companions");
    const lockfiles = projectLockfilesFromRelativePaths({
      rootDir,
      relativePaths: [
        "go.work",
        "go.mod",
        "poetry.lock",
        "pyproject.toml",
        "Chart.lock",
        "Chart.yaml",
        "conda-lock.yml",
        "environment.yml",
        "gradle/dependency-locks/runtime.lockfile",
        "gradle/libs.versions.toml"
      ]
    });

    expect(lockfiles.map((lockfile) => path.relative(rootDir, lockfile.path).replace(/\\/g, "/")))
      .toEqual([
        "Chart.lock",
        "conda-lock.yml",
        "go.work",
        "gradle/dependency-locks",
        "poetry.lock"
      ]);
  });
});
