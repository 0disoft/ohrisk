import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderInputSupportDocumentation } from "../scripts/input-support-docs";
import { ecosystemAdapterForLockfile, inputSupportForLockfile, registerEcosystemAdapter } from "../src/ecosystems/registry";
import { validInputSupport } from "../src/ecosystems/input-support";
import { supportedLockfileKinds } from "../src/project/discover";
import { renderScanReport, type ScanReportInput } from "../src/report/scan-report";
import { renderSarifReport } from "../src/report/sarif-report";
import { renderCycloneDxReport } from "../src/report/cyclonedx-report";
import { parseSwiftPackageResolvedText } from "../src/graph/swift-package-resolved";

test("every supported input declares its exact support boundary and docs stay synchronized", () => {
  for (const kind of supportedLockfileKinds()) expect(validInputSupport(inputSupportForLockfile(kind)), kind).toBe(true);
  expect(readFileSync(path.resolve(import.meta.dir, "../docs/input-support.md"), "utf8")).toBe(renderInputSupportDocumentation());
  expect(inputSupportForLockfile("unknown-format")).toBeUndefined();
  expect(inputSupportForLockfile("package-json")?.relationships).toBe("direct-only");
  expect(inputSupportForLockfile("package-lock")?.relationships).toBe("source-edges");
  expect(inputSupportForLockfile("requirements-txt")?.developmentScope).toBe("unavailable");
});

test("adapter replacement owns its support declaration and rejects missing or invalid scope", () => {
  const base = ecosystemAdapterForLockfile("package-lock")!;
  expect(() => registerEcosystemAdapter({ ...base, support: {} }, { replace: true })).toThrow("declare support");
  expect(validInputSupport({ relationships: "all", developmentScope: "declared", artifactPins: "checksums" })).toBe(false);
  const inherited = Object.assign(Object.create({ relationships: "inventory", developmentScope: "unavailable", artifactPins: "none" }), { one: 1, two: 2, three: 3 });
  expect(validInputSupport(inherited)).toBe(false);
  const restore = registerEcosystemAdapter({ ...base, lockfileKinds: ["package-lock"], support: {
    "package-lock": { relationships: "inventory", developmentScope: "unavailable", artifactPins: "none" }
  } }, { replace: true });
  try {
    expect(inputSupportForLockfile("package-lock")?.relationships).toBe("inventory");
    expect(inputSupportForLockfile("npm-shrinkwrap")?.relationships).toBe("source-edges");
  } finally { restore(); }
  expect(inputSupportForLockfile("package-lock")?.relationships).toBe("source-edges");
});

test("a revision used as a package coordinate is not advertised as a retained artifact pin", () => {
  const graph = parseSwiftPackageResolvedText(JSON.stringify({ version: 2, pins: [{
    identity: "example", kind: "remoteSourceControl", location: "https://github.com/example/example.git",
    state: { version: "1.0.0", revision: "a".repeat(40) }
  }] }));
  if (!graph.ok) throw new Error(graph.error.message);
  expect(graph.value.nodes[0]?.integrity).toBeUndefined();
  expect(graph.value.nodes[0]?.resolved).toBeUndefined();
  expect(inputSupportForLockfile("swift-package-resolved")?.artifactPins).toBe("none");
  expect(inputSupportForLockfile("cartfile-resolved")?.artifactPins).toBe("none");
});

test("JSON, SARIF, CycloneDX and human summaries agree on capability without asserting verification", () => {
  const input: ScanReportInput = {
    project: { rootDir: "/app", lockfile: { kind: "package-lock", path: "/app/package-lock.json" } },
    graph: { lockfilePath: "/app/package-lock.json", nodes: [] }, evidence: [], normalizedLicenses: [], riskFindings: [],
    profile: "saas", prodOnly: false, json: true, markdown: false, html: false,
    waiverMode: "ignored", waivedFindings: [], expiredWaivers: [], unmatchedWaivers: []
  };
  const report = JSON.parse(renderScanReport(input));
  const expected = [{ kind: "package-lock", support: { relationships: "source-edges", developmentScope: "declared", artifactPins: "checksums" } }];
  expect(report.lockfiles.map(({ kind, support }: { kind: string; support: unknown }) => ({ kind, support }))).toEqual(expected);
  expect(report.completeness.dimensions.graph.status).toBe("unknown");
  expect(JSON.parse(renderSarifReport(input)).runs[0].properties.ohriskInputSupport).toEqual(expected);
  const bom = JSON.parse(renderCycloneDxReport(input));
  expect(JSON.parse(bom.metadata.properties.find((entry: { name: string }) => entry.name === "ohrisk:inputSupport").value)).toEqual(expected);
  expect(renderScanReport({ ...input, json: false })).toContain("Input support: package-lock: relationships source-edges");
  expect(renderScanReport({ ...input, json: false, markdown: true })).toContain("artifact pins checksums");
  expect(renderScanReport({ ...input, json: false, html: true })).toContain("input support: package-lock");
});
