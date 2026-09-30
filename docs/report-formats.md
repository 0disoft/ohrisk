# Report Formats Guide

Report schema `3.7.0` adds optional input `support` declarations to lockfile
entries. Scan JSON and both diff sides describe relationship reconstruction,
development-scope detection, and retained artifact pins. SARIF records
`ohriskInputSupport` and CycloneDX records `ohrisk:inputSupport`; text, Markdown,
and HTML scan summaries describe the same adapter contract. These declarations
are capabilities, not proof that a particular scan or artifact was verified.
See [Input Support Contract](input-support.md) for the generated matrix.
Baseline configuration digests include the report schema; review and regenerate
existing baselines when upgrading from 3.6 to 3.7 rather than silently reusing them.

Finding fingerprints contain normalized license decisions. Ordinary evidence
locations and metadata-source labels do not change that decision. Restriction
scope, bundled component licenses, conflicts, warnings, private-package flags,
and deprecated SPDX identifiers remain in semantic evidence facts. Full
provenance remains available in each finding's evidence list. Waivers, diff,
and baseline checks share compatibility comparison for older semantic
fingerprints; opaque legacy formats keep exact matching. The report field
structure and path-based finding IDs are unchanged.

Ohrisk supports six output formats. Each serves a different audience and
includes different levels of waiver detail.

## Format comparison

| Format | Flag | Primary use | Active findings | Waived findings | Expired/unmatched waivers | CI artifact? |
|---|---|---|---|---|---|---|
| Terminal | (default) | Quick local check | Full detail | Full detail | Full detail | No |
| JSON | `--json` | Scripting, CI gates | Full array | Full array | Full arrays | Yes |
| Markdown | `--markdown` | PR comments, release notes | Table | Table | Tables | Yes |
| HTML | `--html` | Local browser review | Filterable detail cards | Table | Tables | Yes |
| SARIF | `--sarif` | GitHub code scanning | Full results | Suppressed results | Count properties only | Yes |
| CycloneDX | `--cyclonedx` | SBOM, supply chain tools | Component properties | Not listed | Not listed | Yes |

## JSON schema versioning

Imported PURL qualifiers and subpaths are retained as part of package identity.
Qualifier keys are normalized and sorted, and ordinary unqualified package IDs
remain unchanged. Packages with different public qualifiers or subpaths keep
separate evidence and findings. Existing waivers for formerly collapsed qualified
packages require review. Authentication qualifiers are omitted; source URL
qualifiers exclude userinfo, queries, and fragments before identity and output.
These URLs are identifying metadata and do not authorize remote fetching.

npm, pnpm, and uv source relationships are enumerated independently of bounded
display paths. A shared package's 65th incoming edge and descendants remain in
the scan and CycloneDX dependency graph. Source traversal rejects more than
1,000,000 distinct scoped edges or 200,000 package nodes instead of silently
dropping relationships. Missing required pnpm and uv requests are reported as
unresolved dependencies. npm v1 root relationships remain unknown because its
tree does not prove which hoisted packages were declared directly; pnpm local
links outside the parsed package model are likewise opaque, not missing packages.

Scan and each side of a diff share the same inspection completeness contract.
Alongside the existing status and evidence/repository counters, candidate schema
3.6 adds `unresolvedDependencyCount`, safe `unresolvedDependencies` records, and
`dimensions` for input coverage, dependency relationships, evidence collection,
and license identification. Missing required installations and name-based
recovery without an installation path make a result partial. npm optional
dependencies and explicitly optional peers may be absent without making it
partial. Development-only unresolved requests are excluded by production scans.

Unknown relationships are reported separately from proven missing requests;
available evidence whose license is unidentified is also separate from a
collection failure. Display-path truncation alone does not make the inspection
partial. SARIF run properties expose this object as `ohriskCompleteness`, and
CycloneDX metadata carries the same JSON object in `ohrisk:completeness`.
Source URL specifications and credentials are not included in unresolved
request records.

When merged inputs declare conflicting artifacts for one package URL, Ohrisk
retains the source declarations internally and does not collect from an arbitrary
location. Evidence is marked unavailable and JSON includes the structured
`artifact_identity_conflict` evidence diagnostic. CI and gated diffs reject the
partial result unless `--allow-partial-evidence` is explicit. Embedded SBOM
claims cannot override an unresolved artifact identity.

Equivalent supported checksum encodings are normalized. Mirrors with the same
supported checksum share deterministic collection, and the selected archive
must still pass the normal integrity verification before its evidence is used.
Different locations without a shared supported checksum remain unresolved.

