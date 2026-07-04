import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { parsePackageJsonManifestFile } from "../graph/npm-package-json";
import { createError, type OhriskError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

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
  | "package-json";

export type ProjectLockfile = {
  kind: SupportedLockfileKind;
  path: string;
};

export type ProjectInput = {
  rootDir: string;
  lockfile: ProjectLockfile;
};

export type DiscoverProjectOptions = {
  cwd?: string;
  lockfilePath?: string;
};

const SUPPORTED_LOCKFILES: Record<string, SupportedLockfileKind> = {
  "bun.lock": "bun",
  "package-lock.json": "package-lock",
  "npm-shrinkwrap.json": "npm-shrinkwrap",
  "pnpm-lock.yaml": "pnpm-lock",
  "deno.lock": "deno-lock",
  "Cargo.lock": "cargo-lock",
  "go.work": "go-work",
  "go.mod": "go-mod",
  "Pipfile.lock": "pipfile-lock",
  "pdm.lock": "pdm-lock",
  "poetry.lock": "poetry-lock",
  "pyproject.toml": "pyproject-toml",
  "requirements.txt": "requirements-txt",
  "uv.lock": "uv-lock",
  "pylock.toml": "pylock",
  "gradle.lockfile": "gradle-lock",
  "libs.versions.toml": "gradle-version-catalog",
  "MODULE.bazel": "bazel-module",
  "pom.xml": "maven-pom",
  "packages.lock.json": "nuget-lock",
  "project.assets.json": "nuget-assets",
  "packages.config": "nuget-packages-config",
  "conan.lock": "conan-lock",
  "environment.yml": "conda-environment",
  "environment.yaml": "conda-environment",
  "conda-lock.yml": "conda-lock",
  "conda-lock.yaml": "conda-lock",
  "vcpkg.json": "vcpkg-json",
  ".terraform.lock.hcl": "terraform-lock",
  "Chart.lock": "helm-chart-lock",
  "Chart.yaml": "helm-chart-yaml",
  "flake.lock": "nix-flake-lock",
  "renv.lock": "renv-lock",
  "Manifest.toml": "julia-manifest",
  "stack.yaml.lock": "stack-lock",
  "cpanfile.snapshot": "cpanfile-snapshot",
  "luarocks.lock": "luarocks-lock",
  "pubspec.lock": "pubspec-lock",
  "Package.resolved": "swift-package-resolved",
  "Cartfile.resolved": "cartfile-resolved",
  "Podfile.lock": "podfile-lock",
  "mix.lock": "mix-lock",
  "rebar.lock": "rebar-lock",
  "Gemfile.lock": "gemfile-lock",
  "composer.lock": "composer-lock",
  "bom.json": "cyclonedx-json",
  "cyclonedx.json": "cyclonedx-json",
  "sbom.cdx.json": "cyclonedx-json",
  "bom.xml": "cyclonedx-xml",
  "cyclonedx.xml": "cyclonedx-xml",
  "sbom.cdx.xml": "cyclonedx-xml",
  "spdx.json": "spdx-json",
  "sbom.spdx.json": "spdx-json",
  "spdx.rdf": "spdx-rdf",
  "bom.spdx.rdf": "spdx-rdf",
  "sbom.spdx.rdf": "spdx-rdf",
  "sbom.spdx.rdf.xml": "spdx-rdf",
  "sbom.spdx": "spdx-tag-value",
  "bom.spdx": "spdx-tag-value",
  "yarn.lock": "yarn-lock"
};

const KNOWN_LOCKFILES = [
  "bun.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "deno.lock",
  "Cargo.lock",
  "go.work",
  "go.mod",
  "Pipfile.lock",
  "pdm.lock",
  "poetry.lock",
  "pyproject.toml",
  "requirements.txt",
  "uv.lock",
  "pylock.toml",
  "gradle.lockfile",
  "libs.versions.toml",
  "MODULE.bazel",
  "pom.xml",
  "packages.lock.json",
  "project.assets.json",
  "packages.config",
  "conan.lock",
  "environment.yml",
  "environment.yaml",
  "conda-lock.yml",
  "conda-lock.yaml",
  "vcpkg.json",
  ".terraform.lock.hcl",
  "Chart.lock",
  "Chart.yaml",
  "flake.lock",
  "renv.lock",
  "Manifest.toml",
  "stack.yaml.lock",
  "cpanfile.snapshot",
  "luarocks.lock",
  "pubspec.lock",
  "Package.resolved",
  "Cartfile.resolved",
  "Podfile.lock",
  "mix.lock",
  "rebar.lock",
  "Gemfile.lock",
  "composer.lock",
  "bom.json",
  "cyclonedx.json",
  "sbom.cdx.json",
  "bom.xml",
  "cyclonedx.xml",
  "sbom.cdx.xml",
  "spdx.json",
  "sbom.spdx.json",
  "spdx.rdf",
  "bom.spdx.rdf",
  "sbom.spdx.rdf",
  "sbom.spdx.rdf.xml",
  "sbom.spdx",
  "bom.spdx",
  "yarn.lock"
] as const;

const KNOWN_NESTED_LOCKFILES = [
  path.join("gradle", "libs.versions.toml"),
  "obj/project.assets.json",
  path.join("Packages", "packages-lock.json")
] as const;

const GRADLE_DEPENDENCY_LOCKS_DIR = path.join("gradle", "dependency-locks");
const SBOM_SNIFF_MAX_BYTES = 64 * 1024;

const KNOWN_PROJECT_MANIFESTS = [
  "package.json",
  "deno.json",
  "deno.jsonc",
  "Cargo.toml",
  "go.work",
  "Pipfile",
  "pyproject.toml",
  "build.gradle",
  "build.gradle.kts",
  path.join("gradle", "libs.versions.toml"),
  "MODULE.bazel",
  "conanfile.py",
  "conanfile.txt",
  "environment.yml",
  "environment.yaml",
  "vcpkg.json",
  "main.tf",
  "versions.tf",
  "Chart.yaml",
  "flake.nix",
  path.join("Packages", "manifest.json"),
  "renv.lock",
  "Project.toml",
  "stack.yaml",
  "cpanfile",
  "composer.json",
  "pubspec.yaml",
  "Package.swift",
  "Cartfile",
  "Podfile",
  "mix.exs",
  "rebar.config",
  "Gemfile",
  "bom.json",
  "cyclonedx.json",
  "sbom.cdx.json",
  "bom.xml",
  "cyclonedx.xml",
  "sbom.cdx.xml",
  "spdx.json",
  "sbom.spdx.json",
  "spdx.rdf",
  "bom.spdx.rdf",
  "sbom.spdx.rdf",
  "sbom.spdx.rdf.xml",
  "sbom.spdx",
  "bom.spdx"
] as const;

const SUPPORTED_LOCKFILE_MESSAGE = "Ohrisk currently supports dependency-free package.json manifests, bun.lock, package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, deno.lock, Cargo.lock, go.work, go.mod, Pipfile.lock, pdm.lock, poetry.lock, pyproject.toml, requirements.txt, uv.lock, pylock.toml, pylock.<name>.toml, gradle.lockfile, gradle/dependency-locks, gradle/dependency-locks/*.lockfile, gradle/libs.versions.toml, MODULE.bazel, pom.xml, packages.lock.json, obj/project.assets.json, packages.config, *.csproj, conan.lock, environment.yml, environment.yaml, conda-lock.yml, conda-lock.yaml, vcpkg.json, .terraform.lock.hcl, Chart.lock, Chart.yaml, flake.lock, Packages/packages-lock.json, renv.lock, Manifest.toml, stack.yaml.lock, cpanfile.snapshot, luarocks.lock, pubspec.lock, Package.resolved, Cartfile.resolved, Podfile.lock, mix.lock, rebar.lock, Gemfile.lock, composer.lock, CycloneDX JSON/XML, SPDX JSON/RDF, SPDX tag-value .spdx, and Yarn classic/Berry yarn.lock.";

export function discoverProject(
  options: DiscoverProjectOptions = {}
): Result<ProjectInput, OhriskError> {
  const startDir = path.resolve(options.cwd ?? process.cwd());

  try {
    if (options.lockfilePath) {
      return discoverExplicitLockfile({
        cwd: startDir,
        lockfilePath: options.lockfilePath
      });
    }

    let nearestManifestWithoutParentLockfile: string | undefined;

    for (const dir of ancestorsFrom(startDir)) {
      const lockfiles = findKnownLockfiles(dir);
      const hasProjectManifest = hasKnownProjectManifest(dir);
      const hasKnownLockfileDirectory = hasKnownLockfileDirectoryPath(dir);

      if (lockfiles.length === 0) {
        const packageJsonManifest = hasKnownLockfileDirectory
          ? undefined
          : findDependencyFreePackageJsonManifest(dir);
        if (packageJsonManifest) {
          return ok({
            rootDir: dir,
            lockfile: {
              kind: "package-json",
              path: path.join(dir, packageJsonManifest)
            }
          });
        }

        if (!nearestManifestWithoutParentLockfile && hasProjectManifest) {
          nearestManifestWithoutParentLockfile = dir;
        }

        continue;
      }

      if (lockfiles.length > 1) {
        return err(
          createError({
            code: "MULTIPLE_LOCKFILES",
            category: "unsupported_input",
            message: "Multiple lockfiles found in the same project root. Select one with --lockfile.",
            details: {
              rootDir: dir,
              lockfiles
            }
          })
        );
      }

      const lockfileName = lockfiles[0];

      if (!lockfileName) {
        continue;
      }

      const kind = supportedKindForLockfilePath(lockfileName);

      if (!kind) {
        return err(
          createError({
            code: "NO_SUPPORTED_LOCKFILE",
            category: "unsupported_input",
            message: `No supported lockfile found. ${SUPPORTED_LOCKFILE_MESSAGE}`,
            details: {
              rootDir: dir,
              foundLockfiles: lockfiles,
              supportedLockfiles: supportedLockfileNames()
            }
          })
        );
      }

      return ok({
        rootDir: rootDirForLockfilePath(path.join(dir, lockfileName), kind),
        lockfile: {
          kind,
          path: path.join(dir, lockfileName)
        }
      });
    }

    if (nearestManifestWithoutParentLockfile) {
      return err(
        createError({
          code: "NO_SUPPORTED_LOCKFILE",
          category: "unsupported_input",
          message: `Project manifest found, but no supported lockfile exists. ${SUPPORTED_LOCKFILE_MESSAGE}`,
          details: {
            rootDir: nearestManifestWithoutParentLockfile,
            supportedLockfiles: supportedLockfileNames()
          }
        })
      );
    }
  } catch (cause) {
    return err(
      createError({
        code: "PROJECT_DISCOVERY_FAILED",
        category: "filesystem",
        message: "Project discovery failed while walking parent directories.",
        details: {
          startDir,
          cause: cause instanceof Error ? cause.message : String(cause)
        }
      })
    );
  }

  return err(
    createError({
      code: "NO_SUPPORTED_LOCKFILE",
      category: "unsupported_input",
      message: `No supported lockfile found. ${SUPPORTED_LOCKFILE_MESSAGE}`,
      details: {
        startDir,
        supportedLockfiles: supportedLockfileNames()
      }
    })
  );
}

function discoverExplicitLockfile(input: {
  cwd: string;
  lockfilePath: string;
}): Result<ProjectInput, OhriskError> {
  const lockfilePath = path.resolve(input.cwd, input.lockfilePath);
  const pathKind = supportedKindForLockfilePath(lockfilePath);

  if (!existsSync(lockfilePath)) {
    if (!pathKind) {
      return err(
        createError({
          code: "UNSUPPORTED_LOCKFILE",
          category: "unsupported_input",
          message: `Explicit lockfile path is not a supported lockfile name. ${SUPPORTED_LOCKFILE_MESSAGE}`,
          details: {
            lockfilePath,
            supportedLockfiles: supportedLockfileNames()
          }
        })
      );
    }

    return err(
      createError({
        code: "LOCKFILE_NOT_FOUND",
        category: "invalid_input",
        message: "Explicit lockfile path does not exist.",
        details: {
          lockfilePath
        }
      })
    );
  }

  if (!isFile(lockfilePath) && !isGradleDependencyLockfileDirectory(lockfilePath)) {
    return err(
      createError({
        code: "LOCKFILE_NOT_FILE",
        category: "invalid_input",
        message: "Explicit lockfile path exists but is not a file.",
        details: {
          lockfilePath
        }
      })
    );
  }

  const kind = pathKind ?? sniffExplicitSbomKind(lockfilePath);

  if (!kind) {
    return err(
      createError({
        code: "UNSUPPORTED_LOCKFILE",
        category: "unsupported_input",
        message: `Explicit lockfile path is not a supported lockfile name or recognized SBOM file. ${SUPPORTED_LOCKFILE_MESSAGE}`,
        details: {
          lockfilePath,
          supportedLockfiles: supportedLockfileNames()
        }
      })
    );
  }

  return ok({
    rootDir: rootDirForLockfilePath(lockfilePath, kind),
    lockfile: {
      kind,
      path: lockfilePath
    }
  });
}

function sniffExplicitSbomKind(lockfilePath: string): SupportedLockfileKind | undefined {
  if (!isFile(lockfilePath)) {
    return undefined;
  }

  const text = readFilePrefix(lockfilePath);
  if (!text) {
    return undefined;
  }

  if (/^\s*\{/.test(text)) {
    if (/"bomFormat"\s*:\s*"CycloneDX"/.test(text)) {
      return "cyclonedx-json";
    }

    if (/"spdxVersion"\s*:\s*"SPDX-[^"]+"/.test(text)) {
      return "spdx-json";
    }
  }

  if (/<bom\b[^>]*\bxmlns=["']http:\/\/cyclonedx\.org\/schema\/bom\//i.test(text)) {
    return "cyclonedx-xml";
  }

  if (/spdx\.org\/rdf\/terms#/i.test(text) && /<spdx:(?:SpdxDocument|Package)\b/i.test(text)) {
    return "spdx-rdf";
  }

  if (/^SPDXVersion:\s*SPDX-/m.test(text) && /^SPDXID:\s*/m.test(text)) {
    return "spdx-tag-value";
  }

  return undefined;
}

function readFilePrefix(filePath: string): string | undefined {
  let fd: number | undefined;

  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(SBOM_SNIFF_MAX_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best effort only; sniffing failure should fall back to unsupported input.
      }
    }
  }
}

