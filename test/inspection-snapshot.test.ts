import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli/main";
import { parseArgs } from "../src/cli/args";
import { digest, readInspectionSnapshot } from "../src/snapshot/inspection-snapshot";
import { JsonSchemaRegistry } from "./support/json-schema-validator";
import schema from "../schemas/inspection-snapshot.schema.json";

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ohrisk-snapshot-"));
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "sample", lockfileVersion: 3,
    packages: { "": { dependencies: { sample: "1.0.0" } }, "node_modules/sample": { version: "1.0.0", license: "MIT" } } }));
  mkdirSync(path.join(root, "node_modules/sample"), { recursive: true });
  writeFileSync(path.join(root, "node_modules/sample/package.json"), JSON.stringify({ name: "sample", version: "1.0.0", license: "MIT" }));
  return root;
}
async function run(root: string, args: string[]) {
  const stdout: string[] = [], stderr: string[] = [];
  const code = await main(args, { cwd: root, env: {}, stdout: (v) => stdout.push(v), stderr: (v) => stderr.push(v), systemLocale: () => "en-US" });
  return { code, stdout, stderr };
}

test("snapshots reevaluate saved evidence after dependency files disappear and new policy changes the gate", async () => {
  const root = project();
  try {
    const original = await run(root, ["scan", "--offline", "--json", "--snapshot", "saved.json"]);
    expect(original.code).toBe(0);
    const saved = readInspectionSnapshot(path.join(root, "saved.json"));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw Error(saved.error.message);
    expect(new JsonSchemaRegistry([schema]).validate(schema.$id, saved.value)).toEqual([]);
    expect(saved.value.payload.inputs[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(saved.value)).not.toContain(root);
    rmSync(path.join(root, "node_modules"), { recursive: true });
    rmSync(path.join(root, "package-lock.json"));
    const replay = await run(root, ["scan", "--from-snapshot", "saved.json", "--json", "--no-waivers"]);
    expect(replay.code).toBe(0);
    expect(JSON.parse(replay.stdout[0]!).findings).toEqual(JSON.parse(original.stdout[0]!).findings);
    writeFileSync(path.join(root, ".ohrisk.yml"), "version: 1\nlicenses:\n  deny: [MIT]\n");
    const denied = await run(root, ["ci", "--from-snapshot", "saved.json", "--json", "--no-waivers", "--snapshot", "new.json"]);
    expect(denied.code).toBe(1);
    expect(denied.stderr.join("\n")).toContain("policy changed");
    expect(JSON.parse(readFileSync(path.join(root, "new.json"), "utf8")).payload.replayedFrom).toBe(saved.value.payloadSha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("snapshot integrity, graph references and evidence completeness are validated even with a recomputed digest", async () => {
  const root = project();
  try {
    await run(root, ["scan", "--offline", "--snapshot", "saved.json"]);
    const original = JSON.parse(readFileSync(path.join(root, "saved.json"), "utf8"));
    for (const mutate of [
      (v: typeof original) => { v.payload.evidence = []; },
      (v: typeof original) => { v.payload.graph.edges = [{ to: "missing", dependencyType: "production" }]; },
      (v: typeof original) => { v.payload.evidence[0].files = [{ path: "a", kind: "license", text: 123 }]; },
      (v: typeof original) => { v.payload.graph.nodes[0].dependencyType = "invalid"; }
    ]) {
      const value = structuredClone(original);
      mutate(value); value.payloadSha256 = digest(JSON.stringify(value.payload));
      writeFileSync(path.join(root, "bad.json"), JSON.stringify(value));
      expect((await run(root, ["scan", "--from-snapshot", "bad.json"])).code).toBe(2);
    }
    original.payload.graph.nodes[0].version = "2.0.0";
    writeFileSync(path.join(root, "bad.json"), JSON.stringify(original));
    expect(readInspectionSnapshot(path.join(root, "bad.json")).ok).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production-only snapshots cannot silently broaden scope and unavailable evidence still fails CI", async () => {
  const root = project();
  try {
    await run(root, ["scan", "--offline", "--prod", "--snapshot", "prod.json"]);
    expect((await run(root, ["scan", "--from-snapshot", "prod.json"])).code).toBe(2);
    expect((await run(root, ["scan", "--from-snapshot", "prod.json", "--prod"])).code).toBe(0);
    rmSync(path.join(root, "node_modules"), { recursive: true });
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "sample", lockfileVersion: 3,
      packages: { "": { dependencies: { sample: "1.0.0" } }, "node_modules/sample": { version: "1.0.0", resolved: "https://registry.npmjs.org/sample/-/sample-1.0.0.tgz" } } }));
    await run(root, ["scan", "--offline", "--snapshot", "partial.json"]);
    expect((await run(root, ["ci", "--from-snapshot", "partial.json", "--json"])).code).toBe(1);
    expect((await run(root, ["ci", "--from-snapshot", "partial.json", "--allow-partial-evidence", "--json"])).code).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("replay rejects fresh dependency input and registry options", () => {
  for (const extra of [["--lockfile", "package-lock.json"], ["--archive", "a.zip"], ["--all"], ["--registry-url", "https://registry.npmjs.org"]]) {
    expect(parseArgs(["scan", "--from-snapshot", "saved.json", ...extra]).ok).toBe(false);
  }
});

test("cancelled replay writes no new snapshot and supported two MiB license text remains readable", async () => {
  const root = project();
  try {
    await run(root, ["scan", "--offline", "--snapshot", "saved.json"]);
    const code = await main(["scan", "--from-snapshot", "saved.json", "--snapshot", "cancelled.json"], {
      cwd: root, env: {}, signal: AbortSignal.abort(), stdout: () => {}, stderr: () => {}
    });
    expect(code).toBe(130);
    expect(existsSync(path.join(root, "cancelled.json"))).toBe(false);
    const saved = JSON.parse(readFileSync(path.join(root, "saved.json"), "utf8"));
    saved.payload.evidence[0].files = [{ path: "LICENSE", kind: "license", text: "x".repeat(2 * 1024 * 1024) }];
    saved.payloadSha256 = digest(JSON.stringify(saved.payload));
    writeFileSync(path.join(root, "large.json"), JSON.stringify(saved));
    expect(readInspectionSnapshot(path.join(root, "large.json")).ok).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
