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

## Markdown

Formatted for PR comments, release notes, or documentation.

- **Active findings**: table with columns ID, Fingerprint, Severity, Package, Dependency, Reason, Recommendation, Action, Path
- **Waived findings**: table with columns ID, Fingerprint, Severity, Package, Matched by, Reason, Action
- **Expired waivers**: table with columns Target, Expires on, Reason
- **Unmatched waivers**: table with columns Target, Reason
- **Waiver mode**: shown as inline code in the summary
- **Strict waiver drift**: shown as inline code in the summary when `--strict-waivers` is set
- **Local paths**: the project summary uses the package/project name, not the absolute project root, so PR-facing artifacts do not expose local or CI workspace paths

## HTML

Formatted as a standalone browser-friendly HTML document for local review.

- **Review summary**: first-screen status, active finding counts, scan scope, waiver drift status, and review focus derived from the same finding data as the detailed sections
- **Active findings**: filterable severity, search, dependency, and action controls with detail cards for Severity, Package, Dependency, Reason, Action, Path, Evidence, and Fingerprint. Long detail values are collapsed by default and can be expanded in the browser.
- **Waived findings**: table with columns Severity, Package, Matched by, Reason, Action, Fingerprint
- **Expired waivers**: table with columns Target, Expires on, Reason
- **Unmatched waivers**: table with columns Target, Reason
- **Waiver mode**: shown in the summary cards
- **Strict waiver drift**: shown in the summary cards when `--strict-waivers` is set
- **Language**: `--language en|ko` localizes the HTML report chrome and Ohrisk-generated review text. Machine-readable IDs, enum values, fingerprints, paths, and raw evidence remain stable.
- **Local paths**: the project summary uses the package/project name, not the absolute project root, so local browser artifacts are safer to share than terminal output
- **Open after write**: `--open` can be combined with `--html --output <file>` to open a project-relative report path through a temporary `127.0.0.1` URL after scan completion

## SARIF

SARIF 2.1.0 output for security tools and GitHub code scanning.

- **Active findings**: full result objects with `ruleId`, `level`, `message`, `locations`, `partialFingerprints`, and `properties` (findingId, fingerprint, packageId, reason, recommendation, action, dependencyType, dependencyScope, paths, evidence)
- **Waived findings**: included as suppressed results with `suppressions: [{ kind: "external", justification: <waiver reason> }]` and `waived: true`, `waiverMatchedBy`, `waiverReason` in properties
- **Expired/unmatched waivers**: NOT listed as individual objects. Summarized as count properties in the run's `properties`:
  - `ohriskExpiredWaiverCount`
  - `ohriskUnmatchedWaiverCount`
  - When `--strict-waivers` is set: `ohriskStrictWaivers`, `ohriskWaiverDriftFailed`, `ohriskWaiverDriftCount`
- **Waiver mode**: `ohriskWaiverMode` in run properties
- **CI artifact**: suitable for `github/codeql-action/upload-sarif` (requires `security-events: write` permission)

SARIF does not list expired or unmatched waiver objects. Use JSON or Markdown output if you need the full waiver details for review.

## CycloneDX

CycloneDX 1.5 JSON SBOM for supply chain tools.

- **Active findings**: attached as component properties (`ohrisk:findingId`, `ohrisk:fingerprint`, `ohrisk:riskSeverity`, `ohrisk:recommendation`, `ohrisk:action`)
- **Waived findings**: NOT listed. CycloneDX does not receive waived finding data.
- **Expired/unmatched waivers**: NOT listed.
- **Waiver mode**: `ohrisk:waiverMode` in metadata properties
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
