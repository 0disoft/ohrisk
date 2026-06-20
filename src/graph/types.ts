export type PackageEcosystem =
  | "npm"
  | "pypi"
  | "maven";

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
};
