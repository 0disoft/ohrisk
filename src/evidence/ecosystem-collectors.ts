import { collectBazelModuleEvidence } from "./bazel-module";
import { collectCargoPackageEvidence } from "./cargo-package";
import { collectCarthagePackageEvidence } from "./carthage-package";
import { collectCocoapodsPackageEvidence } from "./cocoapods-package";
import { collectCondaPackageEvidence } from "./conda-package";
import { collectConanPackageEvidence } from "./conan-package";
import { collectComposerPackageEvidence } from "./composer-package";
import { collectCpanPackageEvidence } from "./cpan-package";
import { collectGoModuleEvidence } from "./go-module";
import { collectHackagePackageEvidence } from "./hackage-package";
import { collectHelmChartEvidence } from "./helm-chart";
import { collectHexPackageEvidence } from "./hex-package";
import { collectJuliaPackageEvidence } from "./julia-package";
import { collectLuarocksPackageEvidence } from "./luarocks-package";
import { collectMavenPackageEvidence } from "./maven-package";
import { collectNixPackageEvidence } from "./nix-package";
import { collectNugetPackageEvidence } from "./nuget-package";
import { collectPubPackageEvidence } from "./pub-package";
import { collectPythonPackageEvidence } from "./python-package";
import { collectRPackageEvidence } from "./r-package";
import { collectRubyGemEvidence } from "./ruby-gem";
import { collectSwiftPackageEvidence } from "./swift-package";
import { collectTerraformProviderEvidence } from "./terraform-provider";
import { collectUnityPackageEvidence } from "./unity-package";
import { collectVcpkgPackageEvidence } from "./vcpkg-package";
import type { LicenseEvidence } from "./types";
import type { DependencyNode } from "../graph/types";
import type { OhriskError } from "../shared/errors";
import type { Result } from "../shared/result";

export type EcosystemEvidenceInput = {
  node: DependencyNode;
  projectRoot: string;
};

type EcosystemEvidenceCollector = (
  input: EcosystemEvidenceInput
) => Result<LicenseEvidence, OhriskError>;

type EcosystemEvidenceCollectors = Partial<
  Record<DependencyNode["ecosystem"], EcosystemEvidenceCollector>
>;

const ECOSYSTEM_EVIDENCE_COLLECTORS: EcosystemEvidenceCollectors = {
  bazel: ({ node, projectRoot }) => collectBazelModuleEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  cargo: ({ node, projectRoot }) => collectCargoPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  carthage: ({ node, projectRoot }) => collectCarthagePackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  }),
  cocoapods: ({ node, projectRoot }) => collectCocoapodsPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  }),
  composer: ({ node, projectRoot }) => collectComposerPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  }),
  conan: ({ node, projectRoot }) => collectConanPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  conda: ({ node, projectRoot }) => collectCondaPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    resolved: node.resolved,
    projectRoot
  }),
  cpan: ({ node, projectRoot }) => collectCpanPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    resolved: node.resolved,
    projectRoot
  }),
  cran: ({ node, projectRoot }) => collectRPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  gem: ({ node, projectRoot }) => collectRubyGemEvidence({
    packageId: node.id,
    gemName: node.name,
    version: node.version,
    projectRoot
  }),
  go: ({ node, projectRoot }) => collectGoModuleEvidence({
    packageId: node.id,
    modulePath: node.name,
    version: node.version,
    resolved: node.resolved,
    projectRoot
  }),
  hackage: ({ node, projectRoot }) => collectHackagePackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  helm: ({ node, projectRoot }) => collectHelmChartEvidence({
    packageId: node.id,
    chartName: node.installNames?.[0] ?? node.name,
    version: node.version,
    projectRoot
  }),
  hex: ({ node, projectRoot }) => collectHexPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  }),
  julia: ({ node, projectRoot }) => collectJuliaPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  luarocks: ({ node, projectRoot }) => collectLuarocksPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  maven: ({ node, projectRoot }) => collectMavenPackageEvidence({
    packageId: node.id,
    coordinates: node.name,
    version: node.version,
    projectRoot
  }),
  nix: ({ node, projectRoot }) => collectNixPackageEvidence({
    packageId: node.id,
    resolved: node.resolved,
    projectRoot
  }),
  nuget: ({ node, projectRoot }) => collectNugetPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  pub: ({ node, projectRoot }) => collectPubPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  pypi: ({ node, projectRoot }) => collectPythonPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  swift: ({ node, projectRoot }) => collectSwiftPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  }),
  terraform: ({ node, projectRoot }) => collectTerraformProviderEvidence({
    packageId: node.id,
    sourceAddress: node.name,
    version: node.version,
    projectRoot
  }),
  unity: ({ node, projectRoot }) => collectUnityPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    version: node.version,
    projectRoot
  }),
  vcpkg: ({ node, projectRoot }) => collectVcpkgPackageEvidence({
    packageId: node.id,
    packageName: node.name,
    projectRoot
  })
};

export function collectEcosystemEvidence(
  input: EcosystemEvidenceInput
): Result<LicenseEvidence, OhriskError> | undefined {
  const collector = ECOSYSTEM_EVIDENCE_COLLECTORS[input.node.ecosystem];
  return collector?.(input);
}
