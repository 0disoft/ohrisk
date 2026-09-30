import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { collectGraphEvidence } from "../src/evidence/collect";
import type { DependencyGraph } from "../src/graph/types";
import { normalizeAllLicenseEvidence } from "../src/license/normalize";
import { evaluateLicenseRisks } from "../src/policy/evaluate";
import { renderScanReport, type ScanReportInput } from "../src/report/scan-report";
import { renderCycloneDxReport } from "../src/report/cyclonedx-report";
import { measureAsyncInspectionPhase, measureInspectionPhase, profileInspection } from "../src/shared/inspection-metrics";
import { createTarGz } from "../test/helpers/tar";

const PACKAGE_COUNT = 256;
const mode = process.argv[2];
if (!mode) {
  const outputRoot = path.resolve(".tmp/inspection-benchmark");
  mkdirSync(outputRoot, { recursive: true });
  const runRoot = mkdtempSync(path.join(outputRoot, "run-"));
  const results: unknown[] = [];
  try {
    for (const selected of ["cold", "warm", "offline"]) {
      const cacheRoot = path.join(runRoot, selected);
      if (selected !== "cold") worker("prime", cacheRoot);
      results.push(JSON.parse(worker(selected, cacheRoot)));
    }
    const output = { fixture: "256 independent npm TAR.GZ artifacts with MIT metadata and license text", jobs: 8,
      transport: "injected in-memory responses; no external network", runtime: process.version,
      platform: process.platform, architecture: process.arch,
      timing: "collect includes archive parsing and decompression; decompress is nested and must not be added to collect",
      memory: "fresh measured process per mode; fixture setup is included in process high-water RSS; priming runs separately",
      results };
    writeFileSync(path.join(outputRoot, "results.json"), JSON.stringify(output, null, 2) + "\n");
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } finally { rmSync(runRoot, { recursive: true, force: true }); }
} else {
  if (!["prime", "cold", "warm", "offline"].includes(mode) || !process.argv[3]) throw Error("Invalid benchmark mode.");
  const cacheRoot = path.resolve(process.argv[3]);
  const graph: DependencyGraph = { lockfilePath: "synthetic/package-lock.json", nodes: [], edges: [] };
  const artifacts = new Map<string, Buffer>();
  for (let index = 0; index < PACKAGE_COUNT; index += 1) {
    const name = `inspection-fixture-${index}`;
    const url = `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
    const bytes = createTarGz({ "package/package.json": JSON.stringify({ name, version: "1.0.0", license: "MIT" }),
      "package/LICENSE": "MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction.\n" });
    artifacts.set(url, bytes);
    graph.nodes.push({ id: `${name}@1.0.0`, name, version: "1.0.0", ecosystem: "npm", dependencyType: "production",
      direct: true, paths: [["synthetic", `${name}@1.0.0`]], resolved: url,
      integrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}` });
    graph.edges!.push({ to: `${name}@1.0.0`, dependencyType: "production" });
  }
  let requests = 0;
  const start = performance.now();
  const result = await profileInspection(async () => {
    const evidence = await measureAsyncInspectionPhase("collect", () => collectGraphEvidence({ graph, projectRoot: cacheRoot,
      cacheDir: path.join(cacheRoot, "cache"), offline: mode === "offline", allowLocalProjectEvidence: false,
      evidenceConcurrency: 8, fetchArtifact: async (url) => {
        requests += 1;
        if (mode === "offline") throw Error("Offline benchmark attempted a fetch.");
        const bytes = artifacts.get(url);
        if (!bytes) throw Error("Unexpected artifact request.");
        return new Response(new Uint8Array(bytes), { headers: { "cache-control": "max-age=3600", "content-length": String(bytes.length) } });
      } }));
    if (!evidence.ok) throw Error(evidence.error.message);
    if (evidence.value.length !== PACKAGE_COUNT || evidence.value.some((item) => item.source !== "tarball")) throw Error("Benchmark lost collected evidence.");
    const normalizedLicenses = measureInspectionPhase("normalize", () => normalizeAllLicenseEvidence(evidence.value));
    const riskFindings = evaluateLicenseRisks({ licenses: normalizedLicenses, dependencies: graph.nodes, profile: "saas", prodOnly: false });
    const report: ScanReportInput = { project: { rootDir: cacheRoot, lockfile: { kind: "package-lock", path: graph.lockfilePath } },
      graph, evidence: evidence.value, normalizedLicenses, riskFindings, profile: "saas", prodOnly: false,
      json: true, markdown: false, html: false, waiverMode: "ignored", waivedFindings: [], expiredWaivers: [], unmatchedWaivers: [] };
    const outputBytes = measureInspectionPhase("render", () => {
      const json = renderScanReport(report), html = renderScanReport({ ...report, json: false, html: true }), sbom = renderCycloneDxReport(report);
      return { json: Buffer.byteLength(json), html: Buffer.byteLength(html), cyclonedx: Buffer.byteLength(sbom) };
    });
    return outputBytes;
  });
  if ((mode === "warm" || mode === "offline") && requests !== 0) throw Error("Primed benchmark unexpectedly fetched artifacts.");
  const highWater = process.resourceUsage().maxRSS * 1024;
  process.stdout.write(JSON.stringify({ mode, packages: PACKAGE_COUNT, requests, totalMs: performance.now() - start,
    ...result.metrics, peakRssBytes: highWater > 0 ? highWater : result.metrics.peakSampledRssBytes,
    peakRssKind: highWater > 0 ? "process-high-water" : "phase-boundary-samples", outputBytes: result.value }) + "\n");
}
function worker(selected: string, cacheRoot: string): string {
  const run = spawnSync(process.execPath, [import.meta.path, selected, cacheRoot], { encoding: "utf8", shell: false, timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (run.status !== 0) throw Error(run.stderr || run.error?.message || "Benchmark worker failed.");
  return run.stdout;
}
