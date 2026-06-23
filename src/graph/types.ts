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
};

export type DependencyGraph = {
  rootName?: string;
  lockfilePath: string;
  nodes: DependencyNode[];
  embeddedEvidence?: LicenseEvidence[];
};
