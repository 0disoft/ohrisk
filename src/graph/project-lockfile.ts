import { omitUndefined } from "../shared/object";
import { parseBazelModuleFile, parseBazelModuleText } from "./bazel-module";
import {
  parseCartfileResolvedFile,
  parseCartfileResolvedText
} from "./carthage-cartfile-resolved";
import { parsePodfileLockfile, parsePodfileLockText } from "./cocoapods-podfile-lock";
import {
  parseCondaEnvironmentFile,
  parseCondaEnvironmentText
} from "./conda-environment";
import { parseCondaLockfile, parseCondaLockText } from "./conda-lock";
import { parseConanLockfile, parseConanLockText } from "./conan-lock";
import { parseCycloneDxJsonFile, parseCycloneDxJsonText } from "./cyclonedx-json";
import { parseCycloneDxXmlFile, parseCycloneDxXmlText } from "./cyclonedx-xml";
import { parsePubspecLockfile, parsePubspecLockText } from "./dart-pubspec-lock";
import { parseDenoLockfile, parseDenoLockText } from "./deno-lock";
import {
  parseDirectoryPackagesPropsText,
  parseDotnetProjectFile,
  parseDotnetProjectText,
  parseNugetLockfile,
  parseNugetLockText,
  parseNugetPackagesConfigFile,
  parseNugetPackagesConfigText,
  parseNugetProjectAssetsFile,
  parseNugetProjectAssetsText
} from "./dotnet-nuget-lock";
import { parseMixLockfile, parseMixLockText } from "./elixir-mix-lock";
import { parseRebarLockfile, parseRebarLockText } from "./erlang-rebar-lock";
import { parseGoModFile, parseGoModText } from "./go-mod";
import { parseGoWorkFile, parseGoWorkText, type GoWorkModuleInput } from "./go-work";
import type { DependencyGraph } from "./types";
import { parseHelmChartFile, parseHelmChartText } from "./helm-chart";
import { parseStackLockfile, parseStackLockText } from "./haskell-stack-lock";
import { parseGradleLockfile, parseGradleLockText } from "./java-gradle-lock";
import {
  parseGradleVersionCatalogFile,
  parseGradleVersionCatalogText
} from "./java-gradle-version-catalog";
import {
  parseMavenPomFile,
  parseMavenPomText,
  type MavenExternalPomDocument,
  type MavenProjectPomReader
} from "./java-maven-pom";
import { parseJuliaManifestFile, parseJuliaManifestText } from "./julia-manifest";
import { parseLuarocksLockfile, parseLuarocksLockText } from "./lua-luarocks-lock";
import { parseNixFlakeLockfile, parseNixFlakeLockText } from "./nix-flake-lock";
import { parseBunLockfile, parseBunLockText } from "./npm-bun-lock";
import {
  parsePackageJsonManifestFile,
  parsePackageJsonManifestText
} from "./npm-package-json";
import { parsePackageLockfile, parsePackageLockText } from "./npm-package-lock";
import { parsePnpmLockfile, parsePnpmLockText } from "./npm-pnpm-lock";
import {
  parseYarnLockfile,
  parseYarnLockText,
  type YarnWorkspacePackageJsonInput
} from "./npm-yarn-lock";
import {
  parseCpanfileSnapshotFile,
  parseCpanfileSnapshotText
} from "./perl-cpanfile-snapshot";
import { parseComposerLockfile, parseComposerLockText } from "./php-composer-lock";
import type { PythonLocalSourceFileReader } from "./python-local-source";
import { parsePdmLockfile, parsePdmLockText } from "./python-pdm-lock";
import { parsePipfileLockfile, parsePipfileLockText } from "./python-pipfile-lock";
import { parsePoetryLockfile, parsePoetryLockText } from "./python-poetry-lock";
import { parsePylockFile, parsePylockText } from "./python-pylock";
import { parsePyprojectFile, parsePyprojectText } from "./python-pyproject";
import {
  parseRequirementsFile,
  parseRequirementsText,
  type RequirementsIncludedFileReader
} from "./python-requirements";
import { parseUvLockfile, parseUvLockText } from "./python-uv-lock";
import { parseRenvLockfile, parseRenvLockText } from "./r-renv-lock";
import { parseGemfileLockfile, parseGemfileLockText } from "./ruby-gemfile-lock";
import { parseCargoLockfile, parseCargoLockText } from "./rust-cargo-lock";
import { parseSpdxJsonFile, parseSpdxJsonText } from "./spdx-json";
import { parseSpdxRdfFile, parseSpdxRdfText } from "./spdx-rdf";
import { parseSpdxTagValueFile, parseSpdxTagValueText } from "./spdx-tag-value";
import {
  parseSwiftPackageResolvedFile,
  parseSwiftPackageResolvedText
} from "./swift-package-resolved";
import { parseTerraformLockfile, parseTerraformLockText } from "./terraform-lock";
import {
  parseUnityPackagesLockfile,
  parseUnityPackagesLockText
} from "./unity-packages-lock";
import { parseVcpkgJsonFile, parseVcpkgJsonText } from "./vcpkg-json";
import type { ProjectInput } from "../project/discover";
import type { OhriskError } from "../shared/errors";
import { isErr, type Result } from "../shared/result";