Every Ohrisk JSON report includes `$schema` and `schemaVersion`. The published
Draft 2020-12 contracts live in `schemas/common.schema.json`,
`schemas/scan-report.schema.json`, `schemas/diff-report.schema.json`,
`schemas/explain-report.schema.json`, `schemas/baseline.schema.json`,
`schemas/baseline-check.schema.json`, and
`schemas/report-summary.schema.json`. The companion contracts use their own
independent `1.0.0` version because they model reduced checked-in decisions,
bounded summaries, or third-party-notice inputs and results rather than the
full report payload. Notice generation uses
`schemas/notices-evidence.schema.json` and
`schemas/notices-result.schema.json`.

Schema `3.7.0` is a closed contract. Report roots and structured nested objects
reject unknown properties, while common `$defs` define findings, evidence,
normalized licenses, policy summaries, waivers, thresholds, provenance, remote
repository submodule coverage, and
lockfile changes. Required-field, enum, array-item, path, and dependent-field
rules are validated against real scan, diff, and explain output during release
verification.

### TypeScript and schema imports

The npm package exposes report instance types through the type-only
`ohrisk/report-types` entry point:

```ts
import type { Finding, ScanReport } from "ohrisk/report-types";

export function highRiskPackages(report: ScanReport): string[] {
  return report.findings
    .filter((finding: Finding) => finding.severity === "high")
    .map((finding) => finding.packageId);
}
```

JSON Schemas have stable extension-free package subpaths:

```ts
import scanReportSchema from "ohrisk/schemas/scan-report" with {
  type: "json"
};
```

The available schema subpaths are:

- `ohrisk/schemas/common`
- `ohrisk/schemas/scan-report`
- `ohrisk/schemas/diff-report`
- `ohrisk/schemas/explain-report`
- `ohrisk/schemas/waiver-file`
- `ohrisk/schemas/baseline`
- `ohrisk/schemas/baseline-check`
- `ohrisk/schemas/report-summary`
- `ohrisk/schemas/notices-evidence`
- `ohrisk/schemas/notices-result`

Use `moduleResolution: "NodeNext"` or `"Bundler"` and enable
`resolveJsonModule` when importing the JSON files from TypeScript. Existing
explicit paths such as `ohrisk/schemas/scan-report.schema.json` remain exported
for consumers that already use them.

Schema 3.6 adds optional diff completeness fields. `diff` JSON may include
`completeness` with `status`, `baseline`, and `current` sub-status, plus
`evidenceGateFailed` and `allowPartialEvidence`. Each side reports `status`,
unavailable-package and skipped-repository-entry counts, unresolved requests,
and separate inspection dimensions. Unknown graph coverage remains visible
without equating it with a proven missing installation. The
`ohrisk-summary` companion accepts 3.5.0, 3.6.0, and 3.7.0 scan and diff reports and
reports the diff completeness status and gate failure.

Schema 3.5 adds the `conflicting-evidence` normalized-license signal. Python
license classifiers are identified as classifiers in evidence text. A single
distinct expression recognized from verified declared license files may replace
a conflicting legacy classifier, but multiple distinct recognized file
expressions fail closed with unknown severity and require evidence review.

Schema 3.1 adds optional archive provenance to scan JSON: a safe relative name,
format, SHA-256 digest, and canonical project root inside the archive. Archived
lockfile and dependency-origin paths use `archive.zip!/path` notation. The same
provenance is carried as properties in SARIF and CycloneDX output; no report
contains the archive's absolute host path.

Explain JSON also includes a redacted `policy` summary and
`policyScope: "license-only"`. Policy source files stay workspace-relative, and
package rules are not represented as applied because a license expression alone
does not provide a package ID or Package URL.

Schema 3.0 added required evidence source/diagnostic summaries, dependency-graph
diagnostics, and separate diff classifications for new, changed, and resolved
findings. It is intentionally incompatible with 2.x and the earlier permissive
1.x contracts. Consumers should select the schema identified by both `$schema`
and `schemaVersion`, reject unsupported major versions, and treat a validation
failure as a producer/consumer contract mismatch rather than accepting a
partially shaped report.

Scan reports expose `dependencyOrigins` keyed by canonical package ID when
several lockfiles contribute the same Package URL. Diff reports expose
`lockfileChanges.current`, `baseline`, `added`, and `removed`, allowing
automation to distinguish finding changes from input-set changes. Diff reports
also expose `newFindings`, `changedFindings`, and `resolvedFindings`; the legacy
`findings` array contains the combined new and changed set used by thresholds.

## Terminal

Default output when no format flag is passed. Designed for quick local checks.

