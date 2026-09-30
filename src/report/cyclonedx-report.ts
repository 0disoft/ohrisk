import path from "node:path";
import { buildScanCompleteness, type ScanCompleteness } from "../policy/completeness";
import { projectInputSupport } from "../ecosystems/registry";
import type { LicenseEvidence } from "../evidence/types";

import type { DependencyEdge, DependencyGraph, DependencyNode } from "../graph/types";
import { dependencyEdgesForGraph } from "../graph/dependency-edges";
import type { NormalizedLicense } from "../license/types";
import type { RiskFinding } from "../policy/types";
import type { ProjectInput } from "../project/discover";
import { packageUrl } from "./package-url";
import type { RemoteRepositoryReportSource } from "./scan-report";
import type { GraphGateOutcome } from "../../types/report-types";

export type CycloneDxReportInput = {
  project: ProjectInput;
  graph: DependencyGraph;
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  waiverMode: "local" | "ignored";
  repository?: RemoteRepositoryReportSource;
  evidence?: LicenseEvidence[];
  completeness?: ScanCompleteness;
  graphGate?: GraphGateOutcome;
};

type CycloneDxComponent = {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  scope: "required" | "optional" | "excluded";
  licenses?: Array<
    | {
        expression: string;
      }
    | {
        license: {
          id?: string;
          name?: string;
        };
      }
  >;
  properties: Array<{
    name: string;
    value: string;
  }>;
};

export function renderCycloneDxReport(input: CycloneDxReportInput): string {
  const licensesByPackageId = new Map(
    input.normalizedLicenses.map((license) => [license.packageId, license])
  );
  const findingsByPackageId = new Map(
    input.riskFindings.map((finding) => [finding.packageId, finding])
  );
  const edges = dependencyEdgesForGraph(input.graph);
  const childRefsByNodeId = directChildRefsByNodeId(input.graph.nodes, edges);
  const nodeById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const rootChildRefs = [...new Set(edges.filter((edge) => edge.from === undefined).flatMap((edge) => {
    const node = nodeById.get(edge.to);
    return node ? [componentBomRef(node)] : [];
  }))].sort();
  const rootDependenciesUnknown = input.graph.edges === undefined || input.graph.rootDependenciesUnknown === true;
  const unknownIds = new Set(input.graph.edges === undefined
    ? input.graph.nodes.map((node) => node.id)
    : input.graph.unknownDependencyNodeIds ?? []);
  const unknownRefs = input.graph.nodes.filter((node) => unknownIds.has(node.id)).map(componentBomRef);
  if (rootDependenciesUnknown) unknownRefs.unshift("project");

  const components = input.graph.nodes.map((node) =>
    renderComponent({
      node,
      license: licensesByPackageId.get(node.id),
      finding: findingsByPackageId.get(node.id)
    })
  );

  return JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        component: {
          type: "application",
          name: input.graph.rootName ?? "project",
          "bom-ref": "project"
        },
        properties: [
          { name: "ohrisk:inputSupport", value: JSON.stringify(projectInputSupport(input.project)) },
          ...(input.graphGate ? [{ name: "ohrisk:graphGate", value: JSON.stringify(input.graphGate) }] : []),
          {
            name: "ohrisk:completeness",
            value: JSON.stringify(input.completeness ?? buildScanCompleteness({
              ...input, evidence: input.evidence ?? []
            }))
          },
          {
            name: "ohrisk:projectRoot",
            value: "."
          },
          {
            name: "ohrisk:lockfileKind",
            value: input.project.lockfile.kind
          },
          {
            name: "ohrisk:lockfilePath",
            value: projectInputPath(input.project, input.project.lockfile.path)
          },
          {
            name: "ohrisk:waiverMode",
            value: input.waiverMode
          },
          ...repositoryProperties(input.repository),
          ...archiveProperties(input.project)
        ]
      },
      components,
      dependencies: [
        ...(!rootDependenciesUnknown || rootChildRefs.length > 0 ? [{
          ref: "project",
          dependsOn: rootChildRefs
        }] : []),
        ...input.graph.nodes.filter((node) =>
          !unknownIds.has(node.id) || (childRefsByNodeId.get(node.id)?.length ?? 0) > 0).map((node) => ({
          ref: componentBomRef(node),
          dependsOn: childRefsByNodeId.get(node.id) ?? []
        }))
      ],
      ...(unknownRefs.length > 0 ? { compositions: [{ aggregate: "unknown", dependencies: unknownRefs }] } : {})
    },
    null,
    2
  );
}