export type LockfileTextParseInput = {
  kind: ProjectInput["lockfile"]["kind"];
  text: string;
  lockfilePath: string;
  packageJsonText?: string;
  packageJsonPath?: string;
  workspacePackageJsonTexts?: YarnWorkspacePackageJsonInput[];
  pnpmWorkspaceText?: string;
  pnpmWorkspacePath?: string;
  pyprojectText?: string;
  cargoManifestText?: string;
  cargoMemberManifestTexts?: string[];
  cargoRootName?: string;
  goSumText?: string;
  goWorkModuleInputs?: GoWorkModuleInput[];
  goWorkDir?: string;
  composerJsonText?: string;
  directoryPackagesPropsText?: string;
  directoryPackagesPropsPath?: string;
  dotnetProjectRootName?: string;
  projectRoot?: string;
  requirementsRootName?: string;
  requirementsIncludedFileReader?: RequirementsIncludedFileReader;
  pythonLocalSourceFileReader?: PythonLocalSourceFileReader;
  mavenProjectPomReader?: MavenProjectPomReader;
};

export type ProjectLockfileParseOptions = {
  pythonLocalSourceRootDir?: string;
  mavenExternalPoms?: ReadonlyMap<string, MavenExternalPomDocument>;
};

export function parseProjectLockfile(
  project: ProjectInput,
  options: ProjectLockfileParseOptions = {}
): Result<DependencyGraph, OhriskError> {
  switch (project.lockfile.kind) {
    case "bun":
      return parseBunLockfile(project.lockfile.path);
    case "package-lock":
    case "npm-shrinkwrap":
      return parsePackageLockfile(project.lockfile.path);
    case "pnpm-lock":
      return parsePnpmLockfile(project.lockfile.path);
    case "deno-lock":
      return parseDenoLockfile(project.lockfile.path);
    case "cargo-lock":
      return parseCargoLockfile(project.lockfile.path);
    case "go-work":
      return parseGoWorkFile(project.lockfile.path);
    case "go-mod":
      return parseGoModFile(project.lockfile.path);
    case "pipfile-lock":
      return parsePipfileLockfile(project.lockfile.path);
    case "pdm-lock":
      return parsePdmLockfile(project.lockfile.path);
    case "poetry-lock":
      return parsePoetryLockfile(project.lockfile.path);
    case "pyproject-toml":
      return parsePyprojectFile(project.lockfile.path);
    case "requirements-txt":
      return parseRequirementsFile(project.lockfile.path);
    case "uv-lock":
      return parseUvLockfile(project.lockfile.path, omitUndefined({
        localSourceRootDir: options.pythonLocalSourceRootDir
      }));
    case "pylock":
      return parsePylockFile(project.lockfile.path);
    case "gradle-lock":
      return parseGradleLockfile(project.lockfile.path);
    case "gradle-version-catalog":
      return parseGradleVersionCatalogFile(project.lockfile.path);
    case "bazel-module":
      return parseBazelModuleFile(project.lockfile.path);
    case "maven-pom":
      return parseMavenPomFile(project.lockfile.path, {
        projectRoot: project.rootDir,
        ...(options.mavenExternalPoms ? { externalPoms: options.mavenExternalPoms } : {})
      });
    case "nuget-lock":
      return parseNugetLockfile(project.lockfile.path);
    case "nuget-assets":
      return parseNugetProjectAssetsFile(project.lockfile.path);
    case "dotnet-project":
      return parseDotnetProjectFile(project.lockfile.path);
    case "nuget-packages-config":
      return parseNugetPackagesConfigFile(project.lockfile.path);
    case "conan-lock":
      return parseConanLockfile(project.lockfile.path);
    case "conda-environment":
      return parseCondaEnvironmentFile(project.lockfile.path);
    case "conda-lock":
      return parseCondaLockfile(project.lockfile.path);
    case "vcpkg-json":
      return parseVcpkgJsonFile(project.lockfile.path);
    case "terraform-lock":
      return parseTerraformLockfile(project.lockfile.path);
    case "helm-chart-lock":
    case "helm-chart-yaml":
      return parseHelmChartFile(project.lockfile.path);
    case "nix-flake-lock":
      return parseNixFlakeLockfile(project.lockfile.path);
    case "unity-packages-lock":
      return parseUnityPackagesLockfile(project.lockfile.path);
    case "renv-lock":
      return parseRenvLockfile(project.lockfile.path);
    case "julia-manifest":
      return parseJuliaManifestFile(project.lockfile.path);
    case "stack-lock":
      return parseStackLockfile(project.lockfile.path);
    case "cpanfile-snapshot":
      return parseCpanfileSnapshotFile(project.lockfile.path);
    case "luarocks-lock":
      return parseLuarocksLockfile(project.lockfile.path);
    case "pubspec-lock":
      return parsePubspecLockfile(project.lockfile.path);
    case "swift-package-resolved":
      return parseSwiftPackageResolvedFile(project.lockfile.path);
    case "cartfile-resolved":
      return parseCartfileResolvedFile(project.lockfile.path);
    case "podfile-lock":
      return parsePodfileLockfile(project.lockfile.path);
    case "mix-lock":
      return parseMixLockfile(project.lockfile.path);
    case "rebar-lock":
      return parseRebarLockfile(project.lockfile.path);
    case "gemfile-lock":
      return parseGemfileLockfile(project.lockfile.path);
    case "composer-lock":
      return parseComposerLockfile(project.lockfile.path);
    case "cyclonedx-json":
      return parseCycloneDxJsonFile(project.lockfile.path);
    case "cyclonedx-xml":
      return parseCycloneDxXmlFile(project.lockfile.path);
    case "spdx-json":
      return parseSpdxJsonFile(project.lockfile.path);
    case "spdx-rdf":
      return parseSpdxRdfFile(project.lockfile.path);
    case "spdx-tag-value":
      return parseSpdxTagValueFile(project.lockfile.path);
    case "yarn-lock":
      return parseYarnLockfile(project.lockfile.path);
    case "package-json":
      return parsePackageJsonManifestFile(project.lockfile.path);
  }
}

