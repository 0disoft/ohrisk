import { expect, test } from "bun:test";
import { parsePackageUrl, packageUrl } from "../src/graph/package-url";
import { parseCycloneDxJsonText } from "../src/graph/cyclonedx-json";
import { parseSpdxJsonText } from "../src/graph/spdx-json";
import { mergeDependencyGraphs } from "../src/graph/merge";
import { normalizeAllLicenseEvidence } from "../src/license/normalize";
import { evaluateLicenseRisks } from "../src/policy/evaluate";
import { renderCycloneDxReport } from "../src/report/cyclonedx-report";
import type { DependencyGraph } from "../src/graph/types";

test("PURL qualifiers and subpaths produce stable identities without changing ordinary IDs", () => {
  const first = parsePackageUrl("pkg:npm/example@1.0.0?distro=linux&arch=x64#src/./main.js")!;
  const second = parsePackageUrl("pkg:npm/example@1.0.0?arch=x64&distro=linux#src/main.js")!;
  expect(first.id).toBe("pkg:npm/example@1.0.0?arch=x64&distro=linux#src/main.js");
  expect(first.id).toBe(second.id);
  expect(packageUrl({ ...first, dependencyType: "production", direct: true, paths: [] })).toBe(first.id);
  expect(parsePackageUrl("pkg:npm/example@1.0.0")?.id).toBe("example@1.0.0");
  expect(parsePackageUrl("pkg:npm/example@1.0.0#src/other.js")?.id).not.toBe(first.id);
  expect(parsePackageUrl("pkg:npm/example@1?checksum=sha256%3AAA,sha1%3ABB")?.id)
    .toBe(parsePackageUrl("pkg:npm/example@1?checksum=sha1%3Abb,sha256%3Aaa")?.id);
});

for (const format of ["cyclonedx", "spdx"] as const) {
  test(`${format} keeps qualified packages, evidence, findings and output independent of merge order`, () => {
    const urls = ["pkg:npm/example@1.0.0?arch=x64", "pkg:npm/example@1.0.0?arch=arm64"];
    const document = format === "cyclonedx" ? {
      bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { name: "app", "bom-ref": "app" } },
      components: urls.map((purl, i) => ({ "bom-ref": `pkg-${i}`, purl, licenses: [{ expression: i ? "AGPL-3.0-only" : "MIT" }] })),
      dependencies: [{ ref: "app", dependsOn: ["pkg-0", "pkg-1"] }, { ref: "pkg-0", dependsOn: [] }, { ref: "pkg-1", dependsOn: [] }]
    } : {
      spdxVersion: "SPDX-2.3", name: "app", documentDescribes: ["SPDXRef-0", "SPDXRef-1"],
      packages: urls.map((purl, i) => ({ SPDXID: `SPDXRef-${i}`, name: "example", licenseDeclared: i ? "AGPL-3.0-only" : "MIT",
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl }] }))
    };
    const result = format === "cyclonedx" ? parseCycloneDxJsonText(JSON.stringify(document)) : parseSpdxJsonText(JSON.stringify(document));
    if (!result.ok) throw new Error(result.error.message);
    const graph = result.value;
    expect(graph.nodes).toHaveLength(2);
    const sources = graph.nodes.map((node) => ({ graph: { ...graph, nodes: [node],
      embeddedEvidence: graph.embeddedEvidence?.filter((item) => item.packageId === node.id) } as DependencyGraph,
      source: { lockfileKind: format === "cyclonedx" ? "cyclonedx-json" as const : "spdx-json" as const, lockfilePath: `${node.id}.json` } }));
    const merged = mergeDependencyGraphs(sources);
    expect(merged.nodes).toEqual(mergeDependencyGraphs([...sources].reverse()).nodes);
    const licenses = normalizeAllLicenseEvidence(merged.embeddedEvidence ?? []);
    const findings = evaluateLicenseRisks({ licenses, dependencies: merged.nodes, profile: "saas" });
    expect(findings.find((finding) => finding.packageId.endsWith("arch=arm64"))?.severity).toBe("high");
    expect(findings.find((finding) => finding.packageId.endsWith("arch=x64"))?.severity).toBe("low");
    const report = JSON.parse(renderCycloneDxReport({
      project: { rootDir: "/app", lockfile: { kind: "cyclonedx-json", path: "/app/bom.json" } },
      graph, normalizedLicenses: licenses, riskFindings: findings, waiverMode: "ignored"
    }));
    expect(report.components.map((item: { purl: string }) => item.purl).sort()).toEqual([...urls].sort());
  });
}

test("equivalent qualifier order shares a node while different subpaths remain separate", () => {
  const urls = ["pkg:npm/example@1?distro=linux&arch=x64#LICENSE", "pkg:npm/example@1?arch=x64&distro=linux#LICENSE",
    "pkg:npm/example@1?arch=x64&distro=linux#vendor/LICENSE"];
  const result = parseCycloneDxJsonText(JSON.stringify({ bomFormat: "CycloneDX", components: urls.map((purl, i) => ({ "bom-ref": `ref-${i}`, purl })) }));
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.nodes).toHaveLength(2);
});

test("qualified PURL identities omit authentication attributes and credentials from URL qualifiers", () => {
  const input = "pkg:npm/example@1?arch=x64&api_key=fixture-key&repository_url="
    + encodeURIComponent("https://fixture-user:fixture-password@registry.example/project?token=fixture-token#private");
  const result = parseCycloneDxJsonText(JSON.stringify({ bomFormat: "CycloneDX", components: [{ purl: input, licenses: [{ expression: "MIT" }] }] }));
  if (!result.ok) throw new Error(result.error.message);
  const serialized = JSON.stringify(result.value);
  for (const secret of ["fixture-key", "fixture-user", "fixture-password", "fixture-token", "private"]) expect(serialized).not.toContain(secret);
  expect(result.value.nodes[0]?.id).toBe("pkg:npm/example@1?arch=x64&repository_url=https%3A%2F%2Fregistry.example%2Fproject");
});