function repositoryProperties(
  repository: RemoteRepositoryReportSource | undefined
): Array<{ name: string; value: string }> {
  if (!repository) {
    return [];
  }
  return [
    { name: "ohrisk:repositoryOwner", value: repository.owner },
    { name: "ohrisk:repositoryName", value: repository.name },
    { name: "ohrisk:submoduleMode", value: repository.submodules.mode },
    {
      name: "ohrisk:skippedSubmoduleCount",
      value: String(repository.submodules.skippedCount)
    },
    {
      name: "ohrisk:skippedSubmodulePaths",
      value: JSON.stringify(repository.submodules.skippedPaths)
    },
    {
      name: "ohrisk:submodulePathsTruncated",
      value: String(repository.submodules.pathsTruncated)
    },
    {
      name: "ohrisk:skippedSymbolicLinkCount",
      value: String(repository.symbolicLinks.skippedCount)
    },
    {
      name: "ohrisk:skippedSymbolicLinkPaths",
      value: JSON.stringify(repository.symbolicLinks.skippedPaths)
    },
    {
      name: "ohrisk:symbolicLinkPathsTruncated",
      value: String(repository.symbolicLinks.pathsTruncated)
    },
    {
      name: "ohrisk:skippedNonPortablePathCount",
      value: String(repository.nonPortablePaths.skippedCount)
    },
    {
      name: "ohrisk:skippedNonPortablePaths",
      value: JSON.stringify(repository.nonPortablePaths.skippedPaths)
    },
    {
      name: "ohrisk:nonPortablePathsTruncated",
      value: String(repository.nonPortablePaths.pathsTruncated)
    }
  ];
}

function projectInputPath(project: ProjectInput, targetPath: string): string {
  const relativePath = projectRelativePath(project.rootDir, targetPath);
  if (!project.source) {
    return relativePath;
  }
  const root = project.source.entryRoot === "." ? "" : `${project.source.entryRoot}/`;
  return `${project.source.displayPath}!/${root}${relativePath}`;
}

function archiveProperties(project: ProjectInput): Array<{ name: string; value: string }> {
  if (!project.source) {
    return [];
  }
  return [
    { name: "ohrisk:archiveName", value: project.source.displayPath },
    { name: "ohrisk:archiveFormat", value: project.source.format },
    { name: "ohrisk:archiveSha256", value: project.source.sha256 },
    { name: "ohrisk:archiveRoot", value: project.source.entryRoot }
  ];
}

function projectRelativePath(projectRoot: string, targetPath: string): string {
  const relativePath = path.relative(projectRoot, targetPath);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  ) {
    return relativePath.replace(/\\/g, "/");
  }

  return path.basename(targetPath);
}

function renderComponent(input: {
  node: DependencyNode;
  license: NormalizedLicense | undefined;
  finding: RiskFinding | undefined;
}): CycloneDxComponent {
  const licenses = input.license ? renderLicenses(input.license) : [];

  return {
    type: "library",
    "bom-ref": componentBomRef(input.node),
    name: input.node.name,
    version: input.node.version,
    purl: packageUrl(input.node),
    scope: componentScope(input.node),
    ...(licenses.length > 0 ? { licenses } : {}),
    properties: [
      {
        name: "ohrisk:ecosystem",
        value: input.node.ecosystem
      },
      {
        name: "ohrisk:dependencyType",
        value: input.node.dependencyType
      },
      {
        name: "ohrisk:direct",
        value: String(input.node.direct)
      },
      ...(input.license
        ? [
            {
              name: "ohrisk:licenseConfidence",
              value: input.license.confidence
            },
            {
              name: "ohrisk:licenseSignals",
              value: input.license.signals.join(",")
            }
          ]
        : []),
      ...(input.finding
        ? [
            {
              name: "ohrisk:findingId",
              value: input.finding.id
            },
            {
              name: "ohrisk:fingerprint",
              value: input.finding.fingerprint
            },
            ...(input.finding.decision ? [{ name: "ohrisk:decision", value: JSON.stringify(input.finding.decision) }] : []),
            ...(input.finding.evidenceFingerprint ? [{ name: "ohrisk:evidenceFingerprint", value: input.finding.evidenceFingerprint }] : []),
            {
              name: "ohrisk:riskSeverity",
              value: input.finding.severity
            },
            {
              name: "ohrisk:recommendation",
              value: input.finding.recommendation
            },
            {
              name: "ohrisk:action",
              value: input.finding.action
            }
          ]
        : [])
    ]
  };
}

function renderLicenses(
  license: NormalizedLicense
): NonNullable<CycloneDxComponent["licenses"]> {
  if (license.expression) {
    return [{ expression: license.expression }];
  }

  if (license.choices.length > 0) {
    return license.choices.map((choice) => ({
      license: {
        id: choice
      }
    }));
  }

  if (license.original) {
    return [
      {
        license: {
          name: license.original
        }
      }
    ];
  }

  return [];
}

function componentBomRef(node: DependencyNode): string {
  return packageUrl(node);
}

function componentScope(node: DependencyNode): "required" | "optional" | "excluded" {
  switch (node.dependencyType) {
    case "development":
      return "excluded";
    case "optional":
    case "peer":
      return "optional";
    case "production":
    case "unknown":
      return "required";
  }
}

function directChildRefsByNodeId(nodes: DependencyNode[], edges: DependencyEdge[]): Map<string, string[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childIdsByNodeId = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.from === undefined || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const childIds = childIdsByNodeId.get(edge.from) ?? new Set<string>();
    childIds.add(edge.to);
    childIdsByNodeId.set(edge.from, childIds);
  }

  const childRefsByNodeId = new Map<string, string[]>();
  for (const [nodeId, childIds] of childIdsByNodeId.entries()) {
    const childRefs = [...childIds]
      .sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0))
      .flatMap((childId) => {
        const childNode = nodeById.get(childId);
        return childNode ? [componentBomRef(childNode)] : [];
      });
    childRefsByNodeId.set(nodeId, childRefs);
  }

  return childRefsByNodeId;
}
