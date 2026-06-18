# Changelog

## 0.63.0 - 2026-06-19

### Fixed

- Legacy `package-lock.json` v1 parsing now preserves nested optional dependency flags instead of inheriting production scope from the parent.

## 0.62.0 - 2026-06-19

### Fixed

- Bun lockfile parsing now preserves nested optional and peer dependency edges instead of reporting them as production edges.

## 0.61.0 - 2026-06-19

### Fixed

- `pnpm-lock.yaml` parsing now preserves nested optional and peer dependency edges from package snapshots.
- Yarn v1 lockfile parsing now preserves nested optional dependency edges instead of reporting them as production edges.

## 0.60.0 - 2026-06-19

### Fixed

- Modern `package-lock.json` parsing now preserves nested `optionalDependencies` and `peerDependencies` edges instead of dropping those transitive packages.

## 0.59.0 - 2026-06-19

### Added

- Release verification now installs the packed tarball into a temporary consumer project and smoke-tests the packaged `ohrisk` bin with `version` and `scan --json`.
- Usage documentation now shows the installed `ohrisk` CLI command instead of source-tree development commands.

## 0.58.0 - 2026-06-19

### Added

- Command-specific help is now also available through `ohrisk <command> --help` and `ohrisk <command> -h`.

## 0.57.0 - 2026-06-19

### Added

- `ohrisk help <command>` now prints command-specific usage and option details for `scan`, `ci`, `diff`, `explain`, `help`, and `version`.

## 0.56.0 - 2026-06-19

### Added

- License evidence collection now recognizes `UNLICENSE` plus hyphen and underscore variants such as `LICENSE-MIT`, `LICENCE_APACHE`, `COPYING-LESSER`, and `NOTICE_THIRD_PARTY`.

## 0.55.1 - 2026-06-19

### Fixed

- Commercial restriction signals no longer override parseable `OR` license choices when a lower-risk branch is available.

## 0.55.0 - 2026-06-19

### Added

- License normalization now recognizes common source-available restriction aliases such as Commons Clause, BUSL, SSPL, Elastic License, and PolyForm variants.
- Package metadata license strings with explicit commercial-use restrictions now produce high-risk commercial restriction signals.

## 0.54.0 - 2026-06-19

### Added

- CycloneDX SBOM components now include active Ohrisk risk decision properties for audit workflows.
- CycloneDX SBOM metadata now includes the Ohrisk waiver mode.

## 0.53.0 - 2026-06-19

### Added

- Reports now expose waiver mode so raw `--no-waivers` audits are distinguishable from normal local waiver scans.

## 0.52.1 - 2026-06-19

### Fixed

- README report examples now match the current terminal and Markdown fingerprint output.

## 0.52.0 - 2026-06-19

First public release candidate for Ohrisk.

### Added

