import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { registeredEcosystemAdapters } from "../src/ecosystems/registry";

export function renderInputSupportDocumentation(): string {
  const rows = registeredEcosystemAdapters().flatMap((adapter) => adapter.lockfileKinds.map((kind) => {
    const support = adapter.support[kind]!;
    return [kind, adapter.id, support.relationships, support.developmentScope, support.artifactPins];
  })).sort(([left], [right]) => left! < right! ? -1 : left === right ? 0 : 1);
  return [
    "# Input Support Contract", "",
    "This table describes the current parser and collector boundary. It does not certify a particular scan as complete or an artifact as verified.", "",
    "- `source-edges`: source relationships are retained independently of bounded display paths. Missing relationships and unresolved requests still affect the scan's graph dimension.",
    "- `bounded-paths`: relationships are reconstructed through explanatory paths, potentially using companion files or collected module metadata. Display limits can prevent exhaustive relationship reconstruction.",
    "- `direct-only`: the manifest contributes dependency declarations without a resolved transitive graph.",
    "- `inventory`: package records are available, but package-to-package relationships are not reconstructed.",
    "- Development scope is `declared`, `companion-dependent`, `heuristic`, or `unavailable`. Declared scope depends on the supported fields actually being present; unavailable scope is not production proof.",
    "- Artifact pins describe retained checksum or revision coordinates, including supported companion inputs. A pin may be absent. `none` means this parser does not retain such pins, even if the upstream format can contain them.",
    "- Network, host, DNS, connected-address, archive limits, and actual content verification remain owned by the shared evidence collectors. Adapter declarations grant no network authority.", "",
    "Use report completeness dimensions and evidence diagnostics to determine what the individual scan actually inspected. The overall collection status can be complete while the graph dimension is unknown.", "",
    "Scan JSON `lockfiles[].support` and diff JSON `lockfileChanges` entries expose this contract. SARIF uses `ohriskInputSupport`; CycloneDX uses `ohrisk:inputSupport`. These fields describe capability, not per-artifact verification.", "",
    "| Input kind | Adapter | Relationships | Development scope | Artifact pins |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.join(" | ")} |`), "",
    "This document is generated from adapter declarations by the configured `ohrisk_generate_input_support_docs` intent. The related verification intent checks synchronization.", ""
  ].join("\n");
}

if (import.meta.main) {
  const target = path.resolve(import.meta.dir, "../docs/input-support.md");
  const expected = renderInputSupportDocumentation();
  if (process.argv.slice(2).join(" ") === "--write") writeFileSync(target, expected);
  else if (readFileSync(target, "utf8") !== expected) throw new Error("Input support documentation differs from the adapter contract.");
}
