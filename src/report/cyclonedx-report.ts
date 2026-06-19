import type { DependencyGraph, DependencyNode } from "../graph/types";
import type { NormalizedLicense } from "../license/types";
import type { RiskFinding } from "../policy/types";
import type { ProjectInput } from "../project/discover";

export type CycloneDxReportInput = {
  project: ProjectInput;
  graph: DependencyGraph;
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  waiverMode: "local" | "ignored";
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
          {
            name: "ohrisk:projectRoot",
            value: input.project.rootDir
          },
          {
            name: "ohrisk:lockfileKind",
            value: input.project.lockfile.kind
          },
          {
            name: "ohrisk:lockfilePath",
            value: input.project.lockfile.path
          },
          {
            name: "ohrisk:waiverMode",
            value: input.waiverMode
          }
        ]
      },
      components,
      dependencies: [
        {
          ref: "project",
          dependsOn: components
            .filter((component) => component.properties.some(
              (property) => property.name === "ohrisk:direct" && property.value === "true"
            ))
            .map((component) => component["bom-ref"])
        },
        ...input.graph.nodes.map((node) => ({
          ref: componentBomRef(node),
          dependsOn: directChildRefs(node, input.graph.nodes)
        }))
      ]
    },
    null,
    2
  );
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

function packageUrl(node: DependencyNode): string {
  return `pkg:npm/${encodePurlName(node.name)}@${encodeURIComponent(node.version)}`;
}

function encodePurlName(name: string): string {
  return name.split("/").map((part) => encodeURIComponent(part)).join("/");
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

function directChildRefs(node: DependencyNode, nodes: DependencyNode[]): string[] {
  const childIds = new Set<string>();

  for (const candidate of nodes) {
    for (const path of candidate.paths) {
      const packagePath = path.map(packageIdFromPathSegment);
      const nodeIndex = packagePath.indexOf(node.id);
      const childId = nodeIndex >= 0 ? packagePath[nodeIndex + 1] : undefined;
      if (childId) {
        childIds.add(childId);
      }
    }
  }

  return nodes
    .filter((candidate) => childIds.has(candidate.id))
    .map((candidate) => componentBomRef(candidate));
}

function packageIdFromPathSegment(segment: string): string {
  return segment.split(" -> ").at(-1)?.trim() ?? segment;
}