- `ohrisk scan` for local Bun `bun.lock` projects.
- `package-lock.json` graph parsing for modern npm lockfiles with a `packages` section.
- npm v1 `package-lock.json` dependency-tree parsing.
- `pnpm-lock.yaml` graph parsing for importer, package, and snapshot dependency data.
- Yarn v1 `yarn.lock` graph parsing with root dependency classification from `package.json`.
- `--profile saas` and `--profile distributed-app` risk profiles.
- `--prod` filtering that excludes development-only dependencies while keeping production-relevant optional and peer dependency risk visible.
- `--json` output that reuses the terminal report finding model.
- `--sarif` output for SARIF 2.1.0 code scanning upload.
- `--markdown` output for PR comments and release notes.
- `--cyclonedx` output for CycloneDX 1.5 JSON SBOMs.
- Diff reports surface new or changed NOTICE and attribution work as the next action.
- `--output <file>` for writing scan, ci, diff, and explain reports to disk.
- `ohrisk ci --fail-on <severity>` for non-zero exits when findings meet a configured threshold.
- `ohrisk ci --strict-waivers` for non-zero exits when local waivers are expired or unmatched.
- `ohrisk scan --no-waivers` and `ohrisk ci --no-waivers` for raw audits that ignore local waiver files.
- `ohrisk explain <license-expression>` for profile-aware license risk explanation without scanning a project.
- `ohrisk diff <baseline-ref>` for git-ref baseline comparison that reports only new or meaningfully changed findings.
- `--version` and `-v` package version output.
- `help` and `version` command aliases for the global CLI.
- Unknown option errors list the supported `--help` and `-h` aliases.
- Diff output-format conflict errors no longer advertise unsupported SARIF output.
- Top-level `help` and `version` aliases validate trailing arguments instead of silently ignoring them.
- Help output and README examples document the supported `help <command>` shape.
- Project discovery with clear failures for unsupported or ambiguous lockfiles.
- Bun lockfile dependency graph parsing with direct, transitive, production, and development dependency context.
- Local `file:` package evidence collection.
- Installed `node_modules` package evidence collection before network fallback.
- HTTP(S) tarball evidence collection when the lockfile points directly to a tarball.
- npm registry metadata lookup when the lockfile does not contain a direct tarball URL.
- `package.json` license field, legacy `licenses` field, `LICENSE`, `LICENCE`, `COPYING`, and `NOTICE` evidence handling.
- SPDX-like license expression parsing with simple `AND` and `OR` handling.
- SPDX `WITH` exception handling, deprecated package license object handling, and explicit `UNLICENSED` risk classification.
- Common human-readable license metadata aliases such as `Apache License, Version 2.0`, `BSD 2-Clause`, and `ISC License` are normalized.
- Common permissive and public-domain-style SPDX licenses `0BSD`, `CC0-1.0`, and `Unlicense` are classified as low risk.
- NOTICE evidence is surfaced as attribution-preservation action text without raising severity.
- Source-available restriction licenses `Elastic-2.0`, `PolyForm-Noncommercial-1.0.0`, and `PolyForm-Free-Trial-1.0.0` are classified as high risk.
- `Zlib` is classified as a low-risk permissive license.
- Explicit commercial restriction text detection for Commons Clause, BUSL, and non-commercial license evidence.
- `UNLICENSED` packages get specific reason and action text instead of generic high-risk wording.
- Source-available restriction licenses get specific high-risk reason text.
- Recognizable standard license text in `LICENSE` and `COPYING` files is used as medium-confidence evidence when package license metadata is absent.
- Recognizable standard license files can resolve malformed package metadata pointers such as `SEE LICENSE IN LICENSE`.
- Standard license file detection covers `Unlicense` and `CC0-1.0` public-domain-style text.
- Standard license file detection covers Zlib license text.
- Standard license file detection covers GPL-2.0, LGPL-2.0, and LGPL-2.1 text in addition to existing GPL-family v3 detection.
- Specific finding reason text for explicit commercial-use restriction evidence.
- Markdown scan and diff reports include finding reasons for PR review.
- Findings include human-readable action text alongside the stable recommendation enum.
- Findings include stable IDs for JSON, terminal, Markdown, SARIF, and diff matching.
- Diff matching ignores reason and evidence prose churn while still surfacing severity, recommendation, or action changes.
- Findings include exact fingerprints for SARIF partial fingerprints and downstream audit trails.
- Terminal and Markdown scan, CI, and diff reports include finding fingerprints for waiver and audit workflows.
- npm alias dependencies resolve to the actual package identity while keeping the alias visible in dependency paths.
- Installed `node_modules` evidence lookup checks npm alias install names before registry fallback.
- pnpm alias package keys such as `alias@npm:actual@version` resolve to the actual package identity.
- Local and remote package tarballs are verified against lockfile integrity digests before license evidence is trusted.
- SARIF result properties include structured reason and action fields.
- Markdown scan reports include license confidence counts.
- Terminal and Markdown scan summaries include missing and malformed license counts.
- Risk findings include structured dependency type and direct/transitive scope.
- Scan and diff reports choose the next action from the actual finding recommendations.
- JSON scan and diff reports include the same next action used by human-readable reports.
- JSON reports include `failOn`, `failed`, and `failingFindingCount` when a CI or diff threshold is configured.
- Terminal and Markdown reports show threshold pass/fail lines when a CI or diff threshold is configured.
- `.ohrisk-waivers.json` local waivers by finding ID or fingerprint.
- Scan and CI JSON, terminal, and Markdown reports separate active findings from waived findings.
- SARIF reports include waived findings as externally suppressed results with waiver reason metadata.
- Expired local waivers are reported with target, reason, and expiry date without being applied.
- Unmatched active waivers are reported with target and reason without being applied.
- JSON, terminal, Markdown, and SARIF reports show strict waiver drift status when `ci --strict-waivers` is enabled.
- Unknown-risk findings now distinguish missing, malformed, and unrecognized license metadata in reason and action text.
- Risk findings for low, review, high, and unknown license evidence.
- Terminal findings sorted by severity with package path, recommendation, and evidence snippets.

### Not Included Yet

- Central approval or legal workflow management.
- GitHub App integration.
- Ecosystem adapters beyond npm-style lockfiles.