function findKnownLockfiles(dir: string): string[] {
  const directLockfiles = KNOWN_LOCKFILES.filter((lockfile) => isFile(path.join(dir, lockfile)));
  const nestedLockfiles = KNOWN_NESTED_LOCKFILES.filter((lockfile) => isFile(path.join(dir, lockfile)));
  const gradleDependencyLockfiles = findGradleDependencyLockfiles(dir);
  const dotnetProjects = findDotnetProjectFiles(dir);
  const xcodeSwiftPackageResolvedFiles = findXcodeSwiftPackageResolvedFiles(dir);
  const namedPylockTomlFiles = findNamedPylockTomlFiles(dir);

  return normalizeCompanionLockfiles([
    ...directLockfiles,
    ...nestedLockfiles,
    ...gradleDependencyLockfiles,
    ...dotnetProjects,
    ...xcodeSwiftPackageResolvedFiles,
    ...namedPylockTomlFiles
  ]).sort();
}

function hasKnownProjectManifest(dir: string): boolean {
  return KNOWN_PROJECT_MANIFESTS.some((manifest) => existsSync(path.join(dir, manifest)))
    || findDotnetProjectFiles(dir).length > 0;
}

function findDotnetProjectFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => entry.toLowerCase().endsWith(".csproj"))
      .filter((entry) => isFile(path.join(dir, entry)))
      .sort();
  } catch {
    return [];
  }
}

