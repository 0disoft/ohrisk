import type { LicenseEvidence } from "../evidence/types";
import { refineGoDependencyScopes } from "../graph/go-scope";
import {
  BOUNDED_PATHS_MAX_PATH_DEPTH, BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS, BOUNDED_PATHS_TRUNCATED_SEGMENT
} from "../graph/bounded-dependency-paths";
import type { DependencyGraph, DependencyNode } from "../graph/types";
import { normalizeAllLicenseEvidence } from "../license/normalize";
import type { NormalizedLicense } from "../license/types";
import type {
  PolicyConfigSummary,
  ResolvedPolicyConfig
} from "../policy/config";
import { summarizePolicyConfig } from "../policy/config";
import { evaluateLicenseRisks } from "../policy/evaluate";
import type { UsageProfile } from "../policy/profiles";
import type { RiskFinding } from "../policy/types";
import {
  applyRiskWaivers,
  readRiskWaivers,
  type RiskWaiver,
  type WaivedRiskFinding
} from "../policy/waivers";
import type { ProjectInput } from "../project/discover";
import type { OhriskError } from "../shared/errors";
import { isErr, ok, type Result } from "../shared/result";

export type ScanResult = {
  project: ProjectInput;
  graph: DependencyGraph;
  evidence: LicenseEvidence[];
  normalizedLicenses: NormalizedLicense[];
  riskFindings: RiskFinding[];
  waivedFindings: WaivedRiskFinding[];
  expiredWaivers: RiskWaiver[];
  unmatchedWaivers: RiskWaiver[];
  policy: PolicyConfigSummary;
};

export function evaluateScanPolicyAndWaivers(input: {
  project: ProjectInput;
  collectionGraph: DependencyGraph;
  evidence: LicenseEvidence[];
  profile: UsageProfile;
  policy: ResolvedPolicyConfig;
  prodOnly: boolean;
  applyWaivers: boolean;
  configurationRoot?: string;
}): Result<ScanResult, OhriskError> {
  const graph = filterGraphForProdOnly(
    refineGoDependencyScopes(input.collectionGraph, input.evidence),
    input.prodOnly
  );
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const evidence = input.evidence.filter((item) => nodeIds.has(item.packageId));
  const normalizedLicenses = normalizeAllLicenseEvidence(evidence);
  const riskFindings = evaluateLicenseRisks({
    licenses: normalizedLicenses,
    dependencies: graph.nodes,
    profile: input.profile,
    policy: input.policy
  });
  const policy = summarizePolicyConfig(input.policy);

  if (!input.applyWaivers) {
    return ok({
      project: input.project,
      graph,
      evidence,
      normalizedLicenses,
      riskFindings,
      waivedFindings: [],
      expiredWaivers: [],
      unmatchedWaivers: [],
      policy
    });
  }

  const waivers = readRiskWaivers(input.configurationRoot ?? input.project.rootDir);
  if (isErr(waivers)) {
    return waivers;
  }

  const appliedWaivers = applyRiskWaivers({
    findings: riskFindings,
    waivers: waivers.value
  });

  return ok({
    project: input.project,
    graph,
    evidence,
    normalizedLicenses,
    riskFindings: appliedWaivers.activeFindings,
    waivedFindings: appliedWaivers.waivedFindings,
    expiredWaivers: appliedWaivers.expiredWaivers,
    unmatchedWaivers: appliedWaivers.unmatchedWaivers,
    policy
  });
}

export function hasWaiverDrift(input: {
  expiredWaivers: unknown[];
  unmatchedWaivers: unknown[];
}): boolean {
  return input.expiredWaivers.length > 0 || input.unmatchedWaivers.length > 0;
}

export function filterGraphForProdOnly(
  graph: DependencyGraph,
  prodOnly: boolean
): DependencyGraph {
  if (!prodOnly) {
    return graph;
  }

  const productionNodeIds = new Set(
    graph.nodes
      .filter(isProductionRelevantDependency)
      .map((node) => node.id)
  );
  const dependencyPathSegments = dependencyPathSegmentSets(graph.nodes, productionNodeIds);
  const productionParents = graph.edges === undefined ? undefined : productionParentsFromEdges(graph, productionNodeIds);
  const relationshipsUnknown = graph.rootDependenciesUnknown === true
    || (graph.unknownDependencyNodeIds?.length ?? 0) > 0;
  const rootIds = new Set(graph.edges?.filter((edge) => edge.from === undefined
    && edge.dependencyType !== "development").map((edge) => edge.to));
  let recoveredSegmentBudget = BOUNDED_PATHS_MAX_STORED_PATH_SEGMENTS;
  let remainingNodes = graph.nodes.length;
  const nodes = graph.nodes
    .filter((node) => productionNodeIds.has(node.id))
    .filter((node) => productionParents === undefined || productionParents.has(node.id)
      || relationshipsUnknown)
    .map((node) => {
      remainingNodes -= 1;
      let paths = node.paths.filter((dependencyPath) =>
        isProductionRelevantPath(dependencyPath, dependencyPathSegments)
      );
      if (paths.length === 0 && productionParents?.has(node.id)) {
        const capacity = Math.max(3, recoveredSegmentBudget - remainingNodes * 3);
        const recovered = productionPath(graph.rootName ?? "<root>", node.id, productionParents, capacity);
        recoveredSegmentBudget -= recovered.length;
        paths = [recovered];
      }

      return {
        ...node,
        direct: productionParents === undefined
          ? paths.length === 0 ? node.direct : paths.some((dependencyPath) =>
            isDirectDependencyPath(dependencyPath, dependencyPathSegments.all))
          : rootIds.has(node.id) || (graph.rootDependenciesUnknown === true && node.direct),
        paths
      };
    });
  const nodeIds = new Set(nodes.map((node) => node.id));

  const embeddedEvidence = graph.embeddedEvidence?.filter((evidence) =>
    nodeIds.has(evidence.packageId)
  );
  return {
    ...graph,
    nodes,
    ...filteredRelationships(graph, nodeIds, true),
    ...(embeddedEvidence ? { embeddedEvidence } : {})
  };
}