- **Active findings**: full detail (id, fingerprint, severity, reason, recommendation, action, dependency, path, evidence)
- **Waived findings**: full detail (id, fingerprint, severity, matched by, waiver reason, action)
- **Expired waivers**: listed with target, expires on, reason
- **Unmatched waivers**: listed with target, reason
- **Waiver mode**: shown as `Waiver mode: local (.ohrisk-waivers.json)` or `ignored (--no-waivers)`
- **Strict waiver drift**: shown as `Waiver drift: passed/failed (N expired or unmatched waivers)` when `--strict-waivers` is set

Not suitable as a CI artifact. Use `--json`, `--markdown`, `--html`, `--sarif`, or `--cyclonedx` with `--output` instead.

## JSON

Structured output for scripting and CI automation.

- **Active findings**: `findings` array with full `RiskFinding` objects
- **Waived findings**: `waivedFindings` array with finding, waiver, and `matchedBy` field
- **Expired waivers**: `expiredWaivers` array with full waiver objects (id/fingerprint, reason, expiresOn)
- **Unmatched waivers**: `unmatchedWaivers` array with full waiver objects (id/fingerprint, reason)
- **Waiver mode**: `waiverMode` field (`"local"` or `"ignored"`)
- **Strict waiver drift**: `strictWaivers`, `waiverDriftFailed`, `waiverDriftCount` fields when `--strict-waivers` is set
- **CI threshold**: `failOn`, `failingFindingCount` fields in CI mode
- **Input changes**: diff JSON includes `lockfileChanges.current`, `baseline`, `added`, and `removed` arrays with project-relative paths and lockfile kinds
- **Diff classification**: `newFindings`, `changedFindings`, and `resolvedFindings` are separate; `findings` remains the combined new-and-changed threshold set
- **Evidence diagnostics**: scan JSON groups package/file/warning counts by `local`, `registry`, `sbom`, `tarball`, and `unavailable`, with stable diagnostic codes and typed dependency-graph truncation diagnostics
- **Scan completeness**: scan JSON reports `complete` or `partial` with evidence, repository and unresolved-request counters and inspection dimensions; CI rejects `partial` by default independently of the risk threshold
- **Diff completeness**: diff JSON may include `completeness` with `status`, `baseline`, and `current` inspection state, plus `evidenceGateFailed` and `allowPartialEvidence`; `diff --fail-on` rejects unavailable evidence or unresolved required installations unless `--allow-partial-evidence` is set
- **Python license provenance**: classifier-derived values use `<source> classifier: <expression>` evidence. Conflicting recognized license-file expressions add `conflicting-evidence`, produce unknown severity, and preserve every conflicting file match for review.
- **Metadata/file reconciliation**: parseable package metadata and recognized license files remain separate assertions. Any recognized file expression outside the metadata choices adds `conflicting-evidence`, preserves both claims, and produces unknown severity. Multiple files do not conflict when every expression is covered by one metadata classifier choice set or by one explicit license-file choice expression. Deprecated GNU IDs compare against their current `-only` or `-or-later` equivalents without creating a false conflict. Canonical GNU or MPL version text is compatible with metadata granting that version or later, but explicit file-level broader permission still conflicts with narrower metadata. SPDX identifier lines wrapped in Markdown inline-code delimiters are normalized before parsing. Standard MIT notice variations and explicit BSD one-clause, BSD three-clause, and bzip2 text remain distinct expressions.
- **Bundled-component reconciliation**: when a primary `LICENSE` or `LICENCE` file has a qualified sibling such as `LICENSE.libyaml`, `LICENSE_zstd.txt`, `LICENSE.thirdparty`, `LICENSE.vendor`, or `LICENSE.component`, or a sibling `THIRD_PARTY_LICENSES*` inventory, the additional file is cumulative component evidence. Its recognized expression is combined with the package expression using SPDX `AND`; document extensions and known package-license alternatives such as `LICENSE-MIT`, `LICENSE-APACHE`, and `LICENSE-BSD-3-Clause` remain ordinary package-license evidence.
- **SPDX assertion provenance**: `licenseDeclared` and `licenseConcluded` are preserved as separate evidence entries. Distinct values add `conflicting-evidence` and produce unknown severity instead of allowing either assertion to override the other.
- **SPDX custom-license provenance**: document-local extracted text for referenced `LicenseRef-*` identifiers is represented as bounded synthetic license-file evidence. Missing local definitions and external `DocumentRef-*:LicenseRef-*` values remain warnings rather than being guessed.
- **SPDX custom-license confidence**: valid local or external-document `LicenseRef` expressions remain custom, low-confidence, unknown findings unless their bounded evidence supplies a stronger restriction signal.
- **SPDX catalog validation**: standard license and exception terms are checked against the pinned official catalog. Unlisted identifiers fail closed instead of being treated as high-confidence SPDX metadata; deprecated identifiers remain compatible but are named in evidence provenance and carry medium confidence.
- **Restriction scope evidence**: commercial restrictions explicitly limited to documentation or data/corpora are preserved as `restriction scope: documentation in <path>` or `restriction scope: data in <path>` evidence without being treated as package-code restrictions; mixed or ambiguous scope remains package-level
- **Obligation evidence**: distributed-app findings may include `obligation: license-text` and `obligation: notice-file` entries with a trigger and `status: unknown`. These are conservative required-artifact hints, not proof that a release artifact satisfies or misses an obligation. Because evidence participates in fingerprints, affected fingerprint waivers require review after upgrade.
- **Maven evidence corrections**: canonical SPDX aliases, allowed repository provenance, and checksum/identity-verified JAR evidence may change severity, reason, evidence, and therefore finding fingerprints. Fingerprint waivers for corrected Maven findings must be reviewed after upgrade; finding-ID waivers remain tied to the same package/path identity.
- **Remote repository coverage**: remote scan JSON includes `repository.owner`, `repository.name`, bounded `repository.submodules` mode/count/paths, separate `repository.symbolicLinks`, and `repository.nonPortablePaths` skipped counts, relative paths, and path-list truncation state
- **Schema validation**: scan, diff, and explain JSON must satisfy the packaged 3.7.0 schema; unknown object properties are rejected
- **Local paths**: `projectRoot` is represented as `.`, and lockfile metadata uses a project-relative path so CI artifacts do not expose workspace paths

