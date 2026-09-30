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
  | "swift"
  | "zig";

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

export type DependencyArtifact = {
  resolved?: string;
  integrity?: string;
  yarnCacheChecksum?: string;
  goModIntegrity?: string;
};

export type DependencyNode = {
  id: string;
  name: string;
  version: string;
  ecosystem: PackageEcosystem;
  installNames?: string[];
  resolved?: string;
  integrity?: string;
  /** Internal checksum for Yarn Berry's normalized cache ZIP. */
  yarnCacheChecksum?: string;
  /** Internal checksum for the module's standalone go.mod response. */
  goModIntegrity?: string;
  /** Source artifact declarations retained for deterministic multi-input merging. */
  artifactVariants?: DependencyArtifact[];
  /** No single artifact is justified by the input declarations. */
  artifactIdentityConflict?: true;
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

export type DependencyEdge = {
  /** Omitted for a dependency declared by the project root. */
  from?: string;
  to: string;
  dependencyType: DependencyType;
  origins?: DependencyOrigin[];
};

export type DependencyGraph = {
  rootName?: string;
  lockfilePath: string;
  lockfilePaths?: string[];
  mavenRepositoryUrls?: string[];
  nodes: DependencyNode[];
  /** Source relationships, independent of bounded explanatory paths. */
  edges?: DependencyEdge[];
  /** Nodes whose outgoing relationships are not known to be exhaustive. */
  unknownDependencyNodeIds?: string[];
  rootDependenciesUnknown?: boolean;
  embeddedEvidence?: LicenseEvidence[];
  warnings?: string[];
  diagnostics?: DependencyGraphDiagnostic[];
};