export function filterGraphBeforeEvidence(
  graph: DependencyGraph,
  prodOnly: boolean
): DependencyGraph {
  if (!prodOnly) {
    return graph;
  }
  const productionGraph = filterGraphForProdOnly(graph, true);
  const productionNodesById = new Map(productionGraph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.flatMap((node) => {
    if (node.ecosystem === "go") {
      return [node];
    }
    const productionNode = productionNodesById.get(node.id);
    return productionNode ? [productionNode] : [];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const embeddedEvidence = graph.embeddedEvidence?.filter((item) => nodeIds.has(item.packageId));
  return {
    ...graph,
    nodes,
    ...filteredRelationships(graph, nodeIds, false),
    ...(embeddedEvidence ? { embeddedEvidence } : {})
  };
}

function productionParentsFromEdges(graph: DependencyGraph, candidateIds: Set<string>): Map<string, string | undefined> {
  const children = new Map<string, string[]>();
  const parents = new Map<string, string | undefined>();
  const queue: string[] = [];
  for (const edge of graph.edges ?? []) {
    if (edge.dependencyType === "development" || !candidateIds.has(edge.to)) continue;
    if (edge.from === undefined) {
      if (!parents.has(edge.to)) {
        parents.set(edge.to, undefined);
        queue.push(edge.to);
      }
    } else if (candidateIds.has(edge.from)) {
      const childIds = children.get(edge.from) ?? [];
      childIds.push(edge.to);
      children.set(edge.from, childIds);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    for (const child of children.get(current) ?? []) {
      if (!parents.has(child)) {
        parents.set(child, current);
        queue.push(child);
      }
    }
  }
  return parents;
}

function productionPath(rootName: string, nodeId: string, parents: Map<string, string | undefined>, capacity: number): string[] {
  const tail: string[] = [];
  let current: string | undefined = nodeId;
  const maxDepth = Math.max(1, Math.min(BOUNDED_PATHS_MAX_PATH_DEPTH, capacity - 2));
  while (current !== undefined && tail.length < maxDepth) {
    tail.push(current);
    current = parents.get(current);
  }
  return [rootName, ...(current === undefined ? [] : [BOUNDED_PATHS_TRUNCATED_SEGMENT]), ...tail.reverse()];
}

function filteredRelationships(graph: DependencyGraph, nodeIds: Set<string>, prodOnly: boolean): Partial<DependencyGraph> {
  return {
    ...(graph.unresolvedDependencies === undefined ? {} : {
      unresolvedDependencies: graph.unresolvedDependencies.filter((item) =>
        (item.from === undefined || nodeIds.has(item.from))
        && (!prodOnly || item.dependencyType !== "development"))
    }),
    ...(graph.edges === undefined ? {} : { edges: graph.edges.filter((edge) =>
      nodeIds.has(edge.to) && (edge.from === undefined || nodeIds.has(edge.from))
      && (!prodOnly || edge.dependencyType !== "development")) }),
    ...(graph.unknownDependencyNodeIds === undefined ? {} : {
      unknownDependencyNodeIds: graph.unknownDependencyNodeIds.filter((id) => nodeIds.has(id))
    })
  };
}

function isProductionRelevantDependency(node: DependencyNode): boolean {
  return node.dependencyType !== "development";
}

function dependencyPathSegmentSets(
  nodes: DependencyNode[],
  productionNodeIds: Set<string>
): {
  all: Set<string>;
  production: Set<string>;
} {
  const all = new Set<string>();
  const production = new Set<string>();

  for (const node of nodes) {
    all.add(node.id);
    if (productionNodeIds.has(node.id)) {
      production.add(node.id);
    }
    for (const installName of node.installNames ?? []) {
      const segment = `${installName} -> ${node.id}`;
      all.add(segment);
      if (productionNodeIds.has(node.id)) {
        production.add(segment);
      }
    }
  }

  return { all, production };
}

function isProductionRelevantPath(
  pathSegments: string[],
  dependencyPathSegments: { all: Set<string>; production: Set<string> }
): boolean {
  return pathSegments.slice(1).every((segment) =>
    !dependencyPathSegments.all.has(segment)
    || dependencyPathSegments.production.has(segment)
  );
}

function isDirectDependencyPath(
  pathSegments: string[],
  dependencyPathSegments: Set<string>
): boolean {
  return pathSegments.slice(1).filter((segment) => dependencyPathSegments.has(segment)).length <= 1;
}