## Markdown

Formatted for PR comments, release notes, or documentation.

- **Active findings**: table with columns ID, Fingerprint, Severity, Package, Dependency, Reason, Recommendation, Action, Path
- **Waived findings**: table with columns ID, Fingerprint, Severity, Package, Matched by, Reason, Action
- **Expired waivers**: table with columns Target, Expires on, Reason
- **Unmatched waivers**: table with columns Target, Reason
- **Waiver mode**: shown as inline code in the summary
- **Strict waiver drift**: shown as inline code in the summary when `--strict-waivers` is set
- **Local paths**: the project summary uses the package/project name, not the absolute project root, so PR-facing artifacts do not expose local or CI workspace paths
- **Remote repository coverage**: skipped submodules, non-followed symbolic links, and excluded non-portable paths are listed as incomplete scan coverage with a separate follow-up action

## HTML

Formatted as a standalone browser-friendly HTML document for local review.

- **Review summary**: first-screen status, active finding counts, scan scope, waiver drift status, and review focus derived from the same finding data as the detailed sections. When unknown findings are dominated by missing local source/cache evidence, the summary also suggests dependency-restore commands such as `go mod download all`, `cargo fetch`, `dotnet restore`, dependency resolution for Maven/Gradle, Python virtualenv install, `dart pub get`, or `swift package resolve` before a full app build.
- **Active findings**: a responsive review console combines filterable severity, search, dependency, and action controls with a package-identity-only selectable list and a synchronized detail inspector for Severity, Package, Dependency, Reason, Action, Path, Evidence, and Fingerprint. The list intentionally shows only `name@version`; severity and every explanatory field appear once in the inspector. The persistent sidebar links to report sections, while secondary review context and the full scan summary remain collapsed until requested so findings stay prominent. Finding rows are native keyboard-accessible buttons and the selected row follows the visible filter result set. Long detail values are collapsed by default and can be expanded in the browser. Search text is derived once from the finding's hidden source detail when the report opens instead of being duplicated in per-card attributes, so reason and evidence searches remain available without rendering those fields twice. Fingerprints of 512 characters or more store canonical or legacy-compatible identities as prefix-delta path records and retain only the exact suffix in a script-inert JSON dictionary, then reconstruct the unchanged fingerprint when its collapsed detail is expanded. Short fingerprints remain inline. This changes only standalone HTML representation: finding IDs, waiver matching, and JSON, Markdown, SARIF, and CycloneDX values are unchanged.
- **Waived findings**: table with columns Severity, Package, Matched by, Reason, Action, Fingerprint
- **Expired waivers**: table with columns Target, Expires on, Reason
- **Unmatched waivers**: table with columns Target, Reason
- **Waiver mode**: shown in the summary cards
- **Strict waiver drift**: shown in the summary cards when `--strict-waivers` is set
- **Language**: `--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de` localizes the HTML report chrome and Ohrisk-generated review text. Without the option, the CLI uses a supported primary language from the operating system locale and falls back to English when detection or mapping is unavailable. An explicit value always takes precedence, which is recommended for reproducible CI artifacts. Machine-readable IDs, enum values, fingerprints, paths, and raw evidence remain stable.
- **Local paths**: the project summary uses the package/project name, not the absolute project root, so local browser artifacts are safer to share than terminal output
- **Open after write**: `--open` can be combined with `--html --output <file>` to open a project-relative report path through a temporary `127.0.0.1` URL after scan completion
- **Remote repository default**: `scan --html <github-url>` writes `<repository>-ohrisk.html` in the invocation directory when `--output` is omitted; local and archive HTML scans still print to stdout by default
- **Remote repository coverage**: a localized summary card and next action identify skipped submodules, symbolic links, and non-portable paths so a clean findings list is not mistaken for complete coverage