function findGradleDependencyLockfiles(dir: string): string[] {
  const lockDir = path.join(dir, GRADLE_DEPENDENCY_LOCKS_DIR);
  try {
    const lockfiles = readdirSync(lockDir)
      .filter((entry) => entry.toLowerCase().endsWith(".lockfile"))
      .filter((entry) => isFile(path.join(lockDir, entry)))
      .sort();

    return lockfiles.length > 0 ? [GRADLE_DEPENDENCY_LOCKS_DIR] : [];
  } catch {
    return [];
  }
}

function normalizeCompanionLockfiles(lockfiles: string[]): string[] {
  if (lockfiles.includes("go.work")) {
    return lockfiles.filter((lockfile) => lockfile !== "go.mod");
  }

  const hasResolvedPythonInput = lockfiles.some((lockfile) =>
    lockfile === "Pipfile.lock"
    || lockfile === "pdm.lock"
    || lockfile === "poetry.lock"
    || lockfile === "requirements.txt"
    || lockfile === "uv.lock"
    || isPylockTomlFile(lockfile)
  );
  if (hasResolvedPythonInput) {
    return lockfiles.filter((lockfile) => lockfile !== "pyproject.toml");
  }

  if (lockfiles.includes("gradle.lockfile")) {
    return lockfiles.filter((lockfile) =>
      lockfile !== path.join("gradle", "libs.versions.toml")
      && !isGradleDependencyLockInputPath(lockfile)
    );
  }

  if (lockfiles.includes(GRADLE_DEPENDENCY_LOCKS_DIR)) {
    return lockfiles.filter((lockfile) => lockfile !== path.join("gradle", "libs.versions.toml"));
  }

  if (lockfiles.includes("Chart.lock")) {
    return lockfiles.filter((lockfile) => lockfile !== "Chart.yaml");
  }

  const hasCondaLock = lockfiles.includes("conda-lock.yml") || lockfiles.includes("conda-lock.yaml");
  if (hasCondaLock) {
    return lockfiles.filter((lockfile) => lockfile !== "environment.yml" && lockfile !== "environment.yaml");
  }

  return lockfiles;
}

function findXcodeSwiftPackageResolvedFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .flatMap((entry) => xcodePackageResolvedCandidates(entry))
      .filter((candidate) => isFile(path.join(dir, candidate)))
      .sort();
  } catch {
    return [];
  }
}

function xcodePackageResolvedCandidates(entry: string): string[] {
  if (entry.endsWith(".xcodeproj")) {
    return [
      path.join(entry, "project.xcworkspace", "xcshareddata", "swiftpm", "Package.resolved")
    ];
  }

  if (entry.endsWith(".xcworkspace")) {
    return [
      path.join(entry, "xcshareddata", "swiftpm", "Package.resolved")
    ];
  }

  return [];
}

function supportedKindForLockfilePath(lockfilePath: string): SupportedLockfileKind | undefined {
  const lockfileName = path.basename(lockfilePath);
  if (lockfileName === "package.json") {
    return "package-json";
  }

  if (lockfileName.toLowerCase().endsWith(".csproj")) {
    return "dotnet-project";
  }

  if (isPylockTomlFile(lockfileName)) {
    return "pylock";
  }

  if (isGradleDependencyLockInputPath(lockfilePath)) {
    return "gradle-lock";
  }

  if (isUnityPackagesLockPath(lockfilePath)) {
    return "unity-packages-lock";
  }

  if (lockfileName.toLowerCase().endsWith(".cdx.json")) {
    return "cyclonedx-json";
  }

  if (lockfileName.toLowerCase().endsWith(".spdx.json")) {
    return "spdx-json";
  }

  if (lockfileName.toLowerCase().endsWith(".spdx")) {
    return "spdx-tag-value";
  }

  if (isSpdxRdfFile(lockfileName)) {
    return "spdx-rdf";
  }

  if (lockfileName.toLowerCase().endsWith(".cdx.xml")) {
    return "cyclonedx-xml";
  }

  return SUPPORTED_LOCKFILES[lockfileName];
}

