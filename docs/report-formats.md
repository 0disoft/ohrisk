# Report Formats Guide

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

Every Ohrisk JSON report includes `$schema` and `schemaVersion`. The published
Draft 2020-12 contracts live in `schemas/common.schema.json`,
`schemas/scan-report.schema.json`, `schemas/diff-report.schema.json`, and
`schemas/explain-report.schema.json`.

Schema `3.3.0` is a closed contract. Report roots and structured nested objects
reject unknown properties, while common `$defs` define findings, evidence,
normalized licenses, policy summaries, waivers, thresholds, provenance, remote
repository submodule coverage, and
lockfile changes. Required-field, enum, array-item, path, and dependent-field
rules are validated against real scan, diff, and explain output during release
verification.

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
- **Evidence diagnostics**: scan JSON groups package/file/warning counts by `local`, `sbom`, `tarball`, and `unavailable`, with stable diagnostic codes and typed dependency-graph truncation diagnostics
- **Restriction scope evidence**: explicit commercial restrictions limited to documentation or data/corpora are preserved as `restriction scope: documentation in <path>` or `restriction scope: data in <path>` evidence without being treated as package-code restrictions
- **Maven evidence corrections**: canonical SPDX aliases, allowed repository provenance, and checksum/identity-verified JAR evidence may change severity, reason, evidence, and therefore finding fingerprints. Fingerprint waivers for corrected Maven findings must be reviewed after upgrade; finding-ID waivers remain tied to the same package/path identity.
- **Remote repository coverage**: remote scan JSON includes `repository.owner`, `repository.name`, bounded `repository.submodules` mode/count/paths, separate `repository.symbolicLinks`, and `repository.nonPortablePaths` skipped counts, relative paths, and path-list truncation state
- **Schema validation**: scan, diff, and explain JSON must satisfy the packaged 3.3.0 schema; unknown object properties are rejected
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
- **Active findings**: filterable severity, search, dependency, and action controls with detail cards for Severity, Package, Dependency, Reason, Action, Path, Evidence, and Fingerprint. Long detail values are collapsed by default and can be expanded in the browser. The search index contains package, reason, action, dependency, evidence, and displayed path text; full finding IDs and fingerprints remain visible in their detail fields but are not duplicated into HTML data attributes.
- **Waived findings**: table with columns Severity, Package, Matched by, Reason, Action, Fingerprint
- **Expired waivers**: table with columns Target, Expires on, Reason
- **Unmatched waivers**: table with columns Target, Reason
- **Waiver mode**: shown in the summary cards
- **Strict waiver drift**: shown in the summary cards when `--strict-waivers` is set
- **Language**: `--language en|ko|es|fr|zh|hi|ja|id|tr|ru|de` localizes the HTML report chrome and Ohrisk-generated review text. Machine-readable IDs, enum values, fingerprints, paths, and raw evidence remain stable.
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
