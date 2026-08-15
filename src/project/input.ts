import type { RepositoryTreeInventory } from "../repository/tree-inventory";

export type SupportedLockfileKind =
  | "bun"
  | "package-lock"
  | "npm-shrinkwrap"
  | "pnpm-lock"
  | "deno-lock"
  | "cargo-lock"
  | "go-work"
  | "go-mod"
  | "pipfile-lock"
  | "pdm-lock"
  | "poetry-lock"
  | "pyproject-toml"
  | "requirements-txt"
  | "uv-lock"
  | "pylock"
  | "gradle-lock"
  | "gradle-version-catalog"
  | "bazel-module"
  | "maven-pom"
  | "nuget-lock"
  | "nuget-assets"
  | "dotnet-project"
  | "nuget-packages-config"
  | "conan-lock"
  | "conda-environment"
  | "conda-lock"
  | "vcpkg-json"
  | "terraform-lock"
  | "helm-chart-lock"
  | "helm-chart-yaml"
  | "nix-flake-lock"
  | "unity-packages-lock"
  | "renv-lock"
  | "julia-manifest"
  | "stack-lock"
  | "cpanfile-snapshot"
  | "luarocks-lock"
  | "pubspec-lock"
  | "swift-package-resolved"
  | "cartfile-resolved"
  | "podfile-lock"
  | "mix-lock"
  | "rebar-lock"
  | "gemfile-lock"
  | "composer-lock"
  | "cyclonedx-json"
  | "cyclonedx-xml"
  | "spdx-json"
  | "spdx-rdf"
  | "spdx-tag-value"
  | "yarn-lock"
  | "package-json"
  | "zig-zon";

export type ProjectLockfile = {
  kind: SupportedLockfileKind;
  path: string;
};

export type ProjectArchiveSource = {
  kind: "archive";
  displayPath: string;
  format: "zip" | "tar" | "tar.gz";
  sha256: string;
  entryRoot: string;
};

export type ProjectInput = {
  rootDir: string;
  lockfile: ProjectLockfile;
  lockfiles?: ProjectLockfile[];
  source?: ProjectArchiveSource;
};

export type DiscoverProjectOptions = {
  cwd?: string;
  lockfilePath?: string;
  allLockfiles?: boolean;
  autoMergeSameRoot?: boolean;
  autoMergeDescendantProjects?: boolean;
  searchMode?: "ancestors" | "tree";
  inventory?: RepositoryTreeInventory;
};