function rootDirForLockfilePath(
  lockfilePath: string,
  kind: SupportedLockfileKind
): string {
  if (kind === "gradle-version-catalog" && path.basename(path.dirname(lockfilePath)) === "gradle") {
    return path.dirname(path.dirname(lockfilePath));
  }

  if (kind === "gradle-lock" && isGradleDependencyLockInputPath(lockfilePath)) {
    return rootDirForGradleDependencyLockInput(lockfilePath);
  }

  if (kind === "nuget-assets" && path.basename(path.dirname(lockfilePath)).toLowerCase() === "obj") {
    return path.dirname(path.dirname(lockfilePath));
  }

  if (kind === "swift-package-resolved") {
    return swiftProjectRootForPackageResolved(lockfilePath);
  }

  if (kind === "unity-packages-lock" && path.basename(path.dirname(lockfilePath)).toLowerCase() === "packages") {
    return path.dirname(path.dirname(lockfilePath));
  }

  return path.dirname(lockfilePath);
}

function supportedLockfileNames(): string[] {
  return ["package.json (dependency-free)", ...Object.keys(SUPPORTED_LOCKFILES), "pylock.<name>.toml", ...KNOWN_NESTED_LOCKFILES, GRADLE_DEPENDENCY_LOCKS_DIR, path.join(GRADLE_DEPENDENCY_LOCKS_DIR, "*.lockfile"), "*.csproj", "*.cdx.json", "*.spdx.json", "*.spdx", "*.spdx.rdf", "*.spdx.rdf.xml", "*.cdx.xml"];
}