## SARIF

SARIF 2.1.0 output for security tools and GitHub code scanning.

- **Active findings**: full result objects with `ruleId`, `level`, `message`, `locations`, `partialFingerprints`, and `properties` (findingId, fingerprint, packageId, reason, recommendation, action, dependencyType, dependencyScope, paths, evidence)
- **Waived findings**: included as suppressed results with `suppressions: [{ kind: "external", justification: <waiver reason> }]` and `waived: true`, `waiverMatchedBy`, `waiverReason` in properties
- **Expired/unmatched waivers**: NOT listed as individual objects. Summarized as count properties in the run's `properties`:
  - `ohriskExpiredWaiverCount`
  - `ohriskUnmatchedWaiverCount`
  - When `--strict-waivers` is set: `ohriskStrictWaivers`, `ohriskWaiverDriftFailed`, `ohriskWaiverDriftCount`
- **Waiver mode**: `ohriskWaiverMode` in run properties
- **Remote repository coverage**: repository identity plus bounded submodule, symbolic-link, and non-portable-path counts, paths, and truncation state are recorded in run properties
- **CI artifact**: suitable for `github/codeql-action/upload-sarif` (requires `security-events: write` permission)

SARIF does not list expired or unmatched waiver objects. Use JSON or Markdown output if you need the full waiver details for review.

## CycloneDX

CycloneDX 1.5 JSON SBOM for supply chain tools.

SBOM input relationships are preserved independently of the bounded display
paths. CycloneDX and SPDX inputs retain every known edge even when a shared
dependency has more than 64 explanatory paths. Production filtering follows
these relationships rather than removing packages because their stored display
paths were omitted. Nix input relationships are also retained separately.

Unknown or non-exhaustive adjacency is identified by `compositions` with
`aggregate: "unknown"`. A component with unknown adjacency is not emitted as
an empty leaf. Known positive edges remain available; `dependsOn: []` is used
only for a known leaf. Parsers that have not supplied explicit relationships
retain their known path-derived edges and mark their adjacency as unknown.

- **Active findings**: attached as component properties (`ohrisk:findingId`, `ohrisk:fingerprint`, `ohrisk:riskSeverity`, `ohrisk:recommendation`, `ohrisk:action`)
- **Waived findings**: NOT listed. CycloneDX does not receive waived finding data.
- **Expired/unmatched waivers**: NOT listed.
- **Waiver mode**: `ohrisk:waiverMode` in metadata properties
- **Remote repository coverage**: repository identity and bounded skipped-submodule, skipped-symbolic-link, and skipped-non-portable-path metadata are recorded in metadata properties
- **Local paths**: project root is represented as `.`, and lockfile metadata uses a project-relative path.
- **CI artifact**: suitable as an SBOM artifact for compliance pipelines

CycloneDX is an SBOM, not a risk report. It focuses on component inventory, dependency relationships, license metadata, and active finding properties. For waived finding suppression details, SARIF output includes them as suppressed results. For full expired and unmatched waiver object review, use JSON or Markdown output.

## Waiver mode field

Every format includes a waiver mode indicator so you can distinguish a raw audit (`--no-waivers`) from a scan with local waivers applied:

| Format | Field | Values |
|---|---|---|
| Terminal | `Waiver mode:` line | `local (.ohrisk-waivers.json)` / `ignored (--no-waivers)` |
| JSON | `waiverMode` | `"local"` / `"ignored"` |
| Markdown | `Waiver mode:` line | `local (.ohrisk-waivers.json)` / `ignored (--no-waivers)` |
| HTML | summary card | `local (.ohrisk-waivers.json)` / `ignored (--no-waivers)` |
| SARIF | `ohriskWaiverMode` | `"local"` / `"ignored"` |
| CycloneDX | `ohrisk:waiverMode` | `"local"` / `"ignored"` |