export function parseLockfileTextForKind(
  input: LockfileTextParseInput
): Result<DependencyGraph, OhriskError> {
  switch (input.kind) {
    case "bun":
      return parseBunLockText(input.text, input.lockfilePath);
    case "package-lock":
    case "npm-shrinkwrap":
      return parsePackageLockText(input.text, input.lockfilePath);
    case "pnpm-lock":
      return parsePnpmLockText(input.text, input.lockfilePath, omitUndefined({
        workspaceText: input.pnpmWorkspaceText,
        workspacePath: input.pnpmWorkspacePath
      }));
    case "deno-lock":
      return parseDenoLockText(input.text, input.lockfilePath);
    case "cargo-lock":
      return parseCargoLockText(input.text, input.lockfilePath, omitUndefined({
        manifestText: input.cargoManifestText,
        memberManifestTexts: input.cargoMemberManifestTexts,
        rootName: input.cargoRootName
      }));
    case "go-work":
      return parseGoWorkText(input.text, input.lockfilePath, omitUndefined({
        moduleInputs: input.goWorkModuleInputs,
        workspaceRootDir: input.projectRoot,
        goWorkDir: input.goWorkDir
      }));
    case "go-mod":
      return parseGoModText(input.text, input.lockfilePath, omitUndefined({
        goSumText: input.goSumText
      }));
    case "pipfile-lock":
      return parsePipfileLockText(input.text, input.lockfilePath, omitUndefined({
        readLocalSourceFile: input.pythonLocalSourceFileReader,
        rootName: input.requirementsRootName
      }));
    case "pdm-lock":
      return parsePdmLockText(input.text, input.lockfilePath, omitUndefined({
        pyprojectText: input.pyprojectText,
        readLocalSourceFile: input.pythonLocalSourceFileReader
      }));
    case "poetry-lock":
      return parsePoetryLockText(input.text, input.lockfilePath, omitUndefined({
        pyprojectText: input.pyprojectText
      }));
    case "pyproject-toml":
      return parsePyprojectText(input.text, input.lockfilePath);
    case "requirements-txt":
      return parseRequirementsText(input.text, input.lockfilePath, omitUndefined({
        rootName: input.requirementsRootName,
        readIncludedFile: input.requirementsIncludedFileReader,
        readLocalSourceFile: input.pythonLocalSourceFileReader
      }));
    case "uv-lock":
      return parseUvLockText(input.text, input.lockfilePath, omitUndefined({
        readLocalSourceFile: input.pythonLocalSourceFileReader
      }));
    case "pylock":
      return parsePylockText(input.text, input.lockfilePath, omitUndefined({
        readLocalSourceFile: input.pythonLocalSourceFileReader
      }));
    case "gradle-lock":
      return parseGradleLockText(input.text, input.lockfilePath);
    case "gradle-version-catalog":
      return parseGradleVersionCatalogText(input.text, input.lockfilePath);
    case "bazel-module":
      return parseBazelModuleText(input.text, input.lockfilePath);
    case "maven-pom":
      return parseMavenPomText(input.text, input.lockfilePath, omitUndefined({
        projectRoot: input.projectRoot,
        readProjectPom: input.mavenProjectPomReader
      }));
    case "nuget-lock":
      return parseNugetLockText(input.text, input.lockfilePath);
    case "nuget-assets":
      return parseNugetProjectAssetsText(input.text, input.lockfilePath);
    case "dotnet-project":
      if (input.directoryPackagesPropsText) {
        const centralPackageVersions = parseDirectoryPackagesPropsText(
          input.directoryPackagesPropsText,
          input.directoryPackagesPropsPath
        );
        if (isErr(centralPackageVersions)) {
          return centralPackageVersions;
        }

        return parseDotnetProjectText(input.text, input.lockfilePath, omitUndefined({
          centralPackageVersions: centralPackageVersions.value,
          rootName: input.dotnetProjectRootName
        }));
      }

      return parseDotnetProjectText(input.text, input.lockfilePath, omitUndefined({
        rootName: input.dotnetProjectRootName
      }));
    case "nuget-packages-config":
      return parseNugetPackagesConfigText(input.text, input.lockfilePath);
    case "conan-lock":
      return parseConanLockText(input.text, input.lockfilePath);
    case "conda-environment":
      return parseCondaEnvironmentText(input.text, input.lockfilePath);
    case "conda-lock":
      return parseCondaLockText(input.text, input.lockfilePath);
    case "vcpkg-json":
      return parseVcpkgJsonText(input.text, input.lockfilePath);
    case "terraform-lock":
      return parseTerraformLockText(input.text, input.lockfilePath);
    case "helm-chart-lock":
    case "helm-chart-yaml":
      return parseHelmChartText(input.text, input.lockfilePath);
    case "nix-flake-lock":
      return parseNixFlakeLockText(input.text, input.lockfilePath);
    case "unity-packages-lock":
      return parseUnityPackagesLockText(input.text, input.lockfilePath);
    case "renv-lock":
      return parseRenvLockText(input.text, input.lockfilePath);
    case "julia-manifest":
      return parseJuliaManifestText(input.text, input.lockfilePath);
    case "stack-lock":
      return parseStackLockText(input.text, input.lockfilePath);
    case "cpanfile-snapshot":
      return parseCpanfileSnapshotText(input.text, input.lockfilePath);
    case "luarocks-lock":
      return parseLuarocksLockText(input.text, input.lockfilePath);
    case "pubspec-lock":
      return parsePubspecLockText(input.text, input.lockfilePath);
    case "swift-package-resolved":
      return parseSwiftPackageResolvedText(input.text, input.lockfilePath);
    case "cartfile-resolved":
      return parseCartfileResolvedText(input.text, input.lockfilePath);
    case "podfile-lock":
      return parsePodfileLockText(input.text, input.lockfilePath);
    case "mix-lock":
      return parseMixLockText(input.text, input.lockfilePath);
    case "rebar-lock":
      return parseRebarLockText(input.text, input.lockfilePath);
    case "gemfile-lock":
      return parseGemfileLockText(input.text, input.lockfilePath);
    case "composer-lock":
      return parseComposerLockText(input.text, input.lockfilePath, omitUndefined({
        composerJsonText: input.composerJsonText
      }));
    case "cyclonedx-json":
      return parseCycloneDxJsonText(input.text, input.lockfilePath);
    case "cyclonedx-xml":
      return parseCycloneDxXmlText(input.text, input.lockfilePath);
    case "spdx-json":
      return parseSpdxJsonText(input.text, input.lockfilePath);
    case "spdx-rdf":
      return parseSpdxRdfText(input.text, input.lockfilePath);
    case "spdx-tag-value":
      return parseSpdxTagValueText(input.text, input.lockfilePath);
    case "yarn-lock":
      return parseYarnLockText(omitUndefined({
        lockfileText: input.text,
        packageJsonText: input.packageJsonText ?? "{}",
        lockfilePath: input.lockfilePath,
        packageJsonPath: input.packageJsonPath,
        workspacePackageJsonTexts: input.workspacePackageJsonTexts
      }));
    case "package-json":
      return parsePackageJsonManifestText(input.text, input.lockfilePath);
  }
}