function findDependencyFreePackageJsonManifest(dir: string): string | undefined {
  const packageJsonPath = path.join(dir, "package.json");
  if (!isFile(packageJsonPath)) {
    return undefined;
  }

  const parsed = parsePackageJsonManifestFile(packageJsonPath);
  return parsed.ok ? "package.json" : undefined;
}

function hasKnownLockfileDirectoryPath(dir: string): boolean {
  return KNOWN_LOCKFILES.some((lockfile) => {
    const lockfilePath = path.join(dir, lockfile);
    return existsSync(lockfilePath) && isDirectory(lockfilePath);
  });
}

function swiftProjectRootForPackageResolved(lockfilePath: string): string {
  const segments = path.normalize(lockfilePath).split(path.sep);
  const xcodeContainerIndex = segments.findIndex((segment) =>
    segment.endsWith(".xcodeproj") || segment.endsWith(".xcworkspace")
  );

  if (xcodeContainerIndex > 0) {
    return segments.slice(0, xcodeContainerIndex).join(path.sep);
  }

  return path.dirname(lockfilePath);
}

function isUnityPackagesLockPath(lockfilePath: string): boolean {
  const segments = path.normalize(lockfilePath).split(path.sep);
  return segments.length >= 2
    && segments[segments.length - 1] === "packages-lock.json"
    && segments[segments.length - 2] === "Packages";
}

function isGradleDependencyLockInputPath(lockfilePath: string): boolean {
  const segments = path.normalize(lockfilePath).split(path.sep);
  return isGradleDependencyLockDirectorySegments(segments)
    || isGradleDependencyLockfileSegments(segments);
}

function isGradleDependencyLockfileDirectory(lockfilePath: string): boolean {
  return isGradleDependencyLockDirectorySegments(path.normalize(lockfilePath).split(path.sep))
    && isDirectory(lockfilePath);
}

function isGradleDependencyLockDirectorySegments(segments: string[]): boolean {
  return segments.length >= 2
    && segments[segments.length - 1] === "dependency-locks"
    && segments[segments.length - 2] === "gradle";
}

function isGradleDependencyLockfileSegments(segments: string[]): boolean {
  return segments.length >= 3
    && segments[segments.length - 1]?.toLowerCase().endsWith(".lockfile") === true
    && segments[segments.length - 2] === "dependency-locks"
    && segments[segments.length - 3] === "gradle";
}

function rootDirForGradleDependencyLockInput(lockfilePath: string): string {
  const segments = path.normalize(lockfilePath).split(path.sep);
  return isGradleDependencyLockDirectorySegments(segments)
    ? path.dirname(path.dirname(lockfilePath))
    : path.dirname(path.dirname(path.dirname(lockfilePath)));
}

function findNamedPylockTomlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => entry !== "pylock.toml" && isPylockTomlFile(entry))
      .filter((entry) => isFile(path.join(dir, entry)))
      .sort();
  } catch {
    return [];
  }
}

function isPylockTomlFile(filename: string): boolean {
  return /^pylock\.[^.]+\.toml$/.test(filename) || filename === "pylock.toml";
}

function isSpdxRdfFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".spdx.rdf") || lower.endsWith(".spdx.rdf.xml");
}

function isFile(pathname: string): boolean {
  try {
    return statSync(pathname).isFile();
  } catch {
    return false;
  }
}

function isDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function ancestorsFrom(startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir;

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);

    if (parent === current) {
      return dirs;
    }

    current = parent;
  }
}
