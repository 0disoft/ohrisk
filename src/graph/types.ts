import type { LicenseEvidence } from "../evidence/types";

export type PackageEcosystem =
  | "npm"
  | "pypi"
  | "maven"
  | "cargo"
  | "go"
  | "nuget"
  | "conan"
  | "conda"
  | "vcpkg"
  | "bazel"
  | "terraform"
  | "helm"
  | "nix"
  | "unity"
  | "cran"
  | "julia"
  | "hackage"
  | "cpan"
  | "luarocks"
  | "carthage"
  | "cocoapods"
  | "hex"
  | "gem"
  | "composer"
  | "pub"
  | "swift";

export type DependencyType =
  | "production"
  | "development"
  | "optional"
  | "peer"
  | "unknown";

export type DependencyOrigin = {
  lockfileKind: string;
  lockfilePath: string;
};

export type DependencyNode = {
  id: string;
  name: string;
  version: string;
  ecosystem: PackageEcosystem;
  installNames?: string[];
  resolved?: string;
  integrity?: string;
  dependencyType: DependencyType;
  direct: boolean;
  paths: string[][];
  origins?: DependencyOrigin[];
};

export type DependencyGraphDiagnostic = {
  code: "dependency_paths_truncated" | "dependency_path_depth_summarized";
  affectedNodeCount: number;
  limit: number;
  message: string;
};

export type DependencyGraph = {
  rootName?: string;
  lockfilePath: string;
  lockfilePaths?: string[];
  mavenRepositoryUrls?: string[];
  nodes: DependencyNode[];
  embeddedEvidence?: LicenseEvidence[];
  warnings?: string[];
  diagnostics?: DependencyGraphDiagnostic[];
};
